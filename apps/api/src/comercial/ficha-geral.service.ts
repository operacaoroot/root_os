import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import {
  CANAIS_ACEITOS_NA_FICHA,
  FichaGeralPatchSchema,
  NotaManualSchema,
  type FichaDoLead,
  type FichaGeralExtra,
  type FichaGeralPatch,
  type PendenciasDoLead,
  type PropostaNaFichaGeral,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { decisaoSemPrazo } from './decisoes.service';
import { FichaService } from './ficha.service';
import { FioService } from './fio.service';
import { passosDoLead, type FatoParaOsPassos } from './pendencias-do-lead';

/*
 * A FICHA GERAL E AS PENDÊNCIAS DO LEAD (leva 5, L4, 27/10/2026).
 *
 * A aba Geral do painel lê a ficha de sempre (`GET /comercial/lead/:id`) e, a
 * mais, o que esta rodada acrescentou (`GET .../geral`): tipo de pessoa,
 * preferências de atendimento, a 1ª parcela, o link da proposta. Edita por UMA
 * rota (`PATCH .../ficha`), que despacha cada campo para o caminho que já
 * existia quando ele existia:
 *
 *   · nome e empresa → `FichaService.editarIdentidade` (fato `identidade.editada`);
 *   · tipo do negócio → `definirTipoDoNegocio` (fato `negocio.tipo_definido`);
 *   · valor negociado, vendedor e canal → `ajustarNegocio` (fato `negocio.ajustado`);
 *   · e-mail → `Lead.email`, direto e auditado (o `PATCH /leads/:id` passa pelo
 *     `ApprovalGuard`, como o telefone, que já tem rota própria no WhatsApp);
 *   · o resto (tipo de pessoa, preferências, origem da indicação, sócio
 *     responsável, produto, parcelas, 1ª parcela, link da proposta) → a ficha,
 *     numa transação com a linha de auditoria `comercial.ficha.editada` (antes e
 *     depois, só dos campos que mudaram).
 *
 * A etapa e a próxima ação NÃO passam por aqui: a etapa é `POST .../mover`, e a
 * régua protege `proximaAcao*`. Depois do aceite (`propostaAceitaEm`), produto,
 * parcelas e 1ª parcela são do contrato e a rota recusa mudá-los (409).
 *
 * Só gente: a conta de máquina cai no `SoGenteGuard` (token) e aqui, na
 * releitura do banco (ativa, desta empresa, com `leads.editar` agora).
 */

const RECUSA_DE_MAQUINA = 'Editar a ficha é de gente: conta de serviço (IA) não escreve na ficha do lead.';
export const NEGOCIO_TRAVADO = 'Depois do aceite, produto, parcelas e 1ª parcela são do contrato: ajuste pela aba Dinheiro.';

type Quem = { id: string; nome: string | null; papeis: readonly string[] };

/** Os campos da ficha que esta rota escreve direto (os outros vão pelos fatos do fio). */
type CampoDireto = 'tipoDePessoa' | 'preferenciasDeAtendimento' | 'origemIndicacao' | 'socioDaConta' | 'produto' | 'parcelas' | 'parcelaCentavos' | 'linkDaProposta';
const CAMPOS_DIRETOS: readonly CampoDireto[] = ['tipoDePessoa', 'preferenciasDeAtendimento', 'origemIndicacao', 'socioDaConta', 'produto', 'parcelas', 'parcelaCentavos', 'linkDaProposta'];
const CAMPOS_DO_CONTRATO: readonly CampoDireto[] = ['produto', 'parcelas', 'parcelaCentavos'];

/** Os fatos do fio que a aba Pendências lê para achar pendência (e a nota que esconde o passo). */
const FATOS_DE_PENDENCIA = ['fechamento.escrita', 'pasta.do_cliente', 'documento.na_pasta', 'cliente.a_conciliar', 'implantacao.fechamento_registrado', 'cliente.ativo'];

@Injectable()
export class FichaGeralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichaService,
    private readonly fio: FioService,
  ) {}

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  private async exigirGente(orgId: string, quem: Quem): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem edita precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
  }

  private async propostaDaFicha(orgId: string, leadId: string, ficha: { linkDaProposta: string | null; propostaVersao: number }): Promise<PropostaNaFichaGeral> {
    const vinculo = await this.prisma.propostaDoLead.findFirst({ where: { orgId, leadId }, orderBy: { criadoEm: 'desc' }, select: { proposta: true } });
    const versao = ficha.propostaVersao > 0 ? ficha.propostaVersao : null;
    const origem = ficha.linkDaProposta ? 'manual' : vinculo ? 'servico' : versao ? 'sala' : null;
    return { origem, link: ficha.linkDaProposta ?? null, ref: vinculo?.proposta ?? null, versao };
  }

  /** O que a aba Geral lê a mais da ficha. */
  async extra(orgId: string, leadId: string): Promise<FichaGeralExtra> {
    const ficha = await this.fichas.garantir(orgId, leadId);
    return {
      leadId,
      tipoDePessoa: ficha.tipoDePessoa === 'PJ' || ficha.tipoDePessoa === 'PF' ? ficha.tipoDePessoa : null,
      preferenciasDeAtendimento: ficha.preferenciasDeAtendimento ?? null,
      parcelaCentavos: ficha.parcelaCentavos ?? null,
      proposta: await this.propostaDaFicha(orgId, leadId, ficha),
      negocioTravado: !!ficha.propostaAceitaEm,
    };
  }

  private corpo(corpo: unknown): FichaGeralPatch {
    const r = FichaGeralPatchSchema.safeParse(corpo);
    if (!r.success) {
      throw new BadRequestException({ message: r.error.issues[0]?.message ?? 'Ficha inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (Object.keys(r.data).length === 0) throw new BadRequestException('Diga o que mudar na ficha.');
    return r.data;
  }

  /**
   * Edita a ficha geral. Cada campo vai pelo seu caminho (ver o cabeçalho); o
   * que mudou direto na ficha ganha uma linha de auditoria com antes e depois.
   * Devolve a ficha projetada e o extra, para a tela não reler duas vezes.
   */
  async editar(orgId: string, leadId: string, corpo: unknown, quem: Quem, agora = new Date()): Promise<{ ficha: FichaDoLead; extra: FichaGeralExtra }> {
    const e = this.corpo(corpo);
    await this.exigirGente(orgId, quem);
    const por = { id: quem.id, nome: quem.nome };
    const ficha = await this.fichas.garantir(orgId, leadId);

    // 1. Os campos que já tinham fato próprio no fio seguem por ele.
    if (e.nome !== undefined || e.empresa !== undefined) {
      await this.fichas.editarIdentidade(orgId, leadId, { ...(e.nome !== undefined ? { nome: e.nome } : {}), ...(e.empresa !== undefined ? { empresa: e.empresa } : {}) }, por, agora);
    }
    if (e.tipoNegocio !== undefined) await this.fichas.definirTipoDoNegocio(orgId, leadId, { tipo: e.tipoNegocio }, por, agora);
    if (e.valorNegociado !== undefined || e.vendedorId !== undefined || e.canal !== undefined) {
      if (e.canal && !CANAIS_ACEITOS_NA_FICHA.includes(e.canal)) throw new BadRequestException(`Canal inválido: use ${CANAIS_ACEITOS_NA_FICHA.join(', ')}.`);
      await this.fichas.ajustarNegocio(
        orgId,
        leadId,
        { ...(e.valorNegociado !== undefined ? { valorNegociado: e.valorNegociado } : {}), ...(e.vendedorId !== undefined ? { vendedorId: e.vendedorId } : {}), ...(e.canal !== undefined ? { canal: e.canal } : {}) },
        por,
        new Date(agora.getTime() + 1),
      );
    }

    // 2. O e-mail mora no Lead: escrita condicionada ao valor lido, auditada.
    if (e.email !== undefined) {
      const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { email: true } });
      if (!lead) throw new NotFoundException('Lead não encontrado.');
      if ((lead.email ?? null) !== e.email) {
        await this.prisma.$transaction(async (tx) => {
          const r = await tx.lead.updateMany({ where: { id: leadId, orgId, email: lead.email }, data: { email: e.email } });
          if (r.count !== 1) throw new ConflictException('O e-mail mudou enquanto você editava. Recarregue e tente de novo.');
          await tx.auditLog.create({
            data: {
              orgId, actorType: ActorType.user, actorId: quem.id, action: 'comercial.ficha.email', entityType: 'lead', entityId: leadId,
              before: { tinha: !!lead.email } as Prisma.InputJsonValue, after: { definido: !!e.email } as Prisma.InputJsonValue,
            },
          });
        });
      }
    }

    // 3. O resto é coluna da ficha: só o que mudou, numa transação com a auditoria (antes e depois).
    const pedido: Partial<Record<CampoDireto, string | number | null>> = {};
    if (e.tipoDePessoa !== undefined) pedido.tipoDePessoa = e.tipoDePessoa;
    if (e.preferenciasDeAtendimento !== undefined) pedido.preferenciasDeAtendimento = e.preferenciasDeAtendimento;
    if (e.origemIndicacao !== undefined) pedido.origemIndicacao = e.origemIndicacao;
    if (e.socioDaConta !== undefined) pedido.socioDaConta = e.socioDaConta;
    if (e.produto !== undefined) pedido.produto = e.produto;
    if (e.parcelas !== undefined) pedido.parcelas = e.parcelas;
    if (e.parcela !== undefined) pedido.parcelaCentavos = e.parcela == null ? null : Math.round(e.parcela * 100);
    if (e.linkDaProposta !== undefined) pedido.linkDaProposta = e.linkDaProposta;
    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    for (const campo of CAMPOS_DIRETOS) {
      if (!(campo in pedido)) continue;
      const atual = (ficha[campo] ?? null) as string | number | null;
      const novo = pedido[campo] ?? null;
      if (atual === novo) continue;
      if (CAMPOS_DO_CONTRATO.includes(campo) && ficha.propostaAceitaEm) throw new ConflictException(NEGOCIO_TRAVADO);
      antes[campo] = atual;
      depois[campo] = novo;
    }
    if (Object.keys(depois).length) {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.comercialFicha.updateMany({ where: { id: ficha.id, orgId, atualizadoEm: ficha.atualizadoEm }, data: depois as Prisma.ComercialFichaUpdateManyMutationInput });
        if (r.count !== 1) {
          // Os fatos do passo 1 já mexeram na ficha (o `@updatedAt` andou): relê e aplica sobre o que está lá.
          const relida = await tx.comercialFicha.findFirst({ where: { id: ficha.id, orgId }, select: { id: true } });
          if (!relida) throw new NotFoundException('Ficha do lead não encontrada nesta empresa.');
          await tx.comercialFicha.update({ where: { id: ficha.id }, data: depois as Prisma.ComercialFichaUpdateInput });
        }
        await tx.auditLog.create({
          data: {
            orgId, actorType: ActorType.user, actorId: quem.id, action: 'comercial.ficha.editada', entityType: 'lead', entityId: leadId,
            before: antes as Prisma.InputJsonValue, after: depois as Prisma.InputJsonValue,
          },
        });
      });
    }

    return { ficha: await this.fichas.projecao(orgId, leadId), extra: await this.extra(orgId, leadId) };
  }

  /** A aba "Pendências e sugestões": os próximos passos, menos os marcados como feitos. */
  async pendencias(orgId: string, leadId: string, agora = new Date()): Promise<PendenciasDoLead> {
    const ficha = await this.fichas.projecao(orgId, leadId);
    const [decisoes, reacoes, fatos, notas] = await Promise.all([
      this.prisma.comercialDecisao.findMany({ where: { leadId, orgId, estado: 'aberta' }, select: { id: true, titulo: true, expiraEm: true, criadoEm: true } }),
      this.prisma.comercialReacao.findMany({ where: { leadId, orgId, estado: 'erro' }, orderBy: { criadoEm: 'desc' }, take: 50, select: { eventoId: true, reacao: true, erro: true, criadoEm: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: { in: FATOS_DE_PENDENCIA } }, orderBy: { occurredAt: 'asc' }, take: 300, select: { type: true, payload: true, occurredAt: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'nota.manual' }, orderBy: { occurredAt: 'desc' }, take: 300, select: { payload: true, occurredAt: true } }),
    ]);
    const tiposDosEventos = reacoes.length
      ? new Map((await this.prisma.leadEvent.findMany({ where: { id: { in: reacoes.map((r) => r.eventoId) }, orgId }, select: { id: true, type: true } })).map((e) => [e.id, e.type]))
      : new Map<string, string>();
    const { passos, feitos } = passosDoLead({
      ficha,
      agora,
      decisoes: decisoes.map((d) => ({ id: d.id, titulo: d.titulo, expiraEm: decisaoSemPrazo(d.expiraEm) ? null : d.expiraEm, criadaEm: d.criadoEm })),
      reacoesComErro: reacoes.map((r) => ({ eventoId: r.eventoId, reacao: r.reacao, erro: r.erro, criadoEm: r.criadoEm, tipoDoEvento: tiposDosEventos.get(r.eventoId) ?? null })),
      fatos: fatos as FatoParaOsPassos[],
      notas: notas.map((n) => ({ feito: typeof (n.payload as { feito?: unknown } | null)?.feito === 'string' ? ((n.payload as { feito: string }).feito) : null, occurredAt: n.occurredAt })),
    });
    return { leadId, etapa: ficha.etapa, passos, feitos, geradoEm: agora.toISOString() };
  }

  /**
   * A nota manual no fio (`nota.manual`): o texto da pessoa e, quando marca um
   * passo como feito, a chave dele. Sem reação. Auditada sem o texto (ele mora no fio).
   */
  async nota(orgId: string, leadId: string, corpo: unknown, quem: Quem, agora = new Date()): Promise<{ eventoId: string; novo: boolean }> {
    const r = NotaManualSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException({ message: r.error.issues[0]?.message ?? 'Nota inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    await this.exigirGente(orgId, quem);
    await this.fichas.garantir(orgId, leadId);
    const feito = r.data.feito ?? null;
    const gravado = await this.fio.registrar(
      orgId,
      leadId,
      'nota.manual',
      `${agora.getTime()}:${feito ?? ''}`,
      { texto: r.data.texto, feito, referencia: r.data.referencia ?? null, por: quem.nome ?? quem.id, porId: quem.id },
      { em: agora },
    );
    if (gravado.novo) {
      await this.prisma.auditLog.create({
        data: {
          orgId, actorType: ActorType.user, actorId: quem.id, action: feito ? 'comercial.fio.passo_feito' : 'comercial.fio.nota', entityType: 'lead', entityId: leadId,
          after: { eventoId: gravado.eventoId, feito, caracteres: r.data.texto.length } as Prisma.InputJsonValue,
        },
      });
    }
    return gravado;
  }
}
