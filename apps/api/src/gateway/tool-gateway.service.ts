import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, RiskLevel, ToolCallStatus } from '@prisma/client';
import type { Capacidade, Decisao } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto } from '../common/contexto-execucao';
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

/**
 * As duas recusas que a porta faz ANTES de classificar. São as mais frequentes
 * de um agente novo, e o relatório de calibragem precisa distinguir uma da
 * outra — e as duas de um bloqueio por R5, que é outra conversa.
 */
type CausaDeRecusa = 'fora_da_declaracao' | 'argumento_invalido';

/*
 * O que fica gravado em `PolicyDecision.motivo`. É texto ESTÁVEL de propósito:
 * o relatório agrupa por essa string ("motivo mais frequente" por capacidade),
 * e enfiar o nome do campo que faltou ali dentro espalharia a mesma recusa em
 * dezenas de linhas de contagem 1. O detalhe — qual campo, qual capacidade —
 * vai para `ToolCall.erro` e para o payload do evento.
 */
const ROTULO_DA_RECUSA: Record<CausaDeRecusa, string> = {
  fora_da_declaracao: 'recusado na porta: capacidade fora da declaração do agente',
  argumento_invalido: 'recusado na porta: argumentos inválidos',
};

/*
 * A PORTA. Nenhuma ação de agente chega num conector, numa API externa ou no
 * banco sem passar por aqui.
 *
 * O callback `efeito` é a peça que faz isto caber no código que já existe: a
 * porta não sabe mandar e-mail nem escrever no ClickUp. Ela é o sanduíche
 * decidir → registrar → impor, e quem chama entrega o efeito.
 *
 * MODO OBSERVAR (GATEWAY_MODO=observar) — e o que ele NÃO afrouxa.
 *
 * Observar existe para calibrar o CATÁLOGO sem parar a operação: a porta
 * classifica tudo, grava cada decisão com `modo=observar` e é dessa tabela que
 * sai o relatório que diz se a régua está apertada ou frouxa demais antes de
 * alguém virar a chave para `impor` (scripts/relatorio-observar.ts).
 *
 * O que observar afrouxa é o REGISTRO, não o EFEITO. Os dois freios da porta
 * valem igual nos dois modos:
 *
 * - RETENÇÃO POR APROVAÇÃO (R3 para cima, e R2 enquanto a aprovação
 *   configurável estiver ligada). Existe porque a ação sai da empresa — manda
 *   mensagem, publica, assume obrigação — e o que a segura não é a régua estar
 *   calibrada, é uma pessoa ter dito sim. Até 10/09/2026 esta porta criava a
 *   aprovação, escrevia "TERIA RETIDO" e chamava o efeito assim mesmo: mandava
 *   a mensagem no nome de alguém que nunca aprovou. Não é observação, é
 *   publicação sem consentimento — contra RF-G-03 e RNF-08.
 *
 * - BLOQUEIO (R5, e capacidade sem classificação, que vale R5). R5 é o degrau
 *   em que o OS PREPARA, REGISTRA E ENCAMINHA para uma pessoa executar na
 *   origem — nunca executa. Até 10/09/2026 observar chamava o efeito de R5
 *   depois de logar "TERIA BLOQUEADO": era a régua agindo no lugar de gente,
 *   que é o que as constraints proíbem. Hoje nenhuma capacidade R5 tem efeito
 *   ligado e a exposição prática era zero; o dia em que alguém ligasse um,
 *   viraria incidente. Passou a falhar fechado — decisão desta fatia, anotada
 *   em docs/AUDITORIA-SEGURANCA.md para revisão.
 *
 * Regra, então: observar afrouxa o que a porta REGISTRA, nunca o que ela DEIXA
 * ACONTECER.
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
      return this.recusar(
        req,
        cap,
        'fora_da_declaracao',
        `"${req.capabilityId}" não está nas capacidades declaradas deste agente`,
        inicio,
      );
    }

    // 1. Argumentos ANTES de classificar. Recusar aqui é o que permite ao
    // modelo corrigir o nome do campo — recusar lá no efeito já custou uma
    // aprovação queimada.
    if (cap) {
      const erros = validarArgs((cap as { argsSchema?: unknown }).argsSchema, req.args);
      if (erros.length) {
        return this.recusar(req, cap, 'argumento_invalido', mensagemDeErro(erros), inicio);
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

    // 7. Decide. São DOIS caminhos, e confundi-los foi o furo: o BLOQUEIO diz
    // o que o OS não faz de jeito nenhum; a RETENÇÃO diz o que ele só faz
    // depois de uma pessoa assinar. Nenhum dos dois afrouxa em observar.
    const observando = this.modo === 'observar';

    /*
     * CAMINHO A — BLOQUEIO, e ele NÃO chama o efeito em modo nenhum.
     *
     * Hoje `permitido: false` é exatamente R5 (`permitido: nivel !== 'R5'` na
     * escada), e R5 é o degrau em que o OS prepara, registra e encaminha para
     * uma pessoa executar na origem. Executar em observar era a régua agindo
     * no lugar de gente.
     *
     * A condição é `!decisao.permitido` e desemboca SEMPRE em recusa: se um
     * dia `permitido` virar false por outro motivo — killswitch por empresa,
     * agente rebaixado, catálogo bloqueado — ele cai aqui, em falha fechada.
     * O atalho que existia (pular a retenção e seguir para o efeito) foi
     * removido justamente para isso: NENHUM motivo novo de `permitido: false`
     * pode herdar em silêncio um bypass de aprovação. O que é específico de R5
     * — devolver o PREPARO — segue chaveado em `decisao.nivel === 'R5'`,
     * dentro de `concluirRecusa`.
     */
    if (!decisao.permitido) {
      if (observando) {
        /*
         * O propósito do modo continua atendido: o que a porta barrou fica
         * registrado na PolicyDecision com `modo=observar` e no evento
         * `tool.recusado` — é dali que sai o relatório de calibragem. O log
         * diz BLOQUEADO e não "teria bloqueado" de propósito: ele bloqueou
         * mesmo, e quem lê precisa saber que a ação não aconteceu.
         */
        this.log.warn(
          `[observar] BLOQUEADO ${req.capabilityId} (${decisao.nivel}): ${decisao.motivo} — ` +
            'em observar o bloqueio também vale; o efeito não foi chamado',
        );
      }
      return this.concluirRecusa(req, toolCall.id, decisao, decisionId, inicio);
    }

    /*
     * CAMINHO B — retenção por aprovação. Vale nos DOIS modos. Sem token, a
     * ação para aqui e vira item na fila; quem executa depois é
     * AcoesService.executarAprovada, com os argumentos GRAVADOS na proposta.
     */
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
        // Deixa rastro de que a porta reteve MESMO observando — quem lê o log
        // para calibrar a régua precisa distinguir isto de um bloqueio.
        this.log.warn(
          `[observar] RETIDO ${req.capabilityId} (${decisao.nivel}) — aprovação ${pendente.approvalId}; ` +
            'observar não dispensa aprovação humana',
        );
      }
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
      /*
       * O efeito roda DENTRO do contexto de execução (RF-T-04, RNF-09). O
       * `ExecCtx` já carregava tenant, ator e correlação; o que faltava era
       * eles alcançarem quem o efeito chama — o registro de efeitos, o
       * conector, o log. Nenhum parâmetro novo atravessa a cadeia inteira:
       * quem precisar lê de `contextoAtual()`.
       */
      const resultado = await comContexto({ ...ctx, origem: 'agente' }, () => efeito(req.args, ctx));
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
      // `modo` no payload diz com que porta a linha foi escrita — observar ou
      // impor. O bloqueio é o mesmo nos dois, mas quem lê para calibrar precisa
      // saber qual estava valendo, e o log do processo não sobrevive ao
      // container; o RASTRO sobrevive.
      payload: { motivo: decisao.motivo, nivel: decisao.nivel, modo: this.modo },
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

  /**
   * Recusa da PORTA, antes da régua decidir qualquer coisa: capacidade que o
   * agente não declarou (RF-N-03) e argumento que não casa com o schema.
   */
  private async recusar<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    cap: Capacidade | null,
    causa: CausaDeRecusa,
    motivo: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    const { ctx } = req;

    /*
     * A DECISÃO ENTRA NO RASTRO ANTES DA RECUSA (RF-P-03).
     *
     * Até 10/09/2026 este caminho criava ToolCall e evento e pulava
     * `avaliarERegistrar`. Resultado: as duas recusas mais frequentes de um
     * agente novo — capacidade não declarada e argumento com o nome errado —
     * não existiam em `PolicyDecision`, e o relatório de calibragem, que lê
     * exatamente essa tabela, não as enxergava. Quem fosse decidir a virada de
     * `observar` para `impor` decidiria sem os dois números que mais importam.
     */
    const { decisao, decisionId } = await this.policy.avaliarERegistrar({
      orgId: ctx.orgId,
      capabilityId: req.capabilityId,
      // Sem sinais, de propósito: a porta recusa ANTES de calculá-los (são
      // quatro consultas ao banco), então o nível gravado aqui é o de base.
      ctx: {},
      modo: this.modo,
    });

    /*
     * `avaliar()` só devolve `permitido: false` em R5 — para a régua, uma
     * leitura R0 pedida por um agente que não a declarou continua permitida.
     * Quem recusou foi a PORTA, e a linha precisa dizer isso, senão o
     * relatório conta a recusa como decisão liberada. `exigeAprovacao` cai
     * junto pelo mesmo motivo: nada foi retido, nada chegou à fila de ninguém.
     *
     * Isto é UMA ESCRITA A MAIS num caminho raro. O certo seria
     * `avaliarERegistrar` aceitar a recusa da porta e o motivo dela —
     * `apps/api/src/policy/policy.service.ts` é de outra fatia desta onda, e a
     * mudança está anotada no relatório.
     */
    const rotulo = ROTULO_DA_RECUSA[causa];
    await this.prisma.policyDecision.update({
      where: { id: decisionId },
      data: { permitido: false, exigeAprovacao: false, motivo: rotulo },
    });

    const toolCall = await this.prisma.toolCall.create({
      data: {
        orgId: ctx.orgId,
        capabilityId: cap?.id ?? null,
        decisionId,
        agentSlug: ctx.agentSlug ?? null,
        actorType: ctx.actorType,
        actorId: ctx.actorId ?? null,
        status: ToolCallStatus.recusado,
        args: this.redigir(req.args, cap?.efeito.sensibilidade),
        nivel: decisao.nivel as RiskLevel,
        // O detalhe fica aqui e no evento: qual campo faltou, qual capacidade
        // o agente tentou. No `motivo` da decisão vai só o rótulo, que é o que
        // o relatório agrupa.
        erro: motivo.slice(0, 500),
        correlationId: ctx.correlationId,
        duracaoMs: Date.now() - inicio,
      },
      select: { id: true },
    });
    await this.eventos.registrar({
      orgId: ctx.orgId,
      tipo: 'tool.recusado',
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      agentSlug: ctx.agentSlug,
      capabilityId: cap?.id ?? null,
      toolCallId: toolCall.id,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: ctx.correlationId,
      payload: { causa, motivo, capacidade: req.capabilityId, nivel: decisao.nivel },
    });
    return {
      status: 'recusado',
      // Para o MODELO vai o detalhe — é com ele que ele corrige o nome do
      // campo. Para o RASTRO vai o rótulo, no `decisao.motivo`, igualzinho ao
      // que ficou gravado na linha da decisão.
      motivo,
      toolCallId: toolCall.id,
      decisao: { ...decisao, permitido: false, exigeAprovacao: false, motivo: rotulo },
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
