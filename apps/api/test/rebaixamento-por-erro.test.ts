import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiskLevel, SessionCanal, SessionStatus } from '@prisma/client';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { ProcedenciaExterna } from '../src/policy/sinais.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { LlmProvider, LlmStepInput, LlmStepOutput } from '../src/llm/llm.provider';
import type { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { acimaDoTetoDoAgente, type ToolGateway } from '../src/gateway/tool-gateway.service';
import type { ContextBuilder } from '../src/agents/context-builder.service';
import type { SessionService, PassoInput } from '../src/agents/session.service';
import {
  DIAS_DA_JANELA,
  JANELA_MS,
  horasDaRotina,
  totalDaSemana,
} from '../../web/src/app/rotinas/horas';

/*
 * ==========================================================================
 * O REBAIXAMENTO POR ERRO TEM EFEITO — RF-N-07
 * ==========================================================================
 *
 * O que esta suíte prova é o que NÃO EXISTIA até a fatia 5.6: `rebaixadoAte`
 * era gravado e não era lido por ninguém. Três afirmações, todas por TENTATIVA
 * e com relógio preso — nenhuma por leitura de campo:
 *
 *   1. duas falhas SEGUIDAS rebaixam; uma falha isolada não;
 *   2. rebaixado, o agente não passa de R1: a chamada de uma capacidade R2 ou
 *      acima NÃO CHEGA À PORTA, e o modelo lê a recusa;
 *   3. passadas as 24h a mesma chamada acontece, sem ninguém ter reativado
 *      nada — a volta é por relógio.
 *
 * SEM BANCO, DE PROPÓSITO. O que está sob teste é DECISÃO do laço, não
 * persistência: quem é chamado, com o quê, e o que deixa de ser chamado. Um
 * banco responderia as mesmas perguntas mais devagar, exigiria
 * `TEST_DATABASE_URL` (e portanto se PULARIA na máquina de quem não o tem — que
 * é o pior desfecho possível para a suíte de uma trava de segurança) e traria
 * junto a régua inteira, que tem suíte própria. É o mesmo argumento de
 * `test/prisma-de-rotinas.ts`.
 *
 * A SEGUNDA METADE DO ARQUIVO mede HORAS DEVOLVIDAS (RF-N-05), e o módulo
 * medido mora no `apps/web`. Um teste de api lendo `.ts` de outro pacote pelo
 * caminho já é padrão daqui — `test/modulos-por-tenant.test.ts` lê
 * `packages/shared/src/nav.ts` exatamente assim, e pelo mesmo motivo: o pacote
 * resolve para `dist/`, que é artefato de build. `horas.ts` é aritmética pura,
 * sem React e sem Next, e o único import dele é `import type`, que o esbuild
 * apaga — não há cadeia a resolver.
 */

// ---------------------------------------------------------------------------
// Os dublês
// ---------------------------------------------------------------------------

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
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        custoUsd: 0.0001,
        custoEstimado: true,
        modeloServido: 'claude-opus-5',
      },
      raw: [],
      ...passo,
    };
  }
}

/** O catálogo de mentira: só o que `paraFerramentas` e o freio precisam. */
const CATALOGO: Record<string, { id: string; descricao: string; nivel: string; ferramenta: string }> =
  {
    'numeros.painel.ler': {
      id: 'numeros.painel.ler',
      descricao: 'lê os números do painel',
      nivel: 'R0',
      ferramenta: 'get_dashboard_summary',
    },
    'pauta.peca.rascunhar': {
      id: 'pauta.peca.rascunhar',
      descricao: 'rascunha uma peça',
      nivel: 'R1',
      ferramenta: 'rascunhar_peca',
    },
    'clickup.tarefa.criar': {
      id: 'clickup.tarefa.criar',
      descricao: 'cria tarefa no ClickUp',
      nivel: 'R2',
      ferramenta: 'clickup_criar',
    },
    'whatsapp.mensagem.enviar': {
      id: 'whatsapp.mensagem.enviar',
      descricao: 'manda mensagem no WhatsApp',
      nivel: 'R3',
      ferramenta: 'whatsapp_enviar',
    },
  };

interface AgenteFalso {
  id: string;
  orgId: string;
  slug: string;
  nome: string;
  missao: string;
  pilar: string | null;
  donoId: string | null;
  estado: string;
  ativo: boolean;
  capacidades: string[];
  autonomiaAte: RiskLevel;
  rebaixadoAte: Date | null;
  rebaixadoPor: string | null;
  modelo: string | null;
  effort: string;
  maxPassos: number;
  tetoCustoUsd: number;
  tetoSegundos: number;
  contextoFixo: string[];
  execucoes: number;
  falhas: number;
  ultimaExecucaoEm: Date | null;
  ultimoStatus: string | null;
  sop: null;
}

const ORG = 'org-rebaixamento';

function agente(over: Partial<AgenteFalso> = {}): AgenteFalso {
  return {
    id: 'ag-1',
    orgId: ORG,
    slug: 'assistente',
    nome: 'Assistente',
    missao: 'responder com fonte',
    pilar: null,
    donoId: null,
    estado: 'rodando',
    ativo: true,
    capacidades: ['numeros.painel.ler', 'clickup.tarefa.criar', 'whatsapp.mensagem.enviar'],
    autonomiaAte: RiskLevel.R3,
    rebaixadoAte: null,
    rebaixadoPor: null,
    modelo: null,
    effort: 'high',
    maxPassos: 4,
    tetoCustoUsd: 0.5,
    tetoSegundos: 180,
    contextoFixo: [],
    execucoes: 0,
    falhas: 0,
    ultimaExecucaoEm: null,
    ultimoStatus: null,
    sop: null,
    ...over,
  };
}

/**
 * O Prisma de mentira — só `agent`, que é a única tabela que o laço toca
 * direto (sessão e traço vão por `SessionService`, que aqui também é dublê).
 *
 * `update` e `updateMany` aplicam de verdade `{ increment }` e a CONDIÇÃO de
 * `ultimoStatus`, porque é exatamente isso que está sob teste: a regra das duas
 * falhas seguidas mora na condição do `UPDATE`.
 */
function prismaFalso(linha: AgenteFalso) {
  const aplicar = (data: Record<string, unknown>) => {
    for (const [campo, valor] of Object.entries(data)) {
      if (valor && typeof valor === 'object' && 'increment' in (valor as object)) {
        const atual = (linha as unknown as Record<string, number>)[campo] ?? 0;
        (linha as unknown as Record<string, number>)[campo] =
          atual + ((valor as { increment: number }).increment ?? 0);
        continue;
      }
      (linha as unknown as Record<string, unknown>)[campo] = valor;
    }
  };

  return {
    linha,
    agent: {
      findFirst: async ({ where }: { where: { orgId: string; slug: string } }) =>
        where.orgId === linha.orgId && where.slug === linha.slug ? linha : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        aplicar(data);
        return linha;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; ultimoStatus?: string };
        data: Record<string, unknown>;
      }) => {
        if (where.id !== linha.id) return { count: 0 };
        if (where.ultimoStatus !== undefined && linha.ultimoStatus !== where.ultimoStatus) {
          return { count: 0 };
        }
        aplicar(data);
        return { count: 1 };
      },
    },
  };
}

interface Bancada {
  runtime: AgentRuntime;
  modelo: ModeloRoteirizado;
  linha: AgenteFalso;
  gateway: { executar: ReturnType<typeof vi.fn> };
  /** Cada capacidade cujo EFEITO a porta de mentira chegou a disparar. */
  efeitos: string[];
  passos: PassoInput[];
}

/*
 * A PORTA DE MENTIRA, e por que ela aplica a REGRA DE VERDADE.
 *
 * O teto do agente rebaixado saiu do laço e foi para a porta em 11/09/2026 —
 * lá ele compara o degrau EFETIVO (o de catálogo mais o que os sinais subiram)
 * e a recusa entra no RASTRO inteira, com `ToolCall`, `PolicyDecision` e evento.
 * Ver o bloco 6-bis de `gateway/tool-gateway.service.ts`.
 *
 * Esta suíte continua sem banco, pelo motivo escrito lá em cima. Para não virar
 * um teste do dublê, o dublê NÃO REESCREVE a regra: ele importa
 * `acimaDoTetoDoAgente` do arquivo da porta e a aplica ao que o laço lhe entregou
 * em `ctx.tetoDoAgente`. O que se mede aqui é o elo — o laço carrega o teto
 * certo até a porta, e o EFEITO não é disparado quando ele morde. A recusa no
 * RASTRO, que é a outra metade, é medida contra banco em `test/porta.test.ts`.
 *
 * Sem sinais no caminho, o degrau efetivo é o de catálogo; `test/porta.test.ts`
 * é quem exercita a diferença entre os dois.
 */
function bancada(linha: AgenteFalso, roteiro: Partial<LlmStepOutput>[]): Bancada {
  const prisma = prismaFalso(linha);
  const modelo = new ModeloRoteirizado(roteiro);
  const passos: PassoInput[] = [];
  const efeitos: string[] = [];

  const gateway = {
    executar: vi.fn(
      async (
        req: {
          capabilityId: string | null;
          args: Record<string, unknown>;
          ctx: { tetoDoAgente?: { nivel: RiskLevel; motivo: string } | null };
        },
        efeito: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        // Capacidade que o catálogo não resolve vale R5 — é o que a porta faz.
        const nivel = (CATALOGO[req.capabilityId ?? '']?.nivel ?? 'R5') as RiskLevel;
        const teto = req.ctx.tetoDoAgente;
        if (teto && acimaDoTetoDoAgente(nivel, teto.nivel)) {
          return {
            status: 'recusado' as const,
            motivo:
              `${teto.motivo} — "${req.capabilityId ?? 'ferramenta sem nome'}" vale ${nivel} ` +
              `depois da régua, e o teto desta janela é ${teto.nivel}.`,
            toolCallId: 'tc-recusado',
            decisao: {
              nivel,
              motivo: 'recusado na porta: autonomia do agente rebaixada por erro (RF-N-07)',
              sinaisAcionados: [],
            },
          };
        }
        efeitos.push(req.capabilityId ?? '(sem nome)');
        await efeito(req.args);
        return {
          status: 'executado' as const,
          resultado: { ok: true },
          toolCallId: 'tc-1',
          decisao: { nivel, motivo: 'ok', sinaisAcionados: [] },
        };
      },
    ),
  };

  const sessoes = {
    abrir: async () => ({ id: 'sess-1' }),
    retomar: async () => null,
    passo: async (_orgId: string, _sessionId: string, p: PassoInput) => {
      passos.push(p);
    },
    encerrar: async () => undefined,
  };

  const contexto = {
    montar: async () => ({ blocos: '', fontes: [], procedencia: new ProcedenciaExterna() }),
  };

  const policy = {
    resolverCapacidade: (_orgId: string, id: string) => CATALOGO[id] ?? null,
  };

  /*
   * Os efeitos das quatro capacidades do catálogo de mentira. Existem porque a
   * porta de mentira agora CHAMA o efeito quando deixa passar — é assim que
   * `efeitos` mede "nada foi executado" no lugar certo, que é o fim da linha, e
   * não "a porta não foi chamada".
   */
  const efeitosRegistrados = new EfeitosRegistry();
  efeitosRegistrados.registrar(
    Object.fromEntries(Object.keys(CATALOGO).map((id) => [id, async () => ({ ok: true })])),
  );

  const runtime = new AgentRuntime(
    modelo,
    prisma as unknown as PrismaService,
    policy as unknown as PolicyService,
    gateway as unknown as ToolGateway,
    contexto as unknown as ContextBuilder,
    sessoes as unknown as SessionService,
    efeitosRegistrados,
  );

  return { runtime, modelo, linha, gateway, efeitos, passos };
}

const pedir = (over: Record<string, unknown> = {}) => ({
  orgId: ORG,
  agentSlug: 'assistente',
  canal: SessionCanal.web,
  pedido: 'faz aí',
  solicitanteRotulo: 'Pedro',
  ...over,
});

/** O texto que voltou ao modelo na chamada `n` (1 = a segunda ida ao modelo). */
function resultadoDaFerramenta(modelo: ModeloRoteirizado, n = 1): string {
  const turno = modelo.chamadas[n]?.turns.find((t) => t.role === 'tool');
  if (!turno || turno.role !== 'tool') return '';
  return turno.results.map((r) => r.content).join('\n');
}

const T0 = new Date('2026-09-11T14:00:00-03:00');

// ---------------------------------------------------------------------------
// 1. Quando o rebaixamento nasce
// ---------------------------------------------------------------------------

describe('o rebaixamento nasce na SEGUNDA falha seguida', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  /*
   * O jeito mais barato de fazer uma sessão FALHAR sem depender de modelo, de
   * régua nem de banco: teto de custo negativo. A primeira volta do laço vê
   * `custo (0) > teto (-1)` e para — status `falhou`, motivo registrado, e
   * nenhum token gasto. É a mesma classe de falha que já acontece em produção
   * (teto estourado), então não é um caso inventado para o teste.
   */
  const seFalhar = (linha: AgenteFalso) => bancada(linha, [{ text: 'nunca', stopReason: 'end_turn' }]);

  it('uma falha isolada NÃO rebaixa — só conta', async () => {
    const linha = agente({ tetoCustoUsd: -1, ultimoStatus: null });
    const b = seFalhar(linha);

    const r = await b.runtime.executar(pedir());

    expect(r.status).toBe(SessionStatus.falhou);
    expect(linha.falhas).toBe(1);
    expect(linha.ultimoStatus).toBe(SessionStatus.falhou);
    expect(linha.rebaixadoAte).toBeNull();
  });

  it('a segunda falha SEGUIDA rebaixa por 24h e registra a sessão que causou', async () => {
    const linha = agente({ tetoCustoUsd: -1, ultimoStatus: null });

    await seFalhar(linha).runtime.executar(pedir());
    expect(linha.rebaixadoAte).toBeNull();

    await seFalhar(linha).runtime.executar(pedir());

    expect(linha.falhas).toBe(2);
    expect(linha.rebaixadoAte).not.toBeNull();
    expect(linha.rebaixadoAte!.getTime()).toBe(T0.getTime() + 86_400_000);
    expect(linha.rebaixadoPor).toBe('sess-1');
  });

  it('um desfecho bom no meio zera a sequência', async () => {
    const linha = agente({ tetoCustoUsd: -1, ultimoStatus: null });
    await seFalhar(linha).runtime.executar(pedir());
    expect(linha.ultimoStatus).toBe(SessionStatus.falhou);

    // agora uma sessão que responde
    linha.tetoCustoUsd = 0.5;
    await bancada(linha, [{ text: 'pronto', stopReason: 'end_turn' }]).runtime.executar(pedir());
    expect(linha.ultimoStatus).toBe(SessionStatus.respondida);

    // e a próxima falha volta a ser a PRIMEIRA da sequência
    linha.tetoCustoUsd = -1;
    await seFalhar(linha).runtime.executar(pedir());
    expect(linha.rebaixadoAte).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. O que o rebaixamento impede — por tentativa, não por leitura
// ---------------------------------------------------------------------------

describe('agente rebaixado não passa do primeiro degrau', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const rebaixadoAte = new Date(T0.getTime() + 86_400_000);

  const pedeFerramenta = (nome: string): Partial<LlmStepOutput>[] => [
    { toolCalls: [{ id: 'c1', name: nome, args: { alvo: 'x' } }], stopReason: 'tool_use' },
    { text: 'expliquei ao usuário o que falta.', stopReason: 'end_turn' },
  ];

  it('R3 não sai: o EFEITO não é disparado, e o laço levou o teto até a porta', async () => {
    const linha = agente({ rebaixadoAte, rebaixadoPor: 'sess-antiga' });
    const b = bancada(linha, pedeFerramenta('whatsapp_enviar'));

    await b.runtime.executar(pedir({ pedido: 'manda o resumo pro grupo' }));

    // Nada executado, nada retido: nenhuma mensagem saiu e nenhuma aprovação
    // nasceu em nome de um agente que está de castigo.
    expect(b.efeitos).toEqual([]);
    // E o elo que faz a trava existir: o teto chegou ao contexto de execução.
    const { ctx } = b.gateway.executar.mock.calls[0][0];
    expect(ctx.tetoDoAgente).toMatchObject({ nivel: 'R1' });
    expect(ctx.tetoDoAgente.motivo).toContain('rebaixada');
  });

  it('R2 também não — o teto é R1', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, pedeFerramenta('clickup_criar'));

    await b.runtime.executar(pedir());

    expect(b.efeitos).toEqual([]);
  });

  it('R0 continua valendo: rebaixado é menos alcance, não agente mudo', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, pedeFerramenta('get_dashboard_summary'));

    const r = await b.runtime.executar(pedir());

    expect(b.efeitos).toEqual(['numeros.painel.ler']);
    expect(r.status).toBe(SessionStatus.respondida);
  });

  it('o modelo lê a recusa, com o prazo e o motivo — e não um sucesso', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, pedeFerramenta('whatsapp_enviar'));

    await b.runtime.executar(pedir());

    const texto = resultadoDaFerramenta(b.modelo);
    expect(texto).toContain('RECUSADO pela régua');
    expect(texto).toContain('autonomia do agente rebaixada');
    expect(texto).toContain('R1');
    expect(texto).toContain('Não tente outro caminho');
  });

  it('a recusa vira passo da sessão, com nível e motivo', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, pedeFerramenta('whatsapp_enviar'));

    await b.runtime.executar(pedir());

    const recusa = b.passos.find((p) => p.tipo === 'ferramenta');
    expect(recusa).toBeDefined();
    expect(recusa!.decisao).toBe('recusado');
    expect(recusa!.capacidade).toBe('whatsapp.mensagem.enviar');
    expect(recusa!.nivel).toBe('R3');
    expect(recusa!.motivo).toContain('rebaixada');
  });

  it('a ferramenta indisponível é anunciada ao modelo antes de ele tentar', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, [{ text: 'ok', stopReason: 'end_turn' }]);

    await b.runtime.executar(pedir());

    const ferramentas = b.modelo.chamadas[0].tools ?? [];
    const zap = ferramentas.find((t) => t.name === 'whatsapp_enviar')!;
    const painel = ferramentas.find((t) => t.name === 'get_dashboard_summary')!;
    expect(zap.description).toContain('INDISPONÍVEL');
    expect(painel.description).not.toContain('INDISPONÍVEL');
  });

  it('ferramenta que o modelo inventou também é barrada (sem classificação vale R5)', async () => {
    const linha = agente({ rebaixadoAte });
    const b = bancada(linha, pedeFerramenta('ferramenta_que_nao_existe'));

    await b.runtime.executar(pedir());

    expect(b.efeitos).toEqual([]);
    expect(resultadoDaFerramenta(b.modelo)).toContain('R5');
  });
});

// ---------------------------------------------------------------------------
// 3. A volta é sozinha, por relógio
// ---------------------------------------------------------------------------

describe('passadas as 24h o agente volta sozinho', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pedeZap: Partial<LlmStepOutput>[] = [
    { toolCalls: [{ id: 'c1', name: 'whatsapp_enviar', args: { corpo: 'oi' } }], stopReason: 'tool_use' },
    { text: 'feito.', stopReason: 'end_turn' },
  ];

  it('a MESMA chamada é barrada dentro da janela e acontece depois dela', async () => {
    const linha = agente({ rebaixadoAte: new Date(T0.getTime() + 86_400_000) });

    // dentro da janela — falta uma hora para vencer
    vi.setSystemTime(new Date(T0.getTime() + 23 * 3_600_000));
    const dentro = bancada(linha, pedeZap);
    await dentro.runtime.executar(pedir());
    expect(dentro.efeitos).toEqual([]);

    /*
     * NADA foi reativado entre uma coisa e outra: o campo `rebaixadoAte`
     * continua exatamente como estava, e nenhuma rotina de limpeza rodou. O que
     * mudou foi o relógio — que é o critério inteiro do RF-N-07.
     */
    const antes = linha.rebaixadoAte;
    vi.setSystemTime(new Date(T0.getTime() + 86_400_000 + 60_000));
    const depois = bancada(linha, pedeZap);
    await depois.runtime.executar(pedir());

    expect(linha.rebaixadoAte).toBe(antes);
    expect(depois.efeitos).toEqual(['whatsapp.mensagem.enviar']);
    // Sem teto de momento nenhum viajando: a volta não deixa resíduo no contexto.
    expect(depois.gateway.executar.mock.calls[0][0].ctx.tetoDoAgente).toBeUndefined();
  });

  it('no instante exato do vencimento já passou — a comparação é estrita', async () => {
    const linha = agente({ rebaixadoAte: new Date(T0.getTime() + 86_400_000) });
    vi.setSystemTime(new Date(T0.getTime() + 86_400_000));
    const b = bancada(linha, pedeZap);

    await b.runtime.executar(pedir());

    expect(b.efeitos).toEqual(['whatsapp.mensagem.enviar']);
  });
});

// ---------------------------------------------------------------------------
// 4. Horas devolvidas — RF-N-05
// ---------------------------------------------------------------------------

/** Uma passagem do log, do jeito que a API a devolve. */
const passagem = (status: 'ok' | 'erro', quandoMs: number) => ({
  id: `e-${quandoMs}-${status}`,
  rotinaId: 'r-1',
  status,
  origem: 'cron',
  inicioEm: new Date(quandoMs).toISOString(),
  fimEm: null,
  duracaoMs: null,
  resumo: null,
  erro: null,
  correlationId: null,
});

describe('horas devolvidas por rotina, contra a linha de base declarada', () => {
  const agora = T0.getTime();
  const hora = 3_600_000;
  const dia = 24 * hora;

  it('sem linha de base declarada não há conta — e não há zero', () => {
    const m = horasDaRotina(
      { minutosPorExecucao: null, execucoes: 40, falhas: 2 },
      [passagem('ok', agora - hora)],
      agora,
    );

    expect(m.estado).toBe('sem-linha-de-base');
    expect(m.minutosNaSemana).toBeNull();
    expect(m.minutosAcumulados).toBeNull();
  });

  it('conta só o que deu certo, e só dentro dos sete dias', () => {
    const m = horasDaRotina(
      { minutosPorExecucao: 30, execucoes: 10, falhas: 4 },
      [
        passagem('ok', agora - hora), // conta
        passagem('ok', agora - 2 * dia), // conta
        passagem('erro', agora - 3 * hora), // falhou: não devolve tempo
        passagem('ok', agora - 8 * dia), // fora da janela
      ],
      agora,
    );

    expect(m.estado).toBe('medida');
    expect(m.execucoesNaSemana).toBe(2);
    expect(m.minutosNaSemana).toBe(60);
    // acumulado honesto: execuções menos falhas, nunca `execucoes` cru
    expect(m.execucoesBemSucedidas).toBe(6);
    expect(m.minutosAcumulados).toBe(180);
  });

  it('a janela está coberta quando o histórico alcança mais de sete dias atrás', () => {
    const m = horasDaRotina(
      { minutosPorExecucao: 15, execucoes: 3, falhas: 0 },
      [passagem('ok', agora - hora), passagem('ok', agora - (JANELA_MS + hora))],
      agora,
    );

    expect(m.janelaCoberta).toBe(true);
    expect(m.execucoesNaSemana).toBe(1);
  });

  it('histórico estourado vira PISO, não total', () => {
    // o endpoint devolveu exatamente o teto, e a linha mais antiga ainda está
    // DENTRO da semana: existe passagem que não coube.
    const limite = 3;
    const linhas = [
      passagem('ok', agora - hora),
      passagem('ok', agora - 2 * hora),
      passagem('ok', agora - 3 * hora),
    ];
    const m = horasDaRotina({ minutosPorExecucao: 20, execucoes: 99, falhas: 0 }, linhas, agora, limite);

    expect(m.janelaCoberta).toBe(false);
    expect(m.minutosNaSemana).toBe(60);
  });

  it('semana sem nenhuma passagem é ZERO medido, e não ausência de medição', () => {
    const m = horasDaRotina({ minutosPorExecucao: 45, execucoes: 5, falhas: 0 }, [], agora);

    expect(m.estado).toBe('medida');
    expect(m.minutosNaSemana).toBe(0);
    expect(m.janelaCoberta).toBe(true);
  });

  it('a janela é de sete dias, e é a constante que a tela anuncia', () => {
    expect(DIAS_DA_JANELA).toBe(7);
    expect(JANELA_MS).toBe(7 * dia);
  });

  it('o total soma o que deu para medir e DECLARA o que ficou de fora', () => {
    const medida = horasDaRotina(
      { minutosPorExecucao: 30, execucoes: 4, falhas: 0 },
      [passagem('ok', agora - hora), passagem('ok', agora - 2 * hora)],
      agora,
    );
    const semBase = horasDaRotina({ minutosPorExecucao: null, execucoes: 9, falhas: 1 }, [], agora);
    const semLog = horasDaRotina({ minutosPorExecucao: 10, execucoes: 2, falhas: 0 }, undefined, agora);

    const t = totalDaSemana([medida, semBase, semLog]);

    expect(t.minutos).toBe(60);
    expect(t.contadas).toBe(1);
    expect(t.semLinhaDeBase).toBe(1);
    expect(t.semHistorico).toBe(1);
    expect(t.vazio).toBe(false);
  });

  it('nada medido é VAZIO — a tela mostra travessão, não "0h"', () => {
    const t = totalDaSemana([
      horasDaRotina({ minutosPorExecucao: null, execucoes: 3, falhas: 0 }, [], agora),
    ]);

    expect(t.vazio).toBe(true);
    expect(t.minutos).toBe(0);
  });
});
