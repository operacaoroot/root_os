import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, RiskLevel, ToolCallStatus } from '@prisma/client';
import type { Decisao } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { SinaisService } from '../policy/sinais.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { EventLogService } from './event-log.service';
import { mensagemDeErro, validarArgs } from './validacao';

export interface ExecCtx {
  orgId: string;
  actorType: ActorType;
  actorId?: string | null;
  agentSlug?: string | null;
  correlationId: string;
  /**
   * Mão única: o runtime marca quando o pedido veio de mensagem, documento ou
   * página. Não existe desmarcar — conteúdo externo só ELEVA nível (RF-G-07).
   */
  procedenciaExterna?: boolean;
  /** Capacidades que o agente DECLAROU. Fora desta lista, a porta recusa. */
  capacidadesDeclaradas?: string[];
}

export interface ToolCallRequest<A = Record<string, unknown>> {
  capabilityId: string | null;
  args: A;
  ctx: ExecCtx;
  approvalToken?: string;
  resource?: { type: string; id: string };
  /** Em centavos, quando a ação move dinheiro — alimenta o sinal de valor. */
  valorCentavos?: number | null;
}

export type ToolCallResult<R = unknown> =
  | { status: 'executado'; resultado: R; toolCallId: string; decisao: Decisao }
  | {
      status: 'aguardando_aprovacao';
      approvalId: string;
      resumo: string;
      expiraEm: string;
      toolCallId: string;
      decisao: Decisao;
    }
  | { status: 'recusado'; motivo: string; preparo?: unknown; toolCallId: string; decisao: Decisao }
  | { status: 'erro'; mensagem: string; toolCallId: string };

/*
 * A PORTA. Nenhuma ação de agente chega num conector, numa API externa ou no
 * banco sem passar por aqui.
 *
 * O callback `efeito` é a peça que faz isto caber no código que já existe: a
 * porta não sabe mandar e-mail nem escrever no ClickUp. Ela é o sanduíche
 * decidir → registrar → impor, e quem chama entrega o efeito.
 *
 * MODO OBSERVAR (GATEWAY_MODO=observar): classifica, registra e loga "teria
 * bloqueado", mas DEIXA PASSAR. É a trava operacional do primeiro deploy — se
 * uma capacidade for classificada errado e a rotina diária parar em silêncio
 * às 8 da manhã, o prejuízo é maior que o da porta ainda não impor. Vira
 * `impor` depois de ler uma semana de log.
 */
@Injectable()
export class ToolGateway {
  private readonly log = new Logger('ToolGateway');
  private readonly modo = (process.env.GATEWAY_MODO ?? 'observar') as 'impor' | 'observar';

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly sinais: SinaisService,
    private readonly approvals: ApprovalsService,
    private readonly eventos: EventLogService,
  ) {
    this.log.log(`porta em modo ${this.modo.toUpperCase()}`);
  }

  get modoAtual(): 'impor' | 'observar' {
    return this.modo;
  }

  async executar<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    efeito: (args: A, ctx: ExecCtx) => Promise<R>,
  ): Promise<ToolCallResult<R>> {
    const inicio = Date.now();
    const { ctx } = req;
    const cap = req.capabilityId ? this.policy.resolverCapacidade(ctx.orgId, req.capabilityId) : null;

    // 1-2. Escopo do agente ANTES da política: capacidade fora da declaração é
    // recusada pelo gateway (RF-N-03), e isso não depende de nível nenhum.
    if (
      ctx.capacidadesDeclaradas &&
      req.capabilityId &&
      !ctx.capacidadesDeclaradas.includes(req.capabilityId)
    ) {
      return this.recusar(req, null, `"${req.capabilityId}" não está nas capacidades declaradas deste agente`, inicio);
    }

    // 1. Argumentos ANTES de classificar. Recusar aqui é o que permite ao
    // modelo corrigir o nome do campo — recusar lá no efeito já custou uma
    // aprovação queimada.
    if (cap) {
      const erros = validarArgs((cap as { argsSchema?: unknown }).argsSchema, req.args);
      if (erros.length) {
        return this.recusar(req, null, mensagemDeErro(erros), inicio);
      }
    }

    // 3-4. Sinais do momento + decisão.
    const sinais = cap
      ? await this.sinais.calcular({
          orgId: ctx.orgId,
          capabilityId: cap.id,
          agentSlug: ctx.agentSlug,
          valorCentavos: req.valorCentavos,
          procedenciaExterna: ctx.procedenciaExterna,
        })
      : [];

    const { decisao, decisionId } = await this.policy.avaliarERegistrar({
      orgId: ctx.orgId,
      capabilityId: req.capabilityId,
      ctx: { sinais },
      modo: this.modo,
    });

    // 5-6. O REGISTRO VEM ANTES DA DECISÃO, não antes só da execução: assim a
    // recusa também fica gravada, e é dela que sai a prova de que a régua agiu.
    const toolCall = await this.prisma.toolCall.create({
      data: {
        orgId: ctx.orgId,
        capabilityId: cap?.id ?? null,
        decisionId,
        agentSlug: ctx.agentSlug ?? null,
        actorType: ctx.actorType,
        actorId: ctx.actorId ?? null,
        status: ToolCallStatus.erro, // sobrescrito no fim; nunca fica assim
        args: this.redigir(req.args, cap?.efeito.sensibilidade),
        nivel: decisao.nivel as RiskLevel,
        correlationId: ctx.correlationId,
      },
      select: { id: true },
    });

    await this.eventos.registrar({
      orgId: ctx.orgId,
      tipo: 'tool.proposta',
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      agentSlug: ctx.agentSlug,
      capabilityId: cap?.id ?? null,
      toolCallId: toolCall.id,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: ctx.correlationId,
      payload: {
        capacidade: req.capabilityId,
        nivel: decisao.nivel,
        motivo: decisao.motivo,
        sinais: decisao.sinaisAcionados,
      },
    });

    // 7. Decide.
    const observando = this.modo === 'observar';

    if (!decisao.permitido) {
      if (observando) {
        this.log.warn(
          `[observar] TERIA BLOQUEADO ${req.capabilityId} (${decisao.nivel}): ${decisao.motivo}`,
        );
      } else {
        return this.concluirRecusa(req, toolCall.id, decisao, decisionId, inicio);
      }
    }

    if (decisao.exigeAprovacao && !req.approvalToken) {
      const pendente = await this.approvals.propor({
        orgId: ctx.orgId,
        propostoPorId: ctx.actorId ?? 'agente',
        propostoPorTipo: ctx.actorType,
        capabilityId: cap?.id ?? null,
        decisionId,
        toolCallId: toolCall.id,
        resourceType: req.resource?.type ?? cap?.id ?? 'acao',
        resourceId: req.resource?.id ?? '-',
        args: req.args,
        hashKeys: cap ? this.hashKeysDe(cap.id, ctx.orgId) : [],
        decisao,
      });

      if (observando) {
        this.log.warn(
          `[observar] TERIA RETIDO ${req.capabilityId} (${decisao.nivel}) — aprovação ${pendente.approvalId}`,
        );
      } else {
        await this.prisma.toolCall.update({
          where: { id: toolCall.id },
          data: {
            status: ToolCallStatus.aguardando_aprovacao,
            approvalId: pendente.approvalId,
            duracaoMs: Date.now() - inicio,
          },
        });
        return {
          status: 'aguardando_aprovacao',
          approvalId: pendente.approvalId,
          resumo: pendente.resumo,
          expiraEm: pendente.expiraEm,
          toolCallId: toolCall.id,
          decisao,
        };
      }
    }

    if (decisao.exigeAprovacao && req.approvalToken) {
      /*
       * Token inválido, expirado, já usado ou casando com outro conteúdo NÃO
       * pode virar exceção que escapa daqui: quem chama é o laço do agente, e
       * um throw derrubaria a sessão inteira em vez de registrar "a aprovação
       * não valia". A porta devolve resultado; ela não estoura.
       */
      try {
        await this.approvals.consumir({
          orgId: ctx.orgId,
          token: req.approvalToken,
          resourceType: req.resource?.type ?? cap?.id ?? 'acao',
          resourceId: req.resource?.id ?? '-',
          args: req.args,
          hashKeys: cap ? this.hashKeysDe(cap.id, ctx.orgId) : [],
          actorId: ctx.actorId ?? 'agente',
        });
      } catch (e) {
        const motivo = (e as Error).message;
        await this.prisma.toolCall.update({
          where: { id: toolCall.id },
          data: { status: ToolCallStatus.recusado, erro: motivo.slice(0, 500), duracaoMs: Date.now() - inicio },
        });
        await this.eventos.registrar({
          orgId: ctx.orgId,
          tipo: 'aprovacao.invalida',
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          agentSlug: ctx.agentSlug,
          capabilityId: cap?.id ?? null,
          toolCallId: toolCall.id,
          decisionId,
          nivel: decisao.nivel as RiskLevel,
          correlationId: ctx.correlationId,
          payload: { motivo },
        });
        return { status: 'recusado', motivo, toolCallId: toolCall.id, decisao };
      }
    }

    // 8. Executa e registra o que saiu.
    try {
      const resultado = await efeito(req.args, ctx);
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: {
          status: ToolCallStatus.executado,
          resultado: this.resumirResultado(resultado),
          duracaoMs: Date.now() - inicio,
        },
      });
      await this.eventos.registrar({
        orgId: ctx.orgId,
        tipo: 'tool.resultado',
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        agentSlug: ctx.agentSlug,
        capabilityId: cap?.id ?? null,
        toolCallId: toolCall.id,
        decisionId,
        nivel: decisao.nivel as RiskLevel,
        correlationId: ctx.correlationId,
        payload: { duracaoMs: Date.now() - inicio, ok: true },
      });
      return { status: 'executado', resultado, toolCallId: toolCall.id, decisao };
    } catch (e) {
      const mensagem = (e as Error).message;
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: { status: ToolCallStatus.erro, erro: mensagem.slice(0, 500), duracaoMs: Date.now() - inicio },
      });
      await this.eventos.registrar({
        orgId: ctx.orgId,
        tipo: 'tool.erro',
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        agentSlug: ctx.agentSlug,
        capabilityId: cap?.id ?? null,
        toolCallId: toolCall.id,
        decisionId,
        correlationId: ctx.correlationId,
        payload: { erro: mensagem.slice(0, 300) },
      });
      return { status: 'erro', mensagem, toolCallId: toolCall.id };
    }
  }

  private async concluirRecusa<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    toolCallId: string,
    decisao: Decisao,
    decisionId: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    await this.prisma.toolCall.update({
      where: { id: toolCallId },
      data: { status: ToolCallStatus.recusado, duracaoMs: Date.now() - inicio },
    });
    await this.eventos.registrar({
      orgId: req.ctx.orgId,
      tipo: 'tool.recusado',
      actorType: req.ctx.actorType,
      actorId: req.ctx.actorId,
      agentSlug: req.ctx.agentSlug,
      capabilityId: req.capabilityId,
      toolCallId,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: req.ctx.correlationId,
      payload: { motivo: decisao.motivo },
    });
    return {
      status: 'recusado',
      motivo: decisao.motivo,
      // R5 não é "não pode": é preparado e devolvido para a pessoa executar
      // na origem. O preparo é o que ela leva junto.
      preparo: decisao.nivel === 'R5' ? { capacidade: req.capabilityId, argumentos: req.args } : undefined,
      toolCallId,
      decisao,
    };
  }

  private async recusar<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    _cap: null,
    motivo: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    const toolCall = await this.prisma.toolCall.create({
      data: {
        orgId: req.ctx.orgId,
        capabilityId: null,
        agentSlug: req.ctx.agentSlug ?? null,
        actorType: req.ctx.actorType,
        actorId: req.ctx.actorId ?? null,
        status: ToolCallStatus.recusado,
        correlationId: req.ctx.correlationId,
        duracaoMs: Date.now() - inicio,
      },
      select: { id: true },
    });
    await this.eventos.registrar({
      orgId: req.ctx.orgId,
      tipo: 'tool.recusado',
      actorType: req.ctx.actorType,
      actorId: req.ctx.actorId,
      agentSlug: req.ctx.agentSlug,
      toolCallId: toolCall.id,
      correlationId: req.ctx.correlationId,
      payload: { motivo, capacidade: req.capabilityId },
    });
    return {
      status: 'recusado',
      motivo,
      toolCallId: toolCall.id,
      decisao: {
        nivel: 'R5',
        nivelBase: 'R5',
        permitido: false,
        exigeAprovacao: true,
        exigeReautenticacao: true,
        exigeMotivo: true,
        aprovacao: {
          exigida: 'sempre',
          vinculo: 'conteudo',
          usoUnico: true,
          validadeSegundos: 300,
          reautenticacao: true,
          alcadaMinima: 'titular',
        },
        sinaisAcionados: [],
        motivo,
      },
    };
  }

  private hashKeysDe(capabilityId: string, orgId: string): string[] {
    const cap = this.policy.resolverCapacidade(orgId, capabilityId);
    // Sem hashKeys declarado, o corpo INTEIRO entra no hash. Falha fechada:
    // capacidade que esqueceu de declarar prende a aprovação a tudo.
    return (cap as unknown as { hashKeys?: string[] })?.hashKeys ?? [];
  }

  /** Segredo nunca vai cru para o registro (RF-R-04). */
  private redigir(args: unknown, sensibilidade?: string): Prisma.InputJsonValue {
    if (sensibilidade === 'restrita') {
      return { redigido: true, chaves: Object.keys((args as object) ?? {}) };
    }
    return (args ?? {}) as Prisma.InputJsonValue;
  }

  // O resultado inteiro pode ser enorme (uma listagem de 500 tarefas). O
  // registro guarda o suficiente para auditar, não uma segunda cópia do banco.
  private resumirResultado(r: unknown): Prisma.InputJsonValue {
    const texto = typeof r === 'string' ? r : JSON.stringify(r ?? null);
    if (texto.length > 4000) return { resumo: texto.slice(0, 4000), truncado: true };
    return (r ?? {}) as Prisma.InputJsonValue;
  }
}
