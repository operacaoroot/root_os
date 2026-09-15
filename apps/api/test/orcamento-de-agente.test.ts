import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActorType,
  AgentTipo,
  EstadoDeAgente,
  PrismaClient,
  RiskLevel,
  SessionCanal,
  SessionStatus,
  SessionStepTipo,
} from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { SessionService } from '../src/agents/session.service';
import { ContextBuilder } from '../src/agents/context-builder.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PolicyService } from '../src/policy/policy.service';
import { ProcedenciaExterna, SinaisService } from '../src/policy/sinais.service';
import { ENTRADA_VAZIA, tamanhoDeTexto } from '../src/llm/estimativa';
import type {
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
  LlmMessage,
} from '../src/llm/llm.provider';
import { ProviderComTeto } from '../src/llm/provider-com-teto';
import { RecusaDeCustoDeIaError } from '../src/llm/recusa-de-custo';
import {
  TetoDiarioEstouradoError,
  type ReservaDeCusto,
  type TetoDeCustoIaService,
} from '../src/llm/teto-diario.service';
import {
  OrcamentoDeAgenteService,
  OrcamentoDoAgenteEstouradoError,
  OrcamentoIlegivelError,
} from '../src/llm/orcamento-de-agente.service';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';

/* ==========================================================================
 * O ORÇAMENTO MENSAL DE IA POR AGENTE — fatia A3
 * ==========================================================================
 *
 * O QUE ESTE ARQUIVO PROTEGE, defesa por defesa:
 *
 *  1. A ORDEM NO ENVELOPE. O orçamento do agente é conferido ANTES da reserva
 *     do teto da empresa e ANTES da ida ao modelo. Se alguém inverter, a recusa
 *     por orçamento passa a deixar reserva pendurada segurando o teto da
 *     empresa — e, se inverter com o modelo, o corte deixa de ser "antes".
 *  2. A FAMÍLIA. `OrcamentoDoAgenteEstouradoError` é da mesma família do teto do
 *     dia (`RecusaDeCustoDeIaError`), e é isso que faz o laço do agente tratá-la
 *     em vez de deixá-la escapar. Recusa que escapa deixa a sessão pendurada
 *     sem situação e sem motivo — defeito que este repositório já pagou uma vez.
 *  3. AS QUATRO CAUSAS, cada uma com rótulo próprio no RASTRO: orçamento zerado,
 *     modelo sem preço, chamada maior que o mês, mês no teto.
 *  4. MODELO SEM PREÇO É RECUSADO com o orçamento valendo — falha fechada, a
 *     mesma doutrina do teto da empresa: controle que não sabe medir não é
 *     controle. Sem isso, um agente em modelo fora da tabela passaria para
 *     sempre, porque passo sem preço não soma dinheiro nenhum.
 *  5. OBSERVAÇÃO NÃO CORTA, e AUSÊNCIA DE ORÇAMENTO não é orçamento zero.
 *  6. O GASTO É DO MÊS E DO AGENTE: passo de outro mês não conta, passo de outro
 *     agente não conta, e o gasto de outra EMPRESA não conta.
 *
 * A parte que fala com o banco pede `TEST_DATABASE_URL` e se pula sem ela — a
 * mesma regra de `porta.test.ts`. A parte do envelope roda sempre: ela é
 * decisão de ordem, não persistência.
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;

// ---------------------------------------------------------------------------
// 1. A ORDEM NO ENVELOPE — sem banco, porque o que está sob teste é a ordem
// ---------------------------------------------------------------------------

/** Um modelo que só anota que foi chamado. */
class ModeloQueAnota implements LlmProvider {
  readonly name = 'anota';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;
  chamadas: LlmStepInput[] = [];
  completes: LlmMessage[] = [];

  tetoDeSaida(): number {
    return 4000;
  }
  async complete(input: LlmMessage): Promise<string> {
    this.completes.push(input);
    return 'ok';
  }
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas.push(input);
    return {
      text: 'pronto',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        custoUsd: 0.001,
        custoEstimado: true,
        modeloServido: 'claude-opus-5',
      },
      raw: [],
    };
  }
}

/** O teto da empresa, reduzido ao que o envelope usa — e anotando a ordem. */
function tetoQueAnota(diario: string[]) {
  const reserva: ReservaDeCusto = {
    orgId: 'org-envelope',
    dia: '2026-09-14',
    modelo: 'claude-opus-5',
    valorUsd: 0.01,
    medivel: true,
    entrada: ENTRADA_VAZIA,
  };
  return {
    reservar: vi.fn(async () => {
      diario.push('reservar');
      return reserva;
    }),
    liquidar: vi.fn(async () => {
      diario.push('liquidar');
    }),
    liquidarPeloObservado: vi.fn(async () => {
      diario.push('liquidarPeloObservado');
    }),
    soltar: vi.fn(async () => {
      diario.push('soltar');
    }),
  } as unknown as TetoDeCustoIaService & {
    reservar: ReturnType<typeof vi.fn>;
    soltar: ReturnType<typeof vi.fn>;
  };
}

describe('a ordem no envelope: orçamento do agente, reserva da empresa, modelo', () => {
  const passo = (over: Partial<LlmStepInput> = {}): LlmStepInput => ({
    system: 'você é um agente',
    turns: [{ role: 'user', text: 'quanto entrou hoje?' }],
    orgId: 'org-envelope',
    agentSlug: 'analista',
    ...over,
  });

  it('a recusa por orçamento acontece ANTES da reserva e ANTES do modelo', async () => {
    const diario: string[] = [];
    const modelo = new ModeloQueAnota();
    const teto = tetoQueAnota(diario);
    const orcamento = {
      conferir: vi.fn(async () => {
        diario.push('conferir');
        throw new OrcamentoDoAgenteEstouradoError('orçamento do mês atingido', {
          orgId: 'org-envelope',
          agentSlug: 'analista',
          mes: '2026-09',
          causa: 'mes_no_teto',
          orcamentoUsd: 20,
          gastoUsd: 20,
          estimativaUsd: 0.01,
          modelo: 'claude-opus-5',
        });
      }),
    } as unknown as OrcamentoDeAgenteService;

    const envelope = new ProviderComTeto(modelo, teto, orcamento);
    await expect(envelope.step(passo())).rejects.toBeInstanceOf(
      OrcamentoDoAgenteEstouradoError,
    );

    // O CORTE É ANTES: o modelo não foi chamado.
    expect(modelo.chamadas).toHaveLength(0);
    /*
     * E NÃO DEIXOU RESÍDUO: `reservar` ESCREVE (soma a estimativa em
     * `reservadoUsd`). Se ela viesse primeiro, esta recusa deixaria reserva
     * pendurada segurando o teto da empresa até o coletor passar, por uma
     * chamada que nunca aconteceu.
     */
    expect(teto.reservar).not.toHaveBeenCalled();
    expect(teto.soltar).not.toHaveBeenCalled();
    expect(diario).toEqual(['conferir']);
  });

  it('passando o orçamento, a ordem é conferir → reservar → modelo → liquidar', async () => {
    const diario: string[] = [];
    const modelo = new ModeloQueAnota();
    const teto = tetoQueAnota(diario);
    const orcamento = {
      conferir: vi.fn(async () => {
        diario.push('conferir');
      }),
    } as unknown as OrcamentoDeAgenteService;

    await new ProviderComTeto(modelo, teto, orcamento).step(passo());

    expect(diario).toEqual(['conferir', 'reservar', 'liquidar']);
    expect(modelo.chamadas).toHaveLength(1);
  });

  it('sem agente no passo, o orçamento não é consultado — o gasto é da empresa', async () => {
    const conferir = vi.fn(async () => {});
    const modelo = new ModeloQueAnota();
    const envelope = new ProviderComTeto(modelo, tetoQueAnota([]), {
      conferir,
    } as unknown as OrcamentoDeAgenteService);

    await envelope.step(passo({ agentSlug: undefined }));

    /*
     * Relatório, curadoria e ficha chamam o modelo em nome da EMPRESA, não de
     * ninguém. Atribuir esse gasto a um agente qualquer seria inventar
     * procedência — e cortar um agente por gasto que não é dele.
     */
    expect(conferir).not.toHaveBeenCalled();
    expect(modelo.chamadas).toHaveLength(1);
  });

  it('`complete()` nunca consulta o orçamento de agente — ela não tem agente', async () => {
    const conferir = vi.fn(async () => {});
    const modelo = new ModeloQueAnota();
    const envelope = new ProviderComTeto(modelo, tetoQueAnota([]), {
      conferir,
    } as unknown as OrcamentoDeAgenteService);

    await envelope.complete({ system: 's', user: 'u', orgId: 'org-envelope' });

    expect(conferir).not.toHaveBeenCalled();
    expect(modelo.completes).toHaveLength(1);
  });

  it('envelope montado SEM o serviço do orçamento continua impondo o teto da empresa', async () => {
    const diario: string[] = [];
    const modelo = new ModeloQueAnota();
    // Há suíte que constrói o envelope com dois argumentos. O que se perde é o
    // eixo do agente; o da empresa não pode ir junto.
    await new ProviderComTeto(modelo, tetoQueAnota(diario)).step(passo());
    expect(diario).toEqual(['reservar', 'liquidar']);
  });
});

// ---------------------------------------------------------------------------
// 2. A FAMÍLIA DAS RECUSAS — o que impede a próxima de escapar do laço
// ---------------------------------------------------------------------------

describe('a família das recusas por custo de IA', () => {
  const doAgente = new OrcamentoDoAgenteEstouradoError('mês no teto', {
    orgId: 'o',
    agentSlug: 'a',
    mes: '2026-09',
    causa: 'mes_no_teto',
    orcamentoUsd: 20,
    gastoUsd: 20,
    estimativaUsd: 0.01,
    modelo: 'claude-opus-5',
  });
  const doDia = new TetoDiarioEstouradoError('dia no teto', {
    orgId: 'o',
    dia: '2026-09-14',
    causa: 'dia_no_teto',
    tetoUsd: 25,
    gastoUsd: 25,
    gastoEstimadoUsd: 0,
    reservadoUsd: 0,
    estimativaUsd: 0.01,
    modelo: 'claude-opus-5',
  });

  it('as duas são da MESMA família — é isso que o laço do agente pega', () => {
    expect(doAgente).toBeInstanceOf(RecusaDeCustoDeIaError);
    expect(doDia).toBeInstanceOf(RecusaDeCustoDeIaError);
  });

  it('e as causas NÃO colidem: quem agrupa o rastro sabe qual dos dois cortou', () => {
    // `mes_no_teto` e `dia_no_teto` são cortes diferentes, com prazos de volta
    // diferentes (virada do mês × virada do dia). Um rótulo só faria a tela
    // oferecer "tente amanhã" a quem tem de esperar três semanas.
    expect(doAgente.causa).toBe('agente_mes_no_teto');
    expect(doDia.causa).toBe('teto_dia_dia_no_teto');
    expect(doAgente.causa).not.toBe(doDia.causa);
  });

  it('toda recusa da família carrega motivo em português e a empresa', () => {
    for (const e of [doAgente, doDia]) {
      expect(e.orgId).toBe('o');
      expect(e.motivo).toBeTruthy();
      expect(e.message).toBe(e.motivo);
    }
  });

  it('o subtipo antigo continua reconhecível — nada que já o pegava quebrou', () => {
    expect(doDia).toBeInstanceOf(TetoDiarioEstouradoError);
    expect(doAgente).not.toBeInstanceOf(TetoDiarioEstouradoError);
  });
});

// ---------------------------------------------------------------------------
// 3. O SERVIÇO, CONTRA UM POSTGRES DE VERDADE
// ---------------------------------------------------------------------------
//
// Precisa de banco porque a soma do mês sai de uma CONSULTA BRUTA — `to_char(...
// AT TIME ZONE ...)`, `FILTER (WHERE ...)`, duas junções e nomes de coluna entre
// aspas. Nada disso é conferido pelo TypeScript: nome errado, `FILTER` mal posto
// ou fuso que o Postgres não conheça só aparecem quando a instrução roda.

const ORG = 'org-orcamento-agente';
const OUTRA = 'org-orcamento-vizinha';
const FUSO = 'America/Sao_Paulo';

describe.skipIf(!URL)('o orçamento mensal por agente, contra um Postgres de verdade', () => {
  let prisma: PrismaClient;
  let p: PrismaService;
  let svc: OrcamentoDeAgenteService;
  let idDoAgente: string;
  let idDoOutro: string;
  let idNaVizinha: string;

  const pedir = (over: Record<string, unknown> = {}) => ({
    orgId: ORG,
    agentSlug: 'analista',
    modelo: 'claude-opus-5',
    entrada: tamanhoDeTexto('um pedido curto'),
    tokensSaida: 500,
    ...over,
  });

  const noContexto = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto(
      {
        orgId,
        actorType: ActorType.ai,
        actorId: 'analista',
        agentSlug: 'analista',
        correlationId: novaCorrelacao('teste'),
        origem: 'agente',
      },
      fn,
    );

  async function agente(orgId: string, slug: string): Promise<string> {
    const a = await prisma.agent.upsert({
      where: { orgId_slug: { orgId, slug } },
      create: {
        orgId,
        slug,
        nome: slug === 'analista' ? 'Analista' : 'Outro',
        iniciais: 'AN',
        missao: 'medir custo de IA',
        tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo,
        autonomiaAte: RiskLevel.R1,
        capacidades: [],
        tz: FUSO,
      },
      update: { orcamentoMensalUsd: 0, orcamentoAtivo: false, tz: FUSO },
    });
    return a.id;
  }

  /** Um passo de modelo com custo, no instante pedido. */
  async function gastar(p2: {
    orgId: string;
    agentId: string;
    custoUsd: number;
    quando: Date;
    medido?: boolean;
  }): Promise<void> {
    const sessao = await prisma.session.create({
      data: {
        orgId: p2.orgId,
        agentId: p2.agentId,
        canal: SessionCanal.web,
        solicitanteRotulo: 'teste',
        pedido: 'gastar',
        status: SessionStatus.respondida,
        criadaEm: p2.quando,
      },
    });
    await prisma.sessionStep.create({
      data: {
        orgId: p2.orgId,
        sessionId: sessao.id,
        ordem: 1,
        tipo: SessionStepTipo.modelo,
        custoUsd: p2.custoUsd,
        custoEstimado: p2.medido ?? true,
        criadoEm: p2.quando,
      },
    });
  }

  async function definir(slug: string, mensalUsd: number, ativo: boolean): Promise<void> {
    await prisma.agent.updateMany({
      where: { orgId: ORG, slug },
      data: { orcamentoMensalUsd: mensalUsd, orcamentoAtivo: ativo },
    });
  }

  /** O erro que a conferência devolveu, ou `null` quando ela passou. */
  async function conferir(
    orgId: string,
    over: Record<string, unknown> = {},
  ): Promise<OrcamentoDoAgenteEstouradoError | null> {
    return noContexto(orgId, async () => {
      try {
        await svc.conferir(pedir({ orgId, ...over }));
        return null;
      } catch (e) {
        if (e instanceof OrcamentoDoAgenteEstouradoError) return e;
        throw e;
      }
    });
  }

  beforeAll(async () => {
    // Relógio preso no meio do mês: nenhum caso depende da virada, e a suíte
    // não pode passar de dia e falhar na madrugada do dia 1º.
    vi.setSystemTime(new Date('2026-09-14T12:00:00-03:00'));
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    p = prisma as unknown as PrismaService;
    svc = new OrcamentoDeAgenteService(p, new EventLogService(p));

    for (const orgId of [ORG, OUTRA]) {
      await prisma.org.upsert({
        where: { id: orgId },
        create: { id: orgId, name: orgId, slug: orgId },
        update: {},
      });
    }
    idDoAgente = await agente(ORG, 'analista');
    idDoOutro = await agente(ORG, 'redator');
    idNaVizinha = await agente(OUTRA, 'analista');
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.sessionStep.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await prisma.session.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await prisma.agent.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, OUTRA] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.sessionStep.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await prisma.session.deleteMany({ where: { orgId: { in: [ORG, OUTRA] } } });
    await definir('analista', 0, false);
    await definir('redator', 0, false);
    await prisma.agent.updateMany({
      where: { orgId: OUTRA },
      data: { orcamentoMensalUsd: 0, orcamentoAtivo: false },
    });
  });

  it('agente SEM orçamento passa — é o estado de todos antes de alguém decidir', async () => {
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 999, quando: new Date() });
    expect(await conferir(ORG)).toBeNull();
  });

  it('orçamento DESLIGADO não corta, nem quando o mês já passou dele', async () => {
    await definir('analista', 1, false);
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 50, quando: new Date() });

    // Observação: soma, aparece na tela e NÃO recusa. É o modo que permite
    // calibrar o valor antes de impor.
    expect(await conferir(ORG)).toBeNull();
    const c = await noContexto(ORG, () => svc.consumo(ORG, 'analista'));
    expect(c!.ativo).toBe(false);
    expect(c!.gastoUsd).toBeCloseTo(50, 6);
    expect(c!.percentual).toBe(5000);
  });

  it('mês no teto: recusa com causa própria, e o motivo fala de MÊS', async () => {
    await definir('analista', 20, true);
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 20, quando: new Date() });

    const erro = await conferir(ORG);
    expect(erro).toBeInstanceOf(OrcamentoDoAgenteEstouradoError);
    expect(erro!.detalhe.causa).toBe('mes_no_teto');
    expect(erro!.causa).toBe('agente_mes_no_teto');
    expect(erro!.detalhe.mes).toBe('2026-09');
    expect(erro!.motivo).toContain('09/2026');
    expect(erro!.motivo).toContain('virada do mês');
  });

  it('a estimativa desta chamada entra na conta — o corte é ANTES, não depois', async () => {
    /*
     * Encostar sem passar não recusa; o que recusa é "com esta chamada, passa".
     * Um teto que só olhasse o passado cortaria tarde por construção: a chamada
     * que estoura é justamente a que ainda não foi contada.
     */
    await definir('analista', 1, true);
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 0.5, quando: new Date() });
    expect(await conferir(ORG, { tokensSaida: 10 })).toBeNull();

    /*
     * Agora uma chamada grande o bastante para estourar o que RESTA (US$ 0,50),
     * mas menor que o mês inteiro — senão a causa seria `chamada_maior_que_o_mes`,
     * que é outra recusa. 30 mil tokens de saída em Opus dão ~US$ 0,75.
     */
    const erro = await conferir(ORG, { tokensSaida: 30_000 });
    expect(erro!.detalhe.causa).toBe('mes_no_teto');
    expect(erro!.detalhe.estimativaUsd).toBeGreaterThan(0.5);
    expect(erro!.detalhe.estimativaUsd).toBeLessThan(1);
  });

  it('uma chamada maior que o mês inteiro tem causa própria', async () => {
    await definir('analista', 0.001, true);
    const erro = await conferir(ORG, { tokensSaida: 100_000 });
    expect(erro!.detalhe.causa).toBe('chamada_maior_que_o_mes');
  });

  it('orçamento ZERADO valendo tem causa própria — não é "mês no teto"', async () => {
    await definir('analista', 0, true);
    const erro = await conferir(ORG);
    expect(erro!.detalhe.causa).toBe('orcamento_zerado');
    // Dizer "US$ 0,00 de US$ 0,00 já gastos" descreveria como consumo o que é
    // um agente desligado de propósito.
    expect(erro!.motivo).toContain('nenhuma chamada de modelo');
  });

  it('MODELO SEM PREÇO é recusado com orçamento valendo — falha fechada', async () => {
    await definir('analista', 20, true);

    /*
     * CONTROLE NEGATIVO DA DEFESA. Passo com modelo fora da tabela grava custo
     * ZERO (por falta de preço, não por ser grátis): um agente cujo tráfego
     * fosse todo desse modelo nunca somaria nada e passaria para sempre. Este é
     * Este identificador é deliberadamente fictício para continuar fora da
     * tabela mesmo quando o modelo padrão do provider ganha preço conhecido.
     */
    const modeloSemPreco = 'modelo/sem-preco-para-teste';
    const erro = await conferir(ORG, { modelo: modeloSemPreco });
    expect(erro!.detalhe.causa).toBe('modelo_sem_preco');
    // e o RASTRO guarda que a estimativa não era medível — é a procedência da
    // recusa, e sem ela ninguém sabe distinguir isto de "o mês estourou"
    const evento = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'ia.recusada_por_orcamento' },
      /*
       * `seq` e não `ocorreuEm`: o relógio está PRESO nesta suíte, então todos
       * os eventos têm o mesmo carimbo e a ordenação por data é indefinida — o
       * `findFirst` trazia o evento de outro caso. `seq` é monotônico.
       */
      orderBy: { seq: 'desc' },
    });
    expect((evento!.payload as Record<string, unknown>).estimativaMedivel).toBe(false);
    expect(erro!.motivo).toContain('não sabe medir');

    // E com o orçamento DESLIGADO o mesmo modelo passa: isto não é um regime
    // novo imposto a todo mundo, é o preço de ter ligado o orçamento.
    await definir('analista', 20, false);
    expect(await conferir(ORG, { modelo: modeloSemPreco })).toBeNull();
  });

  it('a recusa entra no RASTRO, com a causa e o dinheiro que a decidiu', async () => {
    await definir('analista', 5, true);
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 5, quando: new Date() });
    await conferir(ORG);

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG, tipo: 'ia.recusada_por_orcamento' },
      // `seq` e não `ocorreuEm`: o relógio está preso, e todos os eventos desta
      // suíte têm o mesmo carimbo. Ver o outro caso que lê o rastro.
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(eventos).toHaveLength(1);
    const payload = eventos[0].payload as Record<string, unknown>;
    expect(payload.causa).toBe('mes_no_teto');
    expect(payload.agente).toBe('analista');
    expect(payload.mes).toBe('2026-09');
    expect(Number(payload.orcamentoUsd)).toBeCloseTo(5, 6);
    // o agente aparece no evento: "quantas vezes o orçamento DESTE agente
    // barrou alguém" é pergunta para o rastro, não para uma coluna
    expect(eventos[0].agentSlug).toBe('analista');
  });

  it('gasto de OUTRO agente da mesma empresa não conta no orçamento deste', async () => {
    await definir('analista', 10, true);
    await gastar({ orgId: ORG, agentId: idDoOutro, custoUsd: 100, quando: new Date() });
    expect(await conferir(ORG)).toBeNull();
  });

  it('gasto de OUTRA EMPRESA não conta, nem com o mesmo apelido de agente', async () => {
    await definir('analista', 10, true);
    await gastar({ orgId: OUTRA, agentId: idNaVizinha, custoUsd: 100, quando: new Date() });
    expect(await conferir(ORG)).toBeNull();
  });

  it('gasto de OUTRO MÊS não conta — o orçamento vira na virada', async () => {
    await definir('analista', 10, true);
    await gastar({
      orgId: ORG,
      agentId: idDoAgente,
      custoUsd: 100,
      quando: new Date('2026-08-20T12:00:00-03:00'),
    });
    expect(await conferir(ORG)).toBeNull();

    const c = await noContexto(ORG, () => svc.consumo(ORG, 'analista'));
    expect(c!.mes).toBe('2026-09');
    expect(c!.gastoUsd).toBe(0);
  });

  it('passo NÃO MEDIDO não soma dinheiro, e é contado à parte para a tela dizer', async () => {
    await definir('analista', 10, false);
    await gastar({
      orgId: ORG,
      agentId: idDoAgente,
      custoUsd: 0,
      quando: new Date(),
      medido: false,
    });
    const c = await noContexto(ORG, () => svc.consumo(ORG, 'analista'));
    expect(c!.gastoUsd).toBe(0);
    expect(c!.passos).toBe(1);
    // "não medido" é diferente de "de graça", e a tela precisa poder dizer isso
    expect(c!.passosNaoMedidos).toBe(1);
  });

  it('o panorama traz todos os agentes, com orçamento primeiro e o maior gasto na frente', async () => {
    await definir('analista', 10, true);
    await gastar({ orgId: ORG, agentId: idDoOutro, custoUsd: 3, quando: new Date() });
    await gastar({ orgId: ORG, agentId: idDoAgente, custoUsd: 1, quando: new Date() });

    const lista = await noContexto(ORG, () => svc.panorama(ORG));
    expect(lista.map((o) => o.agentSlug)).toEqual(['analista', 'redator']);
    expect(lista[0].configurado).toBe(true);
    expect(lista[0].gastoUsd).toBeCloseTo(1, 6);
    expect(lista[0].restanteUsd).toBeCloseTo(9, 6);
    expect(lista[0].percentual).toBe(10);
    // Agente sem orçamento aparece com o gasto e SEM percentual: não há contra
    // o que comparar, e um número ali seria inventado.
    expect(lista[1].configurado).toBe(false);
    expect(lista[1].gastoUsd).toBeCloseTo(3, 6);
    expect(lista[1].percentual).toBeNull();
    expect(lista[1].restanteUsd).toBeNull();
  });

  it('ler o orçamento fora do contexto da empresa LANÇA, em vez de dizer "sem orçamento"', async () => {
    /*
     * Sob o papel restrito, consulta sem a empresa na sessão do banco devolve
     * VAZIO, não erro. Entender esse vazio como "não tem orçamento" desligaria
     * o controle em silêncio, que é o pior desfecho para um controle de gasto.
     */
    await expect(
      noContexto(OUTRA, () => svc.consumo(ORG, 'nunca-existiu')),
    ).rejects.toBeInstanceOf(OrcamentoIlegivelError);
  });
});

// ---------------------------------------------------------------------------
// 4. O LAÇO DO AGENTE TRATA A RECUSA — em vez de deixar a sessão pendurada
// ---------------------------------------------------------------------------

const ORG_LACO = 'org-orcamento-laco';

/** Um modelo que recusa por orçamento na primeira chamada. */
class ModeloQueEstouraOrcamento implements LlmProvider {
  readonly name = 'estoura';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;
  readonly motivo =
    'Orçamento mensal de IA do agente "Assistente" atingido em 09/2026: US$ 20,0000 de US$ 20,0000 já gastos.';

  tetoDeSaida(): number {
    return 4000;
  }
  async complete(): Promise<string> {
    return 'n/d';
  }
  async step(): Promise<LlmStepOutput> {
    throw new OrcamentoDoAgenteEstouradoError(this.motivo, {
      orgId: ORG_LACO,
      agentSlug: 'assistente',
      mes: '2026-09',
      causa: 'mes_no_teto',
      orcamentoUsd: 20,
      gastoUsd: 20,
      estimativaUsd: 0.01,
      modelo: 'claude-opus-5',
    });
  }
}

describe.skipIf(!URL)('o laço do agente, diante da recusa por orçamento', () => {
  let prisma: PrismaClient;
  let sessoes: SessionService;
  let runtime: AgentRuntime;

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-09-14T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;

    await prisma.org.upsert({
      where: { id: ORG_LACO },
      create: { id: ORG_LACO, name: 'Laço', slug: ORG_LACO },
      update: {},
    });
    await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG_LACO, slug: 'assistente' } },
      create: {
        orgId: ORG_LACO,
        slug: 'assistente',
        nome: 'Assistente',
        iniciais: 'AS',
        missao: 'responder com fonte',
        tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo,
        autonomiaAte: RiskLevel.R1,
        capacidades: ['numeros.painel.ler'],
      },
      update: { estado: EstadoDeAgente.ativo, ativo: true },
    });

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    sessoes = new SessionService(p);
    const gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      new ApprovalsService(p, audit),
      new EventLogService(p),
    );
    const contexto = {
      montar: async () => ({
        blocos: '',
        fontes: [],
        procedencia: new ProcedenciaExterna(),
      }),
    } as unknown as ContextBuilder;
    const registro = new EfeitosRegistry();
    registro.registrar({ 'numeros.painel.ler': async () => ({ leadsHoje: 1 }) });

    runtime = new AgentRuntime(
      new ModeloQueEstouraOrcamento(),
      p,
      policy,
      gateway,
      contexto,
      sessoes,
      registro,
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: ORG_LACO } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.sessionStep.deleteMany({ where: { orgId: ORG_LACO } });
    await prisma.session.deleteMany({ where: { orgId: ORG_LACO } });
    await prisma.agent.deleteMany({ where: { orgId: ORG_LACO } });
    await prisma.org.deleteMany({ where: { id: ORG_LACO } });
    await prisma.$disconnect();
  });

  it('a sessão fecha como RECUSADA com o motivo, e não fica pendurada', async () => {
    /*
     * A DEFESA QUE ESTE CASO MEDE. Antes da fatia A3 o laço pegava só
     * `TetoDiarioEstouradoError` por nome: a recusa por orçamento ESCAPARIA, e
     * a sessão — já aberta, já com o pedido gravado — ficaria sem situação e
     * sem motivo, para sempre, sem que a tela ou o RASTRO soubessem explicar.
     * Trocar `RecusaDeCustoDeIaError` de volta por um subtipo derruba este caso.
     */
    const r = await runtime.executar({
      orgId: ORG_LACO,
      agentSlug: 'assistente',
      canal: SessionCanal.web,
      pedido: 'quanto entrou hoje?',
      solicitanteRotulo: 'Pedro',
    });

    expect(r.status).toBe(SessionStatus.recusada);
    expect(r.motivo).toContain('Orçamento mensal');
    expect(r.recusaDeTeto?.causa).toBe('agente_mes_no_teto');
    // O orçamento é MENSAL: escrever o dia de hoje aqui faria a resposta
    // afirmar um recorte que não foi o que cortou.
    expect(r.recusaDeTeto?.dia).toBeNull();

    const linha = await prisma.session.findUnique({ where: { id: r.sessionId } });
    expect(linha!.status).toBe(SessionStatus.recusada);
    expect(linha!.motivo).toContain('Orçamento mensal');
  });
});
