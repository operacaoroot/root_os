import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ComercialEntradaWhatsSchema,
  SimuladorMesaRespostaSchema,
  SimuladorRespostaSchema,
  type CelularDaMesa,
  type CelularDoLead,
  type ComercialEtapa,
  type ListaDeCelulares,
  type MensagemNoCelular,
} from '@mktos/shared';
import { z } from 'zod';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { rotuloDoHorario } from './agenda-de-homologacao';
import { DecisoesService } from './decisoes.service';
import { SalaService } from './sala.service';
import { comLinkDaSala } from './sala-token';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * O SIMULADOR DE WHATSAPP — o "celular" do lead e da mesa (tela /comercial/simulador), Lane B.
 *
 * No provedor `simulado` as mensagens vivem em `ComercialMensagem`: o que a
 * casa mandaria ao lead aparece aqui com formulário e botões renderizados, e o
 * que o lead "responde" entra pelos MESMOS métodos que a sala e um webhook de
 * provedor usam (`WhatsappComercialService.receber*`, `SalaService.responder*`).
 * Nada aqui é atalho da régua: a mensagem que a casa manda continua indo pela
 * porta e esperando a segunda pessoa na fila.
 *
 * A mesa (tela 09) também é um celular simulado: as decisões abertas e as
 * mensagens na fila chegam aqui; a resposta da decisão vai ao serviço de
 * decisões da espinha (`DecisoesService.responder`, canal `simulado`).
 */

function paraCelular(m: {
  id: string;
  direcao: string;
  destino: string;
  template: string | null;
  texto: string;
  estado: string;
  interativo: unknown;
  approvalId: string | null;
  vetoAte: Date | null;
  criadoEm: Date;
  enviadaEm: Date | null;
  erro: string | null;
}): MensagemNoCelular {
  return {
    id: m.id,
    direcao: m.direcao === 'entrada' ? 'entrada' : 'saida',
    destino: (['lead', 'mesa', 'grupo'].includes(m.destino) ? m.destino : 'lead') as MensagemNoCelular['destino'],
    template: m.template,
    texto: m.texto,
    estado: m.estado as MensagemNoCelular['estado'],
    interativo: (m.interativo ?? null) as MensagemNoCelular['interativo'],
    approvalId: m.approvalId,
    vetoAte: m.vetoAte?.toISOString() ?? null,
    em: m.criadoEm.toISOString(),
    enviadaEm: m.enviadaEm?.toISOString() ?? null,
    erro: m.erro,
  };
}

const NovidadeSchema = z.object({ novidade: z.string().trim().min(10).max(400) }).strict();

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/simulador')
export class SimuladorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whats: WhatsappComercialService,
    private readonly sala: SalaService,
    private readonly decisoes: DecisoesService,
  ) {}

  /** Um lead novo escreve (o primeiro "oi" do Instagram ou do link da bio). */
  @Post('entrada')
  @RequirePermissions('leads.editar')
  async entrada(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const r = ComercialEntradaWhatsSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return this.whats.receberEntrada(user.orgId, r.data);
  }

  /** Os celulares: um por lead que tem conversa. */
  @Get('celulares')
  @RequirePermissions('leads.ver')
  async celulares(@CurrentUser() user: JwtUser): Promise<ListaDeCelulares> {
    const leads = await this.prisma.lead.findMany({
      where: { orgId: user.orgId, mensagens: { some: {} } },
      select: {
        id: true,
        name: true,
        phone: true,
        ficha: { select: { etapa: true } },
        mensagens: { orderBy: { criadoEm: 'desc' }, take: 1, select: { criadoEm: true } },
      },
      take: 200,
    });
    const naFila = await this.prisma.comercialMensagem.groupBy({
      by: ['leadId'],
      where: { orgId: user.orgId, estado: { in: ['na_fila', 'em_veto'] } },
      _count: { _all: true },
    });
    const contagem = new Map(naFila.map((n) => [n.leadId, n._count._all]));
    return {
      provedor: this.whats.porta.provedor,
      leads: leads
        .map((l) => ({
          leadId: l.id,
          nome: l.name,
          telefone: l.phone,
          etapa: (l.ficha?.etapa ?? null) as ComercialEtapa | null,
          ultimaEm: l.mensagens[0]?.criadoEm.toISOString() ?? null,
          naFila: contagem.get(l.id) ?? 0,
        }))
        .sort((a, b) => (b.ultimaEm ?? '').localeCompare(a.ultimaEm ?? '')),
    };
  }

  /** A conversa de um lead como o lead a vê (mais o estado de cada mensagem, para a mesa). */
  @Get('lead/:leadId')
  @RequirePermissions('leads.ver')
  async conversa(@CurrentUser() user: JwtUser, @Param('leadId', new ParseUUIDPipe()) leadId: string): Promise<CelularDoLead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, orgId: user.orgId },
      select: { id: true, name: true, phone: true, ficha: { select: { etapa: true } } },
    });
    if (!lead) throw new NotFoundException('lead não encontrado');
    const mensagens = await this.prisma.comercialMensagem.findMany({ where: { leadId, orgId: user.orgId }, orderBy: { criadoEm: 'asc' }, take: 500 });
    const linkDaSala = await this.sala.linkDoLead(user.orgId, leadId);
    return {
      leadId: lead.id,
      nome: lead.name,
      telefone: lead.phone,
      etapa: (lead.ficha?.etapa ?? null) as ComercialEtapa | null,
      linkDaSala,
      // O celular do lead mostra o texto como chegaria: o marcador vira o link só nesta resposta (nunca no banco).
      mensagens: mensagens.map((m) => paraCelular(linkDaSala ? { ...m, texto: comLinkDaSala(m.texto, linkDaSala) } : m)),
    };
  }

  /** O lead "digita" no celular: texto livre, resposta de formulário ou toque em botão. */
  @Post('lead/:leadId/responder')
  @RequirePermissions('leads.editar')
  async responder(@CurrentUser() user: JwtUser, @Param('leadId', new ParseUUIDPipe()) leadId: string, @Body() body: unknown) {
    const r = SimuladorRespostaSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId: user.orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('lead não encontrado');
    const v = r.data;
    if (v.texto !== undefined) {
      return this.whats.receberDoLead(user.orgId, leadId, v.texto);
    }
    if (v.formulario) {
      const f = v.formulario;
      const resumo = `Sistema: ${f.sistema} · Base organizada: ${f.baseOrganizada ? 'sim' : 'não'} · Maior dor: ${f.maiorDor} · Equipe no financeiro: ${f.equipeFinanceiro}`;
      const ev = await this.sala.responderFormulario(user.orgId, leadId, f);
      await this.whats.registrarNoCelular(user.orgId, leadId, resumo, `form:${ev.eventoId}`);
      return ev;
    }
    const horario = v.botao!;
    const ev = await this.sala.escolherHorario(user.orgId, leadId, horario);
    await this.whats.registrarNoCelular(user.orgId, leadId, rotuloDoHorario(horario), `botao:${ev.eventoId}`);
    return ev;
  }

  /** O celular da mesa (tela 09): decisões abertas e mensagens esperando o toque. */
  @Get('mesa')
  @RequirePermissions('leads.ver')
  async mesa(@CurrentUser() user: JwtUser): Promise<CelularDaMesa> {
    const [decisoes, naFila] = await Promise.all([
      this.prisma.comercialDecisao.findMany({
        where: { orgId: user.orgId, estado: 'aberta' },
        orderBy: { expiraEm: 'asc' },
        take: 50,
        include: { lead: { select: { name: true } } },
      }),
      this.prisma.comercialMensagem.findMany({
        where: { orgId: user.orgId, estado: { in: ['na_fila', 'em_veto'] } },
        orderBy: { criadoEm: 'asc' },
        take: 100,
        include: { lead: { select: { name: true } } },
      }),
    ]);
    return {
      decisoes: decisoes.map((d) => ({
        id: d.id,
        leadId: d.leadId,
        leadNome: d.lead.name,
        tipo: d.tipo,
        titulo: d.titulo,
        contexto: d.contexto,
        opcoes: Array.isArray(d.opcoes) ? (d.opcoes as unknown as CelularDaMesa['decisoes'][number]['opcoes']) : [],
        padrao: d.padrao,
        expiraEm: d.expiraEm.toISOString(),
        criadaEm: d.criadoEm.toISOString(),
      })),
      mensagensNaFila: naFila.map((m) => ({
        id: m.id,
        leadId: m.leadId,
        leadNome: m.lead.name,
        template: m.template,
        texto: m.texto,
        estado: m.estado as CelularDaMesa['mensagensNaFila'][number]['estado'],
        approvalId: m.approvalId,
        vetoAte: m.vetoAte?.toISOString() ?? null,
        em: m.criadoEm.toISOString(),
      })),
      responderDisponivel: true,
    };
  }

  /** A mesa toca num botão de uma decisão: o mesmo caminho da tela 03, canal `simulado`. */
  @Post('mesa/responder')
  @RequirePermissions('leads.editar')
  async mesaResponder(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const r = SimuladorMesaRespostaSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
    return this.decisoes.responder(user.orgId, r.data.decisaoId, r.data.escolha, { id: user.sub, nome: user.name }, 'simulado', r.data.motivo ?? null);
  }

  /** VETO de uma mensagem na janela de veto. */
  @Post('mensagens/:id/vetar')
  @RequirePermissions('leads.editar')
  async vetar(@CurrentUser() user: JwtUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const ok = await this.whats.vetar(user.orgId, id);
    if (!ok) throw new BadRequestException('só se veta mensagem que ainda está na janela de veto');
    return { vetada: true };
  }

  /** O M6 só sai com a novidade escrita (C08). */
  @Post('mensagens/:id/novidade')
  @RequirePermissions('leads.editar')
  async novidade(@CurrentUser() user: JwtUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const r = NovidadeSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException('escreva a novidade (de 10 a 400 caracteres)');
    return this.whats.completarM6(user.orgId, id, r.data.novidade);
  }
}
