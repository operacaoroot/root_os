import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, RiskLevel } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';
import { comContexto, correlacaoAtual, novaCorrelacao } from '../common/contexto-execucao';
import { ToolGateway, type ExecCtx } from '../gateway/tool-gateway.service';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { EventLogService } from '../gateway/event-log.service';
import { FILA_DE_APROVACAO } from '../gateway/fila-de-aprovacao';
import { ProcedenciaExterna } from '../policy/sinais.service';
import { temPapelDeMaquina } from '../approvals/alcada';
import { recusaPorEstado } from '../agents/estado-do-agente';
import { mesmoTelefone } from '../work/agente-de-tarefas/pedido-do-grupo';

/*
 * ============================================================================
 * A ROTA DE EXECUÇÃO DO AGENTE EXTERNO (A2, 30/10/2026)
 * ============================================================================
 *
 * A Rootinha roda FORA do OS (no Hermes Agent). Ela não tem laço aqui dentro:
 * quem decide qual ferramenta chamar é o modelo dela, lá. O que o OS oferece é
 * UMA porta por capacidade — `POST /agents/:slug/capacidades/:id/executar` — e
 * este serviço é o que fica entre a requisição e o `ToolGateway`.
 *
 * NÃO É UM SEGUNDO CAMINHO DE EXECUÇÃO. Ele faz o que o `AgentRuntime` faz
 * antes de cada chamada de ferramenta — e mais nada:
 *
 *   1. acha o agente NESTA empresa pelo slug, e recusa o que o laço recusaria:
 *      estado que não trabalha (pausado, encerrado, planejado), interruptor
 *      `ativo` desligado, nenhuma capacidade declarada. A recusa entra no
 *      RASTRO com a mesma causa da recusa de passagem do laço;
 *   2. monta o `ExecCtx` como o laço monta: `actorType: ai`, `agentSlug`,
 *      `capacidadesDeclaradas` LIDAS DO REGISTRO `Agent` (nunca do corpo),
 *      e o teto de momento quando o agente está rebaixado (RF-N-07);
 *   3. entrega à porta, com o efeito do REGISTRO — o mesmo que
 *      `AcoesService` vai disparar se a ação for retida e aprovada.
 *
 * O resto é da porta, e é por isso que ela existe: fora da declaração,
 * argumento inválido, conector desligado, teto de custo da empresa no dia,
 * régua, retenção e o RASTRO de cada desfecho.
 *
 * ----------------------------------------------------------------------------
 * QUEM PROPÕE É O AGENTE — e é isso que deixa qualquer sócio confirmar
 * ----------------------------------------------------------------------------
 * `actorId` é o SLUG do agente, não a pessoa que pediu. A aprovação retida
 * grava `propostoPorId = "rootinha"`, e a invariante 7 ("quem propõe não
 * confirma") não tira ninguém da lista de quem pode assinar: Pedro, Lucas ou
 * Rodrigo, com alçada, confirmam — inclusive quem pediu. É a escolha do vigia
 * da agenda (AG-01), e é diferente do laço interno, onde o ator é quem pediu
 * (`AgentRuntime.executar`: `actorId: solicitanteId ?? slug`) e por isso quem
 * pediu não assina. A pessoa vai em `solicitanteId`, que o efeito usa para
 * escrever em nome dela (a tarefa, o comentário) e que o RASTRO guarda no
 * evento `agente.externo.pedido`, na mesma correlação da proposta.
 *
 * ----------------------------------------------------------------------------
 * A MARCA DE FORA (RF-G-07) É DE MÃO ÚNICA — e o OS confere por conta própria
 * ----------------------------------------------------------------------------
 * O corpo pode dizer `procedenciaExterna: true` (o pedido veio de mensagem de
 * terceiro), e isso sobe um degrau na régua. O corpo NÃO consegue desmarcar:
 * quando ele aponta a mensagem de origem (`origem.mensagemId`), o OS lê a
 * mensagem gravada e marca sozinho se quem escreveu não é pessoa da equipe —
 * ou se a mensagem não existe nesta empresa. O Hermes pode errar ou ser
 * enganado; a mensagem gravada, não.
 */

/** O degrau máximo de um agente rebaixado — o mesmo `TETO_DO_REBAIXADO` do laço (RF-N-07). */
const TETO_DO_REBAIXADO: RiskLevel = RiskLevel.R1;

export const PedidoExternoSchema = z
  .object({
    /** Os argumentos da capacidade, exatamente como o catálogo os descreve. */
    args: z.record(z.unknown()).default({}),
    /** A pessoa da equipe que pediu. Sem ela, vale a pessoa do corpo (o token). */
    solicitanteId: z.string().uuid().optional(),
    /** O pedido veio de texto de terceiro (cliente, grupo). Só marca; nunca desmarca. */
    procedenciaExterna: z.boolean().optional(),
    origem: z
      .object({
        canal: z.enum(['whatsapp', 'mcp', 'outro']),
        /** O id (da Evolution) da mensagem que pediu: o OS confere quem escreveu. */
        mensagemId: z.string().regex(/^[A-Za-z0-9_:.-]{1,200}$/).optional(),
        descricao: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PedidoExterno = z.infer<typeof PedidoExternoSchema>;

/** Quem bateu na rota: a pessoa do JWT (console) ou o corpo do token (A4). */
export interface ChamadorExterno {
  orgId: string;
  /** A pessoa que vale quando o corpo do pedido não diz quem pediu. */
  solicitantePadraoId: string | null;
  /** O corpo autenticado (A4), quando a chamada veio com token de corpo. */
  corpo?: { id: string; nome: string; agentSlug: string } | null;
}

export type DesfechoExterno =
  | { status: 'executado'; capacidade: string; nivel: string; resultado: unknown; toolCallId: string; correlationId: string }
  | {
      status: 'aguardando_aprovacao';
      capacidade: string;
      nivel: string;
      approvalId: string;
      resumo: string;
      expiraEm: string;
      toolCallId: string;
      correlationId: string;
      mensagem: string;
      fila: string;
    }
  | { status: 'recusado'; capacidade: string; motivo: string; causa?: string; nivel?: string; toolCallId?: string; correlationId: string }
  | { status: 'erro'; capacidade: string; mensagem: string; toolCallId: string; correlationId: string };

@Injectable()
export class ExecucaoExternaService {
  private readonly log = new Logger('ExecucaoExterna');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ToolGateway,
    private readonly efeitos: EfeitosRegistry,
    private readonly eventos: EventLogService,
  ) {}

  async executar(
    chamador: ChamadorExterno,
    agentSlug: string,
    capabilityId: string,
    corpoBruto: unknown,
  ): Promise<DesfechoExterno> {
    const pedido = PedidoExternoSchema.parse(corpoBruto ?? {});
    const orgId = chamador.orgId;
    const correlationId = correlacaoAtual() ?? novaCorrelacao('externo');

    if (chamador.corpo && chamador.corpo.agentSlug !== agentSlug) {
      // O token é de UM agente. Rota de outro agente com ele é recusa, sem pista de quem existe.
      throw new NotFoundException('Agente não encontrado.');
    }

    return comContexto(
      { orgId, actorType: ActorType.ai, actorId: agentSlug, agentSlug, correlationId, origem: 'agente' },
      async () => {
        const agente = await this.prisma.agent.findFirst({
          where: { orgId, slug: agentSlug },
          select: { slug: true, estado: true, ativo: true, capacidades: true, rebaixadoAte: true },
        });
        if (!agente) throw new NotFoundException('Agente não encontrado.');

        const solicitante = await this.solicitante(orgId, pedido, chamador);
        const procedencia = await this.procedencia(orgId, pedido);

        await this.registrarPedido(orgId, agentSlug, capabilityId, correlationId, solicitante.id, procedencia, chamador, pedido);

        // 1. O que o laço recusaria antes de chamar o modelo, com a MESMA causa.
        const impedimento =
          recusaPorEstado(agente.estado) ??
          (!agente.ativo ? { causa: 'agente_desativado', motivo: 'Agente desativado.' } : null) ??
          (agente.capacidades.length === 0
            ? { causa: 'agente_sem_capacidade', motivo: 'Agente sem capacidade declarada: começa sem permissão nenhuma, por desenho.' }
            : null);
        if (impedimento) {
          await this.registrarRecusa(orgId, agentSlug, capabilityId, correlationId, impedimento, solicitante.id);
          return { status: 'recusado', capacidade: capabilityId, motivo: impedimento.motivo, causa: impedimento.causa, correlationId };
        }

        /*
         * 2. CAPACIDADE DECLARADA E SEM EFEITO LIGADO: recusa antes da porta.
         * Deixar a porta classificar e reter produziria uma aprovação que ninguém
         * consegue executar (o mesmo motivo da `PortaDoOperador`). Fora da
         * declaração NÃO entra aqui: essa recusa é da porta, com causa própria.
         */
        if (agente.capacidades.includes(capabilityId) && !this.efeitos.tem(capabilityId)) {
          const motivo = `"${capabilityId}" está declarada para ${agentSlug}, mas não tem efeito ligado nesta versão. Nada foi feito.`;
          await this.registrarRecusa(orgId, agentSlug, capabilityId, correlationId, { causa: 'sem_efeito', motivo }, solicitante.id);
          return { status: 'recusado', capacidade: capabilityId, motivo, causa: 'sem_efeito', correlationId };
        }

        const ctx: ExecCtx = {
          orgId,
          actorType: ActorType.ai,
          actorId: agentSlug,
          agentSlug,
          correlationId,
          procedenciaExterna: procedencia,
          capacidadesDeclaradas: agente.capacidades,
          tetoDoAgente:
            agente.rebaixadoAte && agente.rebaixadoAte.getTime() > Date.now()
              ? {
                  nivel: TETO_DO_REBAIXADO,
                  motivo: `autonomia do agente rebaixada até ${agente.rebaixadoAte.toLocaleString('pt-BR')} depois de duas falhas seguidas (RF-N-07)`,
                }
              : null,
        };

        /*
         * 3. A PORTA. O efeito vem do REGISTRO, com a pessoa que pediu e a marca
         * de fora no contexto do efeito: é o que deixa a tarefa nascer no nome
         * certo e a invocação de outro agente levar a marca adiante.
         *
         * SEM ARGUMENTO DE TIPO EXPLÍCITO na chamada da porta: a catraca de
         * arquitetura reconhece o caminho legítimo procurando `this.<prop>.executar(`.
         */
        const r = await this.gateway.executar(
          { capabilityId, args: pedido.args, ctx },
          (args, c) =>
            this.efeitos.executar(capabilityId, args, {
              orgId: c.orgId,
              actorType: c.actorType,
              actorId: c.actorId ?? null,
              agentSlug: c.agentSlug ?? null,
              correlationId: c.correlationId,
              solicitanteId: solicitante.id,
              pedidoDeFora: procedencia.eExterna,
              ...(c.loteItemId ? { loteItemId: c.loteItemId } : {}),
            }),
        );

        if (r.status === 'executado') {
          return { status: 'executado', capacidade: capabilityId, nivel: r.decisao.nivel, resultado: r.resultado, toolCallId: r.toolCallId, correlationId };
        }
        if (r.status === 'aguardando_aprovacao') {
          this.log.log(`${agentSlug}: ${capabilityId} retida (${r.decisao.nivel}) — aprovação ${r.approvalId}`);
          return {
            status: 'aguardando_aprovacao',
            capacidade: capabilityId,
            nivel: r.decisao.nivel,
            approvalId: r.approvalId,
            resumo: r.resumo,
            expiraEm: r.expiraEm,
            toolCallId: r.toolCallId,
            correlationId,
            mensagem:
              `Esta ação é ${r.decisao.nivel} e ficou retida: quem propôs foi o agente, e qualquer sócio com ` +
              'alçada confirma na fila ou no WhatsApp. Nada saiu ainda.',
            fila: FILA_DE_APROVACAO,
          };
        }
        if (r.status === 'recusado') {
          return { status: 'recusado', capacidade: capabilityId, motivo: r.motivo, nivel: r.decisao.nivel, toolCallId: r.toolCallId, correlationId };
        }
        return { status: 'erro', capacidade: capabilityId, mensagem: r.mensagem, toolCallId: r.toolCallId, correlationId };
      },
    );
  }

  /**
   * A pessoa que pediu, nesta ordem: quem escreveu a mensagem de origem, se for
   * da equipe (o OS sabe melhor que o corpo); o `solicitanteId` do corpo; a
   * pessoa padrão do chamador. Tem de ser usuário ATIVO desta empresa e gente.
   * `null` é aceito — as leituras não precisam de pessoa, e o efeito que precisa
   * recusa sozinho.
   */
  private async solicitante(orgId: string, pedido: PedidoExterno, chamador: ChamadorExterno): Promise<{ id: string | null }> {
    const daMensagem = pedido.origem?.mensagemId ? await this.pessoaDaMensagem(orgId, pedido.origem.mensagemId) : null;
    if (daMensagem) return { id: daMensagem };
    const candidato = pedido.solicitanteId ?? chamador.solicitantePadraoId;
    if (!candidato) return { id: null };
    const u = await this.prisma.user.findFirst({
      where: { id: candidato, orgId, isActive: true },
      select: { id: true, roles: { select: { key: true } } },
    });
    if (!u || temPapelDeMaquina(u.roles.map((r) => r.key))) {
      throw new BadRequestException('O solicitante não é uma pessoa ativa desta empresa. Nada foi feito.');
    }
    return { id: u.id };
  }

  /** O usuário da equipe que escreveu a mensagem gravada, ou `null`. */
  private async pessoaDaMensagem(orgId: string, mensagemId: string): Promise<string | null> {
    const m = await this.prisma.whatsAppMensagem.findFirst({
      where: { orgId, mensagemExternaId: mensagemId, deMim: false },
      select: { remetenteNumero: true },
    });
    if (!m?.remetenteNumero) return null;
    const equipe = await this.prisma.user.findMany({
      where: { orgId, isActive: true, phone: { not: null } },
      select: { id: true, phone: true, roles: { select: { key: true } } },
    });
    const achada = equipe.find((u) => mesmoTelefone(u.phone, m.remetenteNumero) && !temPapelDeMaquina(u.roles.map((r) => r.key)));
    return achada?.id ?? null;
  }

  /** A marca de fora: o que o corpo disse, MAIS o que a mensagem gravada mostra. Só sobe. */
  private async procedencia(orgId: string, pedido: PedidoExterno): Promise<ProcedenciaExterna> {
    const marca = new ProcedenciaExterna();
    if (pedido.procedenciaExterna) {
      marca.marcar(`o corpo externo disse que o pedido veio de texto de terceiro (${pedido.origem?.canal ?? 'canal não dito'})`);
    }
    const id = pedido.origem?.mensagemId;
    if (id) {
      const existe = await this.prisma.whatsAppMensagem.findFirst({
        where: { orgId, mensagemExternaId: id, deMim: false },
        select: { id: true },
      });
      if (!existe) marca.marcar('a mensagem de origem não está gravada nesta empresa');
      else if (!(await this.pessoaDaMensagem(orgId, id))) marca.marcar('quem escreveu a mensagem de origem não é pessoa da equipe');
    }
    return marca;
  }

  /**
   * O PEDIDO NO RASTRO, antes da porta e na MESMA correlação dela: quem pediu,
   * por qual corpo, de onde. A proposta da porta (`tool.proposta`) diz o que o
   * AGENTE pediu; esta linha diz em nome de quem e por qual caminho — as duas
   * juntas respondem "quem pôs a Rootinha para fazer isto".
   *
   * Falhar ao registrar NÃO libera nada: a porta registra a decisão dela de
   * qualquer jeito. O `catch` só grita.
   */
  private async registrarPedido(
    orgId: string,
    agentSlug: string,
    capabilityId: string,
    correlationId: string,
    solicitanteId: string | null,
    procedencia: ProcedenciaExterna,
    chamador: ChamadorExterno,
    pedido: PedidoExterno,
  ): Promise<void> {
    try {
      await this.eventos.registrar({
        orgId,
        tipo: 'agente.externo.pedido',
        actorType: ActorType.ai,
        actorId: agentSlug,
        agentSlug,
        capabilityId,
        correlationId,
        payload: {
          solicitanteId,
          corpo: chamador.corpo ? { id: chamador.corpo.id, nome: chamador.corpo.nome } : null,
          deFora: procedencia.eExterna,
          motivosDeFora: [...procedencia.motivos],
          origem: pedido.origem ? { canal: pedido.origem.canal, mensagemId: pedido.origem.mensagemId ?? null } : null,
        },
        conteudo: {
          pergunta: `${agentSlug} pede ${capabilityId}`,
          motivo: pedido.origem?.descricao ?? null,
        },
        sensibilidade: 'interna',
      });
    } catch (e) {
      this.log.error(`empresa ${orgId}: o pedido externo de ${agentSlug} (${capabilityId}) não entrou no rastro: ${(e as Error).message}`);
    }
  }

  /** A recusa ANTES da porta (estado do agente, efeito ausente), com causa estável. */
  private async registrarRecusa(
    orgId: string,
    agentSlug: string,
    capabilityId: string,
    correlationId: string,
    impedimento: { causa: string; motivo: string },
    solicitanteId: string | null,
  ): Promise<void> {
    try {
      await this.eventos.registrar({
        orgId,
        tipo: 'agente.passagem_recusada',
        actorType: ActorType.ai,
        actorId: agentSlug,
        agentSlug,
        capabilityId,
        correlationId,
        payload: { causa: impedimento.causa, canal: 'externo', solicitanteId },
        conteudo: {
          pergunta: `${agentSlug} pede ${capabilityId} pela rota de agente externo`,
          motivo: impedimento.motivo,
          resultado: { executou: false, causa: impedimento.causa },
        },
        sensibilidade: 'interna',
      });
    } catch (e) {
      this.log.error(
        `empresa ${orgId}: a recusa de ${agentSlug} (${impedimento.causa}) NÃO entrou no rastro: ${(e as Error).message} — a recusa VALEU.`,
      );
    }
  }
}
