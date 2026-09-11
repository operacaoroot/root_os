import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  Prisma,
  RiskLevel,
  SessionCanal,
  SessionStatus,
  type Agent,
  type Sop,
} from '@prisma/client';
import {
  LLM_PROVIDER,
  type LlmProvider,
  type LlmStepOutput,
  type LlmToolResult,
  type LlmTurn,
} from '../llm/llm.provider';
import { TetoDiarioEstouradoError } from '../llm/teto-diario.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { ToolGateway, type ExecCtx } from '../gateway/tool-gateway.service';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { comContexto } from '../common/contexto-execucao';
import { ContextBuilder, type FonteContexto } from './context-builder.service';
import { SessionService } from './session.service';
import type { CapacidadeCatalogo } from '@mktos/policy';
import { montarSop } from './sop';
import { paraFerramentas, paraModelo, resumirArgs, resumirResultado } from './tool-adapter';

export interface ExecutarPedido {
  orgId: string;
  agentSlug: string;
  canal: SessionCanal;
  pedido: string;
  solicitanteId?: string | null;
  solicitanteRotulo: string;
  canalRef?: string | null;
  sessionId?: string;
  /** Marca de mão única: o pedido veio de mensagem, documento ou página. */
  procedenciaExterna?: boolean;
  onEvento?: (e: SessionEvent) => void;
}

export type SessionEvent =
  | { t: 'sessao'; sessionId: string; agente: string }
  | { t: 'contexto'; fontes: FonteContexto[] }
  | { t: 'passo'; ordem: number; capacidade: string; args: string }
  | { t: 'passo_ok'; ordem: number; resultado: string; nivel: string; decisao: string }
  | { t: 'texto'; delta: string }
  | { t: 'aprovacao'; approvalId: string; resumo: string; nivel: string; motivo: string }
  | { t: 'fim'; status: SessionStatus; custoUsd: number; duracaoMs: number; passos: number }
  | { t: 'erro'; mensagem: string };

export interface SessionResumo {
  sessionId: string;
  status: SessionStatus;
  resposta: string;
  /** Por que a execução parou, quando não foi por ter respondido. */
  motivo?: string | null;
  custoUsd: number;
  custoEstimado: boolean;
  passos: number;
  duracaoMs: number;
  nivelMax: RiskLevel | null;
  fontes: FonteContexto[];
  aprovacoes: { approvalId: string; resumo: string; nivel: string }[];
  /**
   * Preenchido quando o teto de custo de IA da EMPRESA interrompeu a execução
   * (RF-G-05). A sessão fica `recusada` com este motivo, e a rota responde com
   * código próprio — ver `agents.controller.ts`.
   */
  recusaDeTeto?: { motivo: string; causa: string; dia: string };
}

/** O agente como o laço precisa dele: com o SOP e o nome do dono carregados. */
type AgenteEmSessao = Agent & { sop: Sop | null; dono: { name: string } | null };

/** Teto duro do código, acima do que qualquer agente pode declarar. */
const MAX_PASSOS_ABSOLUTO = 16;

/*
 * O LAÇO.
 *
 * Mora na API, e não num processo separado, por uma razão concreta: o estado
 * de aprovação é do banco e a porta é um serviço do Nest. Isolamento de falha
 * aqui se compra com teto de passos, teto de custo e teto de tempo — não com
 * processo. Como a interface é estreita, mover depois é troca de transporte.
 *
 * Entre o modelo propor uma ferramenta e a ferramenta rodar existe a porta, e
 * é por isso que o laço não pode morar dentro do provider.
 */
@Injectable()
export class AgentRuntime {
  private readonly log = new Logger('AgentRuntime');

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly gateway: ToolGateway,
    private readonly contexto: ContextBuilder,
    private readonly sessoes: SessionService,
    private readonly efeitos: EfeitosRegistry,
  ) {}

  async executar(p: ExecutarPedido): Promise<SessionResumo> {
    const inicio = Date.now();
    const emitir = p.onEvento ?? (() => {});

    const agent = await this.prisma.agent.findFirst({
      where: { orgId: p.orgId, slug: p.agentSlug },
      include: { sop: true, dono: { select: { name: true } } },
    });
    if (!agent) throw new Error(`agente "${p.agentSlug}" não existe nesta empresa`);

    // 0. Um agente sem dono e sem capacidade declarada não trabalha. É a
    // recusa do RF-N-01, e ela vem antes de qualquer chamada de modelo.
    const impedimento = this.impedimento(agent);
    if (impedimento) {
      const s = await this.sessoes.abrir({ ...p, agentId: agent.id, canalRef: p.canalRef });
      await this.sessoes.passo(p.orgId, s.id, { tipo: 'erro', erro: impedimento });
      await this.sessoes.encerrar(s.id, { status: SessionStatus.recusada, motivo: impedimento });
      return this.resumoVazio(s.id, SessionStatus.recusada, impedimento, inicio);
    }

    if (!this.llm.configured) throw new Error(`IA não configurada: falta credencial de ${this.llm.name}`);
    if (!this.llm.supportsTools) throw new Error(`o provider ${this.llm.name} não sabe chamar ferramenta`);

    // 1. A sessão e o PEDIDO são gravados antes de o modelo ser chamado. É o
    // RF-R-02 aplicado à própria pergunta: banco recusou, nada roda.
    const retomada = p.sessionId
      ? { id: p.sessionId }
      : p.canalRef
        ? await this.sessoes.retomar(p.orgId, p.canal, p.canalRef)
        : null;
    const sessao = retomada ?? (await this.sessoes.abrir({ ...p, agentId: agent.id, canalRef: p.canalRef }));
    const sessionId = sessao.id;
    emitir({ t: 'sessao', sessionId, agente: agent.nome });
    if (retomada) await this.sessoes.passo(p.orgId, sessionId, { tipo: 'pedido', texto: p.pedido });

    /*
     * O CONTEXTO DE EXECUÇÃO ABRE AQUI, onde o identificador da sessão nasce
     * (RF-T-04, RNF-09).
     *
     * Antes o único escopo aberto no caminho do agente era o da porta, e ele
     * envolvia só a chamada do efeito. O resultado era uma jornada partida:
     * tudo que a porta loga saía com a correlação da REQUISIÇÃO, e só o que
     * rodava dentro do efeito saía com a da SESSÃO — nenhuma linha carregava as
     * duas, e ligar log de porta a log de efeito virava adivinhação.
     *
     * Abrindo aqui, a execução inteira — montagem de contexto, chamadas de
     * modelo, passagens pela porta, efeitos — roda sob `cor:<sessão>`, e o
     * `correlacaoPai` que `comContexto` deduz sozinho guarda de onde ela veio
     * (`pai:http-…` quando o pedido chegou por requisição). As duas pontas
     * aparecem na MESMA linha.
     *
     * O laço vai para um método próprio, e não para um bloco indentado aqui
     * dentro, porque `comContexto` precisa de uma função: é `run()`, e só o que
     * roda dentro dela enxerga o escopo.
     */
    const ctxExec: ExecCtx = {
      orgId: p.orgId,
      actorType: ActorType.ai,
      actorId: p.solicitanteId ?? agent.slug,
      agentSlug: agent.slug,
      correlationId: sessionId,
      procedenciaExterna: p.procedenciaExterna,
      capacidadesDeclaradas: agent.capacidades,
    };

    return comContexto({ ...ctxExec, origem: 'agente' }, () =>
      this.conduzir(p, agent, sessionId, ctxExec, emitir, inicio),
    );
  }

  /**
   * O laço em si, já dentro do contexto de execução da sessão. Separado de
   * `executar` só por causa disso — ver o comentário lá.
   */
  private async conduzir(
    p: ExecutarPedido,
    agent: AgenteEmSessao,
    sessionId: string,
    ctxExec: ExecCtx,
    emitir: (e: SessionEvent) => void,
    inicio: number,
  ): Promise<SessionResumo> {
    // 2. O contexto que entra junto — bloco 02 do traço.
    const { blocos, fontes } = await this.contexto.montar(p.orgId, p.pedido, agent);
    await this.sessoes.passo(p.orgId, sessionId, {
      tipo: 'contexto',
      texto: blocos || null,
      fontes: fontes as unknown as object[],
    });
    emitir({ t: 'contexto', fontes });

    // 3. As ferramentas que ESTE agente declarou. O catálogo é global; o que
    // ele alcança é o recorte dele — e a porta confere de novo.
    const declaradas = agent.capacidades
      .map((id) => this.policy.resolverCapacidade(p.orgId, id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const ferramentas = paraFerramentas(declaradas as unknown as CapacidadeCatalogo[]);
    const capPorFerramenta = new Map(ferramentas.map((f) => [f.spec.name, f.capabilityId]));

    const { system } = montarSop(agent as Agent & { sop: Sop | null }, agent.dono?.name);
    const turns: LlmTurn[] = [
      { role: 'user', text: blocos ? `${blocos}\n\n---\n\nPEDIDO: ${p.pedido}` : p.pedido },
    ];

    const maxPassos = Math.min(agent.maxPassos, MAX_PASSOS_ABSOLUTO);
    const tetoUsd = Number(agent.tetoCustoUsd);
    const aprovacoes: SessionResumo['aprovacoes'] = [];
    const fontesUsadas: FonteContexto[] = [...fontes];

    let custo = 0;
    let custoEstimado = true;
    let tokensIn = 0;
    let tokensOut = 0;
    let nivelMax: RiskLevel | null = null;
    let resposta = '';
    let status: SessionStatus = SessionStatus.falhou;
    let motivo: string | null = null;
    let passos = 0;
    /** Preenchido quando o teto de custo da EMPRESA parou a execução. */
    let recusaDeTeto: TetoDiarioEstouradoError | null = null;

    for (passos = 0; passos < maxPassos; passos++) {
      if (custo > tetoUsd) {
        motivo = `teto de custo do agente estourado (US$ ${tetoUsd})`;
        break;
      }
      if (Date.now() - inicio > agent.tetoSegundos * 1000) {
        motivo = `teto de tempo do agente estourado (${agent.tetoSegundos}s)`;
        break;
      }

      const t0 = Date.now();
      let saida: LlmStepOutput;
      try {
        saida = await this.llm.step({
          system,
          turns,
          tools: ferramentas.map((f) => f.spec),
          model: agent.modelo ?? undefined,
          effort: agent.effort as never,
          onTextDelta: p.onEvento ? (d) => emitir({ t: 'texto', delta: d }) : undefined,
          orgId: p.orgId,
        });
      } catch (e) {
        /*
         * O TETO DE CUSTO DE IA DA EMPRESA ESTOUROU NO MEIO DO LAÇO (RF-G-05).
         *
         * Ele precisa ser tratado AQUI, e não escapar. A sessão já foi aberta e o
         * pedido já foi gravado: deixar a exceção subir deixava a linha sem
         * situação e sem motivo — uma execução pendurada para sempre, que nem a
         * tela nem o RASTRO conseguiam explicar. E o critério da fatia é
         * explícito: estourar o teto "interrompe a execução e registra o motivo".
         *
         * Interromper é `break`: o encerramento lá embaixo é o mesmo de qualquer
         * outra parada, com `recusada` e o motivo em português. O que o modelo já
         * tinha gasto nos passos anteriores continua gravado.
         */
        if (!(e instanceof TetoDiarioEstouradoError)) throw e;
        recusaDeTeto = e;
        motivo = e.motivo;
        resposta = e.motivo;
        status = SessionStatus.recusada;
        await this.sessoes.passo(p.orgId, sessionId, { tipo: 'erro', erro: e.motivo });
        emitir({ t: 'erro', mensagem: e.motivo });
        break;
      }

      // O passo do modelo é gravado SEMPRE, inclusive quando ele recusa: o
      // custo aconteceu, e a sessão precisa mostrar onde parou.
      custo += saida.usage.custoUsd;
      if (!saida.usage.custoEstimado) custoEstimado = false;
      tokensIn += saida.usage.inputTokens;
      tokensOut += saida.usage.outputTokens;
      await this.sessoes.passo(p.orgId, sessionId, {
        tipo: 'modelo',
        provider: this.llm.name,
        modelo: saida.usage.modeloServido,
        tokensIn: saida.usage.inputTokens,
        tokensOut: saida.usage.outputTokens,
        tokensCacheRead: saida.usage.cacheReadTokens,
        tokensCacheWrite: saida.usage.cacheWriteTokens,
        custoUsd: saida.usage.custoUsd,
        custoEstimado: saida.usage.custoEstimado,
        stopReason: saida.stopReason,
        texto: saida.text || null,
        payload: saida.raw as object,
        duracaoMs: Date.now() - t0,
      });

      if (saida.stopReason === 'refusal') {
        motivo = `o modelo recusou o pedido (${saida.refusalCategoria ?? 'sem categoria'})`;
        resposta = saida.text || 'Não posso responder a esse pedido.';
        status = SessionStatus.recusada;
        break;
      }
      if (saida.stopReason === 'pause_turn') {
        turns.push({ role: 'assistant', text: saida.text, raw: saida.raw });
        continue;
      }

      if (saida.toolCalls.length === 0) {
        resposta = saida.text;
        status = aprovacoes.length ? SessionStatus.retida : SessionStatus.respondida;
        break;
      }

      turns.push({ role: 'assistant', text: saida.text, toolCalls: saida.toolCalls, raw: saida.raw });

      const resultados: LlmToolResult[] = [];
      for (const chamada of saida.toolCalls) {
        const capacidade = capPorFerramenta.get(chamada.name) ?? null;
        emitir({
          t: 'passo',
          ordem: passos + 1,
          capacidade: capacidade ?? chamada.name,
          args: resumirArgs(chamada.args),
        });

        const r = await this.gateway.executar(
          { capabilityId: capacidade, args: chamada.args, ctx: ctxExec },
          async (args) => this.executarCapacidade(capacidade!, args, p.orgId),
        );

        const nivel = r.status === 'erro' ? null : (r.decisao.nivel as RiskLevel);
        if (nivel && (!nivelMax || nivel > nivelMax)) nivelMax = nivel;

        await this.sessoes.passo(p.orgId, sessionId, {
          tipo: 'ferramenta',
          capacidade,
          argsResumo: resumirArgs(chamada.args),
          args: chamada.args as Prisma.InputJsonValue,
          resultadoResumo: resumirResultado(r),
          toolCallId: r.toolCallId,
          nivel,
          decisao: r.status,
          motivo: r.status === 'erro' ? r.mensagem : r.decisao.motivo,
          gatilhos: r.status === 'erro' ? [] : (r.decisao.sinaisAcionados as string[]),
          approvalId: r.status === 'aguardando_aprovacao' ? r.approvalId : null,
        });

        if (r.status === 'aguardando_aprovacao') {
          aprovacoes.push({ approvalId: r.approvalId, resumo: r.resumo, nivel: r.decisao.nivel });
          emitir({
            t: 'aprovacao',
            approvalId: r.approvalId,
            resumo: r.resumo,
            nivel: r.decisao.nivel,
            motivo: r.decisao.motivo,
          });
        } else {
          emitir({
            t: 'passo_ok',
            ordem: passos + 1,
            resultado: resumirResultado(r),
            nivel: nivel ?? '—',
            decisao: r.status,
          });
        }

        const traduzido = paraModelo(r);
        resultados.push({ id: chamada.id, content: traduzido.content, isError: traduzido.isError });
      }

      // TODOS os resultados num único turno: dividir ensina o modelo a parar
      // de pedir ferramentas em paralelo, e aí cada resposta custa mais voltas.
      turns.push({ role: 'tool', results: resultados });
    }

    if (status === SessionStatus.falhou && !motivo) {
      motivo = `não concluí em ${maxPassos} passos`;
    }

    // Verificação barata de procedência: resposta com número e sem fonte
    // nenhuma é sinalizada, não bloqueada — bloquear exigiria um verificador
    // de citação, que é outra chamada de modelo por resposta.
    const semProcedencia = /\d/.test(resposta) && fontesUsadas.length === 0;

    const duracaoMs = Date.now() - inicio;
    await this.sessoes.encerrar(sessionId, {
      status,
      resposta,
      nivelMax,
      motivo,
      fontes: fontesUsadas as unknown as object[],
      semProcedencia,
      custoUsd: custo,
      custoEstimado,
      provider: this.llm.name,
      modelo: agent.modelo ?? this.llm.model,
      tokensIn,
      tokensOut,
      passos,
      duracaoMs,
    });
    await this.atualizarAgente(agent.id, status, sessionId);

    emitir({ t: 'fim', status, custoUsd: custo, duracaoMs, passos });

    return {
      sessionId,
      status,
      resposta,
      motivo,
      custoUsd: custo,
      custoEstimado,
      passos,
      duracaoMs,
      nivelMax,
      fontes: fontesUsadas,
      aprovacoes,
      // A rota precisa distinguir ISTO de "o agente respondeu": é um limite de
      // orçamento, e o código de resposta tem de dizer isso (ver o controlador).
      recusaDeTeto: recusaDeTeto
        ? { motivo: recusaDeTeto.motivo, causa: recusaDeTeto.detalhe.causa, dia: recusaDeTeto.detalhe.dia }
        : undefined,
    };
  }

  private impedimento(agent: Agent): string | null {
    if (agent.estado === 'planejado') {
      return 'Agente ainda não tem dono nem capacidade declarada — está planejado, não rodando.';
    }
    if (agent.estado === 'pausado') return 'Agente pausado.';
    if (!agent.ativo) return 'Agente desativado.';
    if (agent.capacidades.length === 0) {
      return 'Agente sem capacidade declarada: começa sem permissão nenhuma, por desenho.';
    }
    return null;
  }

  /**
   * O efeito de uma capacidade de LEITURA. Chama o serviço do Nest direto —
   * não um cliente MCP por stdio: dentro da API o org e a permissão já vêm do
   * contexto da porta, e um processo filho por sessão seria caro e frágil.
   *
   * As de ESCRITA ainda não têm efeito ligado: elas são classificadas, retidas
   * e registradas, mas quem executa é a rota do painel. É a fatia seguinte.
   */
  private async executarCapacidade(
    capabilityId: string,
    args: Record<string, unknown>,
    orgId: string,
  ): Promise<unknown> {
    return this.efeitos.executar(capabilityId, args, orgId);
  }

  private async atualizarAgente(agentId: string, status: SessionStatus, sessionId: string) {
    const falhou = status === SessionStatus.falhou;
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        execucoes: { increment: 1 },
        ultimaExecucaoEm: new Date(),
        ultimoStatus: status,
        ...(falhou
          ? {
              falhas: { increment: 1 },
              // RF-N-07: agente que erra tem a autonomia rebaixada por 24h.
              // Quem aplica o rebaixamento é a régua, via sinal erro_recente.
              rebaixadoAte: new Date(Date.now() + 86_400_000),
              rebaixadoPor: sessionId,
            }
          : {}),
      },
    });
  }

  private resumoVazio(
    sessionId: string,
    status: SessionStatus,
    motivo: string,
    inicio: number,
  ): SessionResumo {
    return {
      sessionId,
      status,
      resposta: motivo,
      custoUsd: 0,
      custoEstimado: true,
      passos: 0,
      duracaoMs: Date.now() - inicio,
      nivelMax: null,
      fontes: [],
      aprovacoes: [],
    };
  }
}
