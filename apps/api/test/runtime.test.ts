import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  PrismaClient,
  ActorType,
  AgentEstado,
  AgentTipo,
  RiskLevel,
  SessionCanal,
  SessionStatus,
} from '@prisma/client';
import type {
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
  LlmTurn,
} from '../src/llm/llm.provider';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AuditService } from '../src/audit/audit.service';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { SessionService } from '../src/agents/session.service';
import { ContextBuilder } from '../src/agents/context-builder.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ObsidianService } from '../src/obsidian/obsidian.service';

/*
 * O laço do agente, com um modelo de mentira e a porta de verdade.
 *
 * O modelo é roteirizado porque o que está sob teste é o LAÇO — a ordem dos
 * passos, o traço, o custo somado e o que acontece quando a régua barra. Testar
 * com modelo real testaria o modelo, e custaria dinheiro a cada rodada.
 */
const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-runtime';

/** Devolve os passos na ordem em que forem pedidos. */
class ModeloRoteirizado implements LlmProvider {
  readonly name = 'roteiro';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;
  chamadas: LlmStepInput[] = [];
  private i = 0;

  constructor(private readonly roteiro: Partial<LlmStepOutput>[]) {}

  async complete(): Promise<string> {
    return 'n/d';
  }

  /**
   * Exigido por `LlmProvider` desde a fatia 3.6: é o `max_tokens` que o provider
   * mandaria, e é dele que o teto de custo por empresa tira o valor da reserva.
   * Aqui não há pedido de verdade, então o número é o do roteiro: fixo.
   */
  tetoDeSaida(): number {
    return 4000;
  }

  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas.push(input);
    const passo = this.roteiro[Math.min(this.i++, this.roteiro.length - 1)];
    return {
      text: '',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        custoUsd: 0.0075,
        custoEstimado: true,
        modeloServido: 'claude-opus-5',
      },
      raw: [],
      ...passo,
    };
  }
}

describe.skipIf(!URL)('o laço do agente', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  let policy: PolicyService;
  let sessoes: SessionService;

  const contexto = {
    montar: async () => ({
      blocos: 'O QUE VALE NESTA EMPRESA:\n- faturamento exclui a filial 3',
      fontes: [{ tipo: 'regra' as const, id: 'r1', titulo: 'faturamento exclui a filial 3' }],
    }),
  } as unknown as ContextBuilder;

  const montarRuntime = (modelo: LlmProvider) => {
    const p = prisma as unknown as PrismaService;
    const registro = new EfeitosRegistry();
    registro.registrar({
      'numeros.painel.ler': async () => ({ leadsHoje: 12, receita: 48000 }),
      'contexto.memoria.buscar': async () => ({ items: [] }),
    });
    return new AgentRuntime(modelo, p, policy, gateway, contexto, sessoes, registro);
  };

  beforeAll(async () => {
    /*
     * Relógio preso às 14:00. Sem isto a suíte passa de dia e falha de noite:
     * o sinal `fora_da_janela` (08:00–20:00) sobe TODO nível um degrau, e os
     * testes de classificação viam R1 onde esperavam R0. Escalonamento tem
     * teste próprio; aqui o que se mede é a classificação.
     */
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Runtime', slug: 'org-runtime' },
      update: {},
    });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    sessoes = new SessionService(p);
    gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      new ApprovalsService(p, audit),
      new EventLogService(p),
    );

    await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente' } },
      create: {
        orgId: ORG, slug: 'assistente', nome: 'Assistente', iniciais: 'AS',
        missao: 'responder com fonte', tipo: AgentTipo.llm, estado: AgentEstado.rodando,
        autonomiaAte: RiskLevel.R1,
        capacidades: ['numeros.painel.ler', 'whatsapp.mensagem.enviar', 'financeiro.pagamento.baixar'],
      },
      update: {},
    });
    await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG, slug: 'nao-nasceu' } },
      create: {
        orgId: ORG, slug: 'nao-nasceu', nome: 'Ainda não', iniciais: 'AN',
        missao: 'nada por enquanto', estado: AgentEstado.planejado, capacidades: [],
      },
      update: {},
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    /*
     * NUMA TRANSAÇÃO SÓ. `EventLog` é do banco INTEIRO e os arquivos de teste
     * rodam em PARALELO contra ele: em comandos soltos, a RULE de append-only
     * fica desligada para TODO MUNDO na janela entre eles, e quem estiver
     * medindo o append-only nesse instante sai vermelho por um defeito que não
     * existe. Dentro de uma transação o ALTER TABLE segura ACCESS EXCLUSIVE até
     * o commit, e worker morto no meio devolve a RULE ligada. Mesmo conserto da
     * onda 6 em `rastro-retencao.test.ts`.
     */
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: ORG } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.sessionStep.deleteMany({ where: { orgId: ORG } });
    await prisma.session.deleteMany({ where: { orgId: ORG } });
    await prisma.sop.deleteMany({ where: { orgId: ORG } });
    await prisma.agent.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.sessionStep.deleteMany({ where: { orgId: ORG } });
    await prisma.session.deleteMany({ where: { orgId: ORG } });
  });

  const pedir = (over = {}) => ({
    orgId: ORG,
    agentSlug: 'assistente',
    canal: SessionCanal.web,
    pedido: 'quanto entrou hoje?',
    solicitanteRotulo: 'Pedro',
    ...over,
  });

  it('chama a ferramenta, lê o resultado e responde — com o traço inteiro', async () => {
    const modelo = new ModeloRoteirizado([
      {
        toolCalls: [{ id: 'c1', name: 'get_dashboard_summary', args: { periodo: 'hoje' } }],
        stopReason: 'tool_use',
      },
      { text: 'Entraram 12 leads hoje, e a receita está em R$ 48.000.', stopReason: 'end_turn' },
    ]);
    const r = await montarRuntime(modelo).executar(pedir());

    expect(r.status).toBe(SessionStatus.respondida);
    expect(r.resposta).toContain('12 leads');
    expect(r.passos).toBe(1); // uma volta com ferramenta, e a resposta na segunda
    // duas chamadas de modelo × 0,0075 — o custo é somado dos passos, não chutado
    expect(r.custoUsd).toBeCloseTo(0.015, 6);

    const traco = await sessoes.traco(ORG, r.sessionId);
    expect(traco).not.toBeNull();
    // 01 o pedido
    expect(traco!.blocos.pedido).toBe('quanto entrou hoje?');
    // 02 o contexto que entrou junto
    expect(traco!.blocos.contexto.texto).toContain('filial 3');
    // 03 as ferramentas chamadas
    expect(traco!.blocos.ferramentas).toHaveLength(1);
    expect(traco!.blocos.ferramentas[0]).toMatchObject({
      capacidade: 'numeros.painel.ler',
      decisao: 'executado',
      nivel: 'R0',
    });
    // 04 a régua decidiu
    expect(traco!.blocos.regua.nivelMax).toBe('R0');
    // 05 o que saiu
    expect(traco!.blocos.resposta.texto).toContain('48.000');
    // 06 o que ficou registrado
    expect(traco!.blocos.registro.toolCalls).toHaveLength(1);
  });

  it('o modelo recebe as ferramentas que o agente DECLAROU, e só elas', async () => {
    const modelo = new ModeloRoteirizado([{ text: 'ok', stopReason: 'end_turn' }]);
    await montarRuntime(modelo).executar(pedir());
    const nomes = (modelo.chamadas[0].tools ?? []).map((t) => t.name).sort();
    expect(nomes).toEqual(['financeiro_pagamento_baixar', 'get_dashboard_summary', 'whatsapp_enviar']);
    // o nível vai na descrição como orientação — economiza proposta recusada
    const zap = modelo.chamadas[0].tools!.find((t) => t.name === 'whatsapp_enviar')!;
    expect(zap.description).toContain('R3');
    expect(zap.description).toContain('aprovação humana');
  });

  it('R3 retém: a sessão fecha como retida e a aprovação sai na resposta', async () => {
    const modelo = new ModeloRoteirizado([
      {
        toolCalls: [{ id: 'c1', name: 'whatsapp_enviar', args: { titulo: 'Resumo', corpo: 'texto' } }],
        stopReason: 'tool_use',
      },
      { text: 'Preparei a mensagem e ela aguarda sua confirmação.', stopReason: 'end_turn' },
    ]);
    const r = await montarRuntime(modelo).executar(pedir({ pedido: 'manda o resumo pro grupo' }));

    expect(r.status).toBe(SessionStatus.retida);
    expect(r.aprovacoes).toHaveLength(1);
    expect(r.aprovacoes[0].nivel).toBe('R3');
    expect(r.nivelMax).toBe('R3');

    // e o modelo foi informado de que NÃO foi feito
    const turnoDaFerramenta = modelo.chamadas[1].turns.find((t: LlmTurn) => t.role === 'tool');
    expect(turnoDaFerramenta).toBeDefined();
    if (turnoDaFerramenta?.role === 'tool') {
      expect(turnoDaFerramenta.results[0].content).toContain('RETIDA');
      expect(turnoDaFerramenta.results[0].content).toContain('NÃO afirme que foi feita');
    }
  });

  it('R5 é bloqueado, e o modelo lê a recusa em vez de um sucesso', async () => {
    const modelo = new ModeloRoteirizado([
      {
        toolCalls: [{ id: 'c1', name: 'financeiro_pagamento_baixar', args: { titulo: 'T-1' } }],
        stopReason: 'tool_use',
      },
      { text: 'Não posso dar baixa: preparei tudo para você executar na origem.', stopReason: 'end_turn' },
    ]);
    const r = await montarRuntime(modelo).executar(pedir({ pedido: 'dá baixa nesse pagamento' }));

    expect(r.nivelMax).toBe('R5');
    const turno = modelo.chamadas[1].turns.find((t: LlmTurn) => t.role === 'tool');
    if (turno?.role === 'tool') {
      expect(turno.results[0].isError).toBe(true);
      expect(turno.results[0].content).toContain('RECUSADO pela régua');
      // e o modelo é instruído a não contornar
      expect(turno.results[0].content).toContain('Não tente outro caminho');
    }
  });

  it('agente planejado recusa ANTES de chamar modelo', async () => {
    const modelo = new ModeloRoteirizado([{ text: 'nunca', stopReason: 'end_turn' }]);
    const r = await montarRuntime(modelo).executar(pedir({ agentSlug: 'nao-nasceu' }));
    expect(r.status).toBe(SessionStatus.recusada);
    expect(r.resposta).toContain('não tem dono nem capacidade declarada');
    expect(modelo.chamadas).toHaveLength(0); // não gastou um token
  });

  it('teto de custo encerra o laço e a sessão registra por quê', async () => {
    await prisma.agent.update({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente' } },
      data: { tetoCustoUsd: 0.001 },
    });
    const modelo = new ModeloRoteirizado([
      { toolCalls: [{ id: 'c1', name: 'get_dashboard_summary', args: {} }], stopReason: 'tool_use' },
    ]);
    const r = await montarRuntime(modelo).executar(pedir());
    await prisma.agent.update({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente' } },
      data: { tetoCustoUsd: 0.5 },
    });

    expect(r.status).toBe(SessionStatus.falhou);
    const s = await prisma.session.findUnique({ where: { id: r.sessionId } });
    expect(s?.motivo).toContain('teto de custo');
    // e o rebaixamento de 24h do RF-N-07 entra
    const a = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente' } },
    });
    expect(a?.rebaixadoAte).not.toBeNull();
    await prisma.agent.update({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente' } },
      data: { rebaixadoAte: null, falhas: 0 },
    });
  });

  it('resposta com número e sem fonte nenhuma é sinalizada, não bloqueada', async () => {
    const semContexto = {
      montar: async () => ({ blocos: '', fontes: [] }),
    } as unknown as ContextBuilder;
    const modelo = new ModeloRoteirizado([
      { text: 'Faturamos R$ 250.000 no mês.', stopReason: 'end_turn' },
    ]);
    const p = prisma as unknown as PrismaService;
    const r = await new AgentRuntime(
      modelo, p, policy, gateway, semContexto, sessoes, new EfeitosRegistry(),
    ).executar(pedir());

    expect(r.status).toBe(SessionStatus.respondida); // responde
    const s = await prisma.session.findUnique({ where: { id: r.sessionId } });
    expect(s?.semProcedencia).toBe(true); // mas fica marcada
  });

  it('a sessão é retomada pelo canal — é o que dá memória entre turnos', async () => {
    const modelo = new ModeloRoteirizado([{ text: 'primeira', stopReason: 'end_turn' }]);
    const runtime = montarRuntime(modelo);
    const a = await runtime.executar(
      pedir({ canal: SessionCanal.telegram, canalRef: 'chat-42', pedido: 'oi' }),
    );
    const b = await runtime.executar(
      pedir({ canal: SessionCanal.telegram, canalRef: 'chat-42', pedido: 'e agora?' }),
    );
    expect(b.sessionId).toBe(a.sessionId);

    const traco = await sessoes.traco(ORG, a.sessionId);
    // o segundo pedido virou passo da MESMA sessão
    expect(traco!.blocos.registro.passos).toBeGreaterThan(3);
  });

  it('recusa do modelo vira passo do traço, não exceção', async () => {
    const modelo = new ModeloRoteirizado([
      { text: '', stopReason: 'refusal', refusalCategoria: 'general_harms' },
    ]);
    const r = await montarRuntime(modelo).executar(pedir());
    expect(r.status).toBe(SessionStatus.recusada);
    const s = await prisma.session.findUnique({ where: { id: r.sessionId } });
    expect(s?.motivo).toContain('recusou');
    // o custo daquele passo aconteceu e está registrado
    expect(r.custoUsd).toBeGreaterThan(0);
  });
});
