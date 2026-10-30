import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  SOCIOS_DA_AGENDA,
  type ConfirmacaoDoConvite,
  type EstadoDoConvitePublico,
  type NovoConviteDeAgenda,
  type SocioDaAgenda,
} from '@mktos/shared';
import type { AgendaConvite } from '@prisma/client';

import { comTenantPublico } from '../../common/tenant-publico';
import { PrismaService } from '../../prisma/prisma.service';
import { EscritaDaAgendaService, chaveDerivada } from '../escrita/escrita.service';
import { eventoIdDaChave } from '../escrita/escrita-pura';
import { ReguaService } from '../regua/regua.service';
import {
  conviteAbre,
  diaEmSaoPaulo,
  empresaDoToken,
  gerarTokenDoConvite,
  hashDoConvite,
  icsDoConvite,
  instanteEmSaoPaulo,
  primeiroNome,
  somarDias,
  validadeDoConvite,
} from './convite-puro';

/*
 * O LINK DE ESCOLHA (agenda v2, 29/10/2026, lane G6).
 *
 * Quem é da casa cria um convite (`POST /agenda/convites`) e manda o link ao
 * cliente; o cliente abre `/agendar/<token>` sem login, vê SÓ horários verdes da
 * régua (`ReguaService.livres`, próximos 14 dias: nenhum título, nenhum nome de
 * outro cliente) e confirma um. Confirmar marca o convite como usado numa
 * escrita condicionada (dois cliques = um uso) e pede o `marcar` pela porta como
 * SISTEMA (`link-de-escolha`), SEM `naTela`: R2 fica na fila, e é a confirmação
 * de uma pessoa da casa que solta o convite do Google para o cliente.
 *
 * Token errado, vencido, revogado ou usado sem escolha respondem o MESMO 404.
 * A empresa sai do token e o resto roda dentro dela (`comTenantPublico`); ver
 * `convite-puro.ts` sobre por que a empresa viaja no token.
 */

const NAO_ENCONTRADO = 'link não encontrado.';
const DIAS_DO_LINK = 14;
export const AGENTE_DO_LINK = 'link-de-escolha';

const NovoConviteSchema = z.object({
  socio: z.enum(SOCIOS_DA_AGENDA as unknown as [SocioDaAgenda, ...SocioDaAgenda[]]),
  tipo: z.enum(['cliente', 'interna']),
  modalidade: z.enum(['online', 'presencial']),
  duracaoMin: z.number().int().min(5).max(600),
  leadId: z.string().min(1).max(64).optional(),
  clienteId: z.string().min(1).max(64).optional(),
  validadeDias: z.number().int().min(1).max(30).optional(),
}).strict();

const ConfirmacaoSchema = z.object({
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  nome: z.string().trim().max(120).optional(),
}).strict();

export interface ConviteDaLista {
  id: string;
  socio: string;
  tipo: string;
  modalidade: string;
  duracaoMin: number;
  nome: string | null;
  leadId: string | null;
  clienteId: string | null;
  validoAte: string;
  criadoEm: string;
  usadoEm: string | null;
  escolhido: { inicio: string; fim: string } | null;
  approvalId: string | null;
  eventoId: string | null;
  revogadoEm: string | null;
  estado: 'aberto' | 'escolhido' | 'vencido' | 'revogado';
}

export interface RespostaDaConfirmacao extends EstadoDoConvitePublico {
  mensagem: string;
}

/** A base do link público (a mesma da sala do cliente). */
export function baseDoLinkDeEscolha(): string {
  return (process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
}

@Injectable()
export class ConviteDaAgendaService {
  private readonly log = new Logger('LinkDeEscolha');

  constructor(
    private readonly prisma: PrismaService,
    private readonly regua: ReguaService,
    private readonly escrita: EscritaDaAgendaService,
  ) {}

  /* -------------------------------------------------------------------------
   * Dentro da casa
   * ----------------------------------------------------------------------- */

  async criar(orgId: string, criadoPorId: string, corpo: NovoConviteDeAgenda | unknown, agora = new Date()): Promise<{ id: string; url: string; validoAte: string }> {
    const lido = NovoConviteSchema.safeParse(corpo);
    if (!lido.success) {
      throw new BadRequestException({ message: 'Convite inválido.', erros: lido.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const c = lido.data;
    let nome: string | null = null;
    if (c.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: c.leadId, orgId }, select: { name: true } });
      if (!lead) throw new BadRequestException('Esse lead não existe nesta empresa.');
      nome = primeiroNome(lead.name);
    }
    if (c.clienteId) {
      const cliente = await this.prisma.partner.findFirst({ where: { id: c.clienteId, orgId }, select: { id: true } });
      if (!cliente) throw new BadRequestException('Esse cliente não existe nesta empresa.');
    }
    const { token, hash } = gerarTokenDoConvite(orgId);
    const validoAte = validadeDoConvite(agora, c.validadeDias);
    const criado = await this.prisma.agendaConvite.create({
      data: {
        orgId,
        tokenHash: hash,
        socio: c.socio,
        tipo: c.tipo,
        modalidade: c.modalidade,
        duracaoMin: c.duracaoMin,
        leadId: c.leadId ?? null,
        clienteId: c.clienteId ?? null,
        nome,
        validoAte,
        criadoPorId,
      },
      select: { id: true },
    });
    // O token cru sai SÓ nesta resposta: o banco guarda o hash.
    return { id: criado.id, url: `${baseDoLinkDeEscolha()}/agendar/${token}`, validoAte: validoAte.toISOString() };
  }

  async listar(orgId: string, agora = new Date()): Promise<ConviteDaLista[]> {
    const linhas = await this.prisma.agendaConvite.findMany({ where: { orgId }, orderBy: { criadoEm: 'desc' }, take: 100 });
    return linhas.map((c) => ({
      id: c.id,
      socio: c.socio,
      tipo: c.tipo,
      modalidade: c.modalidade,
      duracaoMin: c.duracaoMin,
      nome: c.nome,
      leadId: c.leadId,
      clienteId: c.clienteId,
      validoAte: c.validoAte.toISOString(),
      criadoEm: c.criadoEm.toISOString(),
      usadoEm: c.usadoEm?.toISOString() ?? null,
      escolhido: c.escolhidoInicio && c.escolhidoFim ? { inicio: c.escolhidoInicio.toISOString(), fim: c.escolhidoFim.toISOString() } : null,
      approvalId: c.approvalId,
      eventoId: c.eventoId,
      revogadoEm: c.revogadoEm?.toISOString() ?? null,
      estado: c.revogadoEm ? 'revogado' : c.escolhidoInicio ? 'escolhido' : c.validoAte <= agora ? 'vencido' : 'aberto',
    }));
  }

  /** Revoga um convite ainda sem escolha. O link passa a responder 404. */
  async revogar(orgId: string, id: string, agora = new Date()): Promise<{ ok: true }> {
    const r = await this.prisma.agendaConvite.updateMany({
      where: { id, orgId, revogadoEm: null, usadoEm: null },
      data: { revogadoEm: agora },
    });
    if (r.count === 0) throw new ConflictException('Esse convite já foi usado, revogado ou não existe.');
    return { ok: true };
  }

  /* -------------------------------------------------------------------------
   * A página pública
   * ----------------------------------------------------------------------- */

  /** A empresa do token e o convite, dentro dela. Qualquer falha é o MESMO 404. */
  private async resolver(token: string, agora: Date): Promise<{ orgId: string; convite: AgendaConvite }> {
    const orgId = empresaDoToken(token);
    if (!orgId) throw new NotFoundException(NAO_ENCONTRADO);
    const hash = hashDoConvite(token);
    const convite = await comTenantPublico(orgId, () =>
      this.prisma.agendaConvite.findFirst({ where: { tokenHash: hash, orgId } }),
    ).catch(() => null);
    if (!convite || convite.orgId !== orgId || !conviteAbre(convite, agora)) throw new NotFoundException(NAO_ENCONTRADO);
    return { orgId, convite };
  }

  private async diasLivres(orgId: string, c: AgendaConvite, agora: Date) {
    const hoje = diaEmSaoPaulo(agora);
    return this.regua.livres(
      orgId,
      {
        socio: c.socio as SocioDaAgenda,
        tipo: c.tipo === 'interna' ? 'interna' : 'cliente',
        modalidade: c.modalidade === 'presencial' ? 'presencial' : 'online',
        duracaoMin: c.duracaoMin,
        de: hoje,
        ate: somarDias(hoje, DIAS_DO_LINK),
      },
      agora,
    );
  }

  private estadoDe(c: AgendaConvite, dias: EstadoDoConvitePublico['dias']): EstadoDoConvitePublico {
    return {
      socio: c.socio as SocioDaAgenda,
      modalidade: c.modalidade === 'presencial' ? 'presencial' : 'online',
      duracaoMin: c.duracaoMin,
      nome: c.nome,
      emailObrigatorio: c.modalidade !== 'presencial',
      dias,
      validoAte: c.validoAte.toISOString(),
      escolhido: c.escolhidoInicio && c.escolhidoFim ? { inicio: c.escolhidoInicio.toISOString(), fim: c.escolhidoFim.toISOString() } : null,
    };
  }

  async estadoPublico(token: string, agora = new Date()): Promise<EstadoDoConvitePublico> {
    const { orgId, convite } = await this.resolver(token, agora);
    return comTenantPublico(orgId, async () => {
      // Já escolhido: a página mostra o horário, e nenhum outro.
      const dias = convite.escolhidoInicio ? [] : await this.diasLivres(orgId, convite, agora);
      return this.estadoDe(convite, dias);
    });
  }

  async confirmar(token: string, corpo: ConfirmacaoDoConvite | unknown, agora = new Date()): Promise<RespostaDaConfirmacao> {
    const { orgId, convite } = await this.resolver(token, agora);
    const lido = ConfirmacaoSchema.safeParse(corpo);
    if (!lido.success) throw new BadRequestException('Escolha o dia e o horário.');
    const pedido = lido.data;
    if (convite.usadoEm) throw new ConflictException('Este link já foi usado. Se precisar mudar o horário, fale com a Root.');
    if (convite.modalidade !== 'presencial' && !pedido.email) {
      throw new BadRequestException('Diga o seu e-mail: o convite com o link do Meet vai para ele.');
    }
    const inicio = instanteEmSaoPaulo(pedido.dia, pedido.hora);
    if (!inicio) throw new BadRequestException('Escolha o dia e o horário.');
    const fim = new Date(inicio.getTime() + convite.duracaoMin * 60_000);

    return comTenantPublico(orgId, async () => {
      // O horário ainda é verde? (pode ter sido tomado entre abrir a página e confirmar)
      const dias = await this.diasLivres(orgId, convite, agora);
      const dia = dias.find((d) => d.dia === pedido.dia);
      if (!dia || ![...dia.manha, ...dia.tarde].includes(pedido.hora)) {
        throw new ConflictException('Esse horário não está mais livre. Escolha outro.');
      }

      // UM uso: a escrita condicionada decide quem leva (o segundo clique encontra zero linhas).
      const tomado = await this.prisma.agendaConvite.updateMany({
        where: { id: convite.id, orgId, usadoEm: null, revogadoEm: null, validoAte: { gt: agora } },
        data: { usadoEm: agora, escolhidoInicio: inicio, escolhidoFim: fim, emailInformado: pedido.email ?? null },
      });
      if (tomado.count === 0) throw new ConflictException('Este link já foi usado. Se precisar mudar o horário, fale com a Root.');

      const cliente = await this.nomeDoCliente(orgId, convite, pedido.nome);
      const chave = chaveDerivada(`convite:${convite.id}`);
      let r;
      try {
        r = await this.escrita.executar(
          { orgId, actorType: 'system', actorId: AGENTE_DO_LINK, agentSlug: AGENTE_DO_LINK },
          {
            acao: 'marcar',
            chave,
            compromisso: {
              tipo: convite.tipo === 'interna' ? 'interna' : 'cliente',
              modalidade: convite.modalidade === 'presencial' ? 'presencial' : 'online',
              ...(convite.tipo !== 'interna' ? { cliente } : {}),
              ...(convite.leadId ? { leadId: convite.leadId } : {}),
              ...(convite.clienteId ? { clienteId: convite.clienteId } : {}),
              responsaveis: [convite.socio as SocioDaAgenda],
              inicio: inicio.toISOString(),
              fim: fim.toISOString(),
              ...(pedido.email ? { convidados: [pedido.email] } : {}),
              pauta: 'Horário escolhido pelo link de escolha da Root.',
            },
          },
        );
      } catch (e) {
        await this.devolverUso(convite.id, orgId, agora);
        throw e;
      }
      if (r.status === 'recusado') {
        await this.devolverUso(convite.id, orgId, agora);
        this.log.warn(`link de escolha ${convite.id}: a escrita foi recusada (${r.mensagem})`);
        throw new ConflictException('Esse horário não está mais livre. Escolha outro.');
      }
      await this.prisma.agendaConvite.updateMany({
        where: { id: convite.id, orgId },
        data: { approvalId: r.approvalId, eventoId: r.eventoId ?? eventoIdDaChave(orgId, chave) },
      });
      const atualizado = { ...convite, usadoEm: agora, escolhidoInicio: inicio, escolhidoFim: fim };
      return {
        ...this.estadoDe(atualizado, []),
        mensagem: r.status === 'executado'
          ? 'Horário marcado. O convite com o link do Meet chega no seu e-mail.'
          : 'Horário reservado. O convite com o link do Meet chega no seu e-mail assim que a Root confirmar.',
      };
    });
  }

  /** O `.ics` do horário escolhido (o mesmo 404 sem escolha). */
  async ics(token: string, agora = new Date()): Promise<string> {
    const { convite } = await this.resolver(token, agora);
    if (!convite.escolhidoInicio || !convite.escolhidoFim) throw new NotFoundException(NAO_ENCONTRADO);
    const online = convite.modalidade !== 'presencial';
    return icsDoConvite({
      uid: `${convite.id}@agenda.operacaoroot`,
      inicio: convite.escolhidoInicio,
      fim: convite.escolhidoFim,
      titulo: `Reunião ${online ? 'online' : 'presencial'} com ${convite.socio} · Root`,
      descricao: online
        ? 'O convite do Google com o link do Meet chega no seu e-mail.'
        : 'O endereço chega no convite do Google, no seu e-mail.',
      agora,
    });
  }

  /** Desfaz o uso que esta própria chamada marcou (a escrita não saiu): o cliente pode escolher de novo. */
  private async devolverUso(id: string, orgId: string, agora: Date): Promise<void> {
    await this.prisma.agendaConvite
      .updateMany({
        where: { id, orgId, usadoEm: agora, approvalId: null, eventoId: null },
        data: { usadoEm: null, escolhidoInicio: null, escolhidoFim: null, emailInformado: null },
      })
      .catch((e) => this.log.error(`link de escolha ${id}: não deu para devolver o uso (${(e as Error).message})`));
  }

  /** O nome que o título leva: o do lead ou do cliente; senão o que a pessoa escreveu. Nunca inventado. */
  private async nomeDoCliente(orgId: string, c: AgendaConvite, digitado?: string): Promise<string> {
    if (c.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: c.leadId, orgId }, select: { name: true } });
      if (lead?.name?.trim()) return lead.name.trim().slice(0, 120);
    }
    if (c.clienteId) {
      const p = await this.prisma.partner.findFirst({ where: { id: c.clienteId, orgId }, select: { nomeFantasia: true, razaoSocial: true } });
      const n = p?.nomeFantasia?.trim() || p?.razaoSocial?.trim();
      if (n) return n.slice(0, 120);
    }
    const n = digitado?.replace(/\s+/g, ' ').trim();
    return n ? n.slice(0, 120) : 'Convidado pelo link';
  }
}
