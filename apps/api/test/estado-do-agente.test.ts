import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EstadoDeAgente, RiskLevel, SessionCanal, SessionStatus } from '@prisma/client';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { AgentsService } from '../src/agents/agents.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { ProcedenciaExterna } from '../src/policy/sinais.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { LlmProvider, LlmStepInput, LlmStepOutput } from '../src/llm/llm.provider';
import type { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ToolGateway } from '../src/gateway/tool-gateway.service';
import type { ContextBuilder } from '../src/agents/context-builder.service';
import type { SessionService, PassoInput } from '../src/agents/session.service';
import type { AuditService } from '../src/audit/audit.service';
import type { EventLogService } from '../src/gateway/event-log.service';
import {
  CAUSA_DA_RECUSA,
  ESTADOS_QUE_TRABALHAM,
  EVENTO_DA_TRANSICAO,
  MARGEM_DA_SESSAO_VIVA_MS,
  TRANSICOES,
  estadoTrabalha,
  exigeMotivo,
  postoNaTela,
  recusaPorEstado,
  situacaoDoAgente,
  transicaoPermitida,
} from '../src/agents/estado-do-agente';
import {
  MOTIVOS_DE_HEARTBEAT,
  MOTIVOS_LIGADOS,
  pedidoDoHeartbeat,
} from '../src/agents/heartbeat';

/*
 * ==========================================================================
 * O AGENTE TEM ESTADO, E O ESTADO TEM EFEITO — fatia A2
 * ==========================================================================
 *
 * O que esta suíte trava, defesa por defesa. Cada caso fica VERMELHO se a peça
 * que ele mede sair:
 *
 *   1. VOCABULÁRIO FECHADO. Só `ativo` trabalha, e todo estado que não trabalha
 *      TEM causa nomeada. Um estado novo no enum nasce sem autonomia e sem
 *      recusa nomeada — e o caso reprova até alguém declarar as duas coisas;
 *   2. ENCERRADO NÃO VOLTA. `TRANSICOES.encerrado` é vazio, e nenhuma outra
 *      entrada aponta de volta para ele como origem;
 *   3. O LAÇO RESPEITA O ESTADO, por TENTATIVA: o modelo nem é chamado, a
 *      sessão fecha `recusada` e a recusa entra no RASTRO com causa própria —
 *      que era exatamente o que faltava (o laço já barrava `pausado`, em
 *      silêncio, sem deixar linha nenhuma na cadeia de hash);
 *   4. O BOTÃO "INVOCAR" NÃO É UMA PORTA DOS FUNDOS. Ele passa pelo mesmo
 *      impedimento, e um gatilho que existe no vocabulário mas não está ligado
 *      (os três da fatia A6) NÃO acorda agente nenhum;
 *   5. A DECISÃO TEM PROCEDÊNCIA. Pausar grava autor, data e motivo; repetir o
 *      mesmo estado é 409 e NÃO reescreve a data; encerrar sem motivo é 400.
 *   6. A SITUAÇÃO É DERIVADA, E NÃO MENTE. Sessão pendurada em `rodando` há
 *      meses não faz o agente parecer trabalhando.
 *
 * SEM BANCO, de propósito, pelo mesmo argumento de
 * `test/rebaixamento-por-erro.test.ts`: o que está sob teste é DECISÃO (quem é
 * chamado, o que deixa de ser chamado, o que é gravado), não persistência. E
 * suíte de trava de segurança que se PULA na máquina de quem não tem
 * `TEST_DATABASE_URL` é o pior desfecho possível.
 */

/* ========================================================================== *
 * 1. O vocabulário
 * ========================================================================== */

describe('A2: o vocabulário de estado é fechado', () => {
  it('só `ativo` trabalha — estado novo no enum nasce sem autonomia', () => {
    expect([...ESTADOS_QUE_TRABALHAM]).toEqual([EstadoDeAgente.ativo]);
    expect(estadoTrabalha(EstadoDeAgente.ativo)).toBe(true);
    for (const e of [EstadoDeAgente.planejado, EstadoDeAgente.pausado, EstadoDeAgente.encerrado]) {
      expect(estadoTrabalha(e)).toBe(false);
    }
  });

  it('todo estado que não trabalha tem causa e frase próprias', () => {
    for (const estado of Object.values(EstadoDeAgente)) {
      const recusa = recusaPorEstado(estado);
      if (estadoTrabalha(estado)) {
        expect(recusa).toBeNull();
        continue;
      }
      // Causa é rótulo estável para agrupar no rastro; frase é o que a pessoa lê.
      expect(recusa?.causa).toMatch(/^agente_[a-z]+$/);
      expect(recusa?.motivo.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('as causas não se repetem — contagem por causa tem de separar os casos', () => {
    const causas = Object.values(CAUSA_DA_RECUSA).map((c) => c.causa);
    expect(new Set(causas).size).toBe(causas.length);
  });

  it('todo estado do enum tem transições declaradas e evento de rastro', () => {
    for (const estado of Object.values(EstadoDeAgente)) {
      expect(TRANSICOES[estado]).toBeDefined();
      expect(EVENTO_DA_TRANSICAO[estado]).toMatch(/^agente\./);
    }
  });

  it('ENCERRADO NÃO VOLTA: nenhuma transição sai de encerrado', () => {
    expect([...TRANSICOES.encerrado]).toEqual([]);
    for (const destino of Object.values(EstadoDeAgente)) {
      expect(transicaoPermitida(EstadoDeAgente.encerrado, destino)).toBe(false);
    }
  });

  it('todo estado alcança encerrado — tirar de circulação não depende de passar por pausado', () => {
    for (const origem of Object.values(EstadoDeAgente)) {
      if (origem === EstadoDeAgente.encerrado) continue;
      expect(transicaoPermitida(origem, EstadoDeAgente.encerrado)).toBe(true);
    }
  });

  it('a lista abre pelos que TRABALHAM, não pela ordem de declaração do enum', () => {
    /*
     * O enum está declarado na ordem do ciclo de vida (`planejado` primeiro), e
     * `ORDER BY estado` usaria exatamente essa ordem — foi o que fez a lista
     * passar a abrir com os agentes que nunca foram ligados. Este caso trava a
     * ordem da TELA no lugar onde ela está escrita.
     */
    const postos = Object.values(EstadoDeAgente).map((e) => [e, postoNaTela(e)] as const);
    const ordenados = [...postos].sort((a, b) => a[1] - b[1]).map(([e]) => e);
    expect(ordenados[0]).toBe(EstadoDeAgente.ativo);
    expect(ordenados[ordenados.length - 1]).toBe(EstadoDeAgente.encerrado);
    expect(new Set(postos.map(([, p]) => p)).size).toBe(postos.length);
  });

  it('só encerrar exige motivo escrito — pausar é freio e freio tem de ser rápido', () => {
    expect(exigeMotivo(EstadoDeAgente.encerrado)).toBe(true);
    expect(exigeMotivo(EstadoDeAgente.pausado)).toBe(false);
    expect(exigeMotivo(EstadoDeAgente.ativo)).toBe(false);
  });
});

/* ========================================================================== *
 * 2. A situação derivada
 * ========================================================================== */

const AGORA = new Date('2026-09-13T12:00:00.000Z');

function linhaDeAgente(over: Record<string, unknown> = {}) {
  return {
    id: 'ag-1',
    orgId: 'org-a2',
    slug: 'assistente',
    nome: 'Assistente',
    missao: 'responder com fonte',
    pilar: null as string | null,
    donoId: null as string | null,
    estado: EstadoDeAgente.ativo as EstadoDeAgente,
    ativo: true,
    capacidades: ['numeros.painel.ler'],
    autonomiaAte: RiskLevel.R1,
    rebaixadoAte: null as Date | null,
    rebaixadoPor: null as string | null,
    estadoPorId: null as string | null,
    estadoEm: null as Date | null,
    estadoMotivo: null as string | null,
    modelo: null as string | null,
    effort: 'high',
    maxPassos: 4,
    tetoCustoUsd: 0.5,
    tetoSegundos: 180,
    contextoFixo: [] as string[],
    execucoes: 0,
    falhas: 0,
    minutosPorExecucao: 0,
    baselinePorId: null as string | null,
    baselineEm: null as Date | null,
    ultimaExecucaoEm: null as Date | null,
    ultimoStatus: null as string | null,
    proximaExecucaoEm: null as Date | null,
    cron: null as string | null,
    tz: 'America/Sao_Paulo',
    tipo: 'llm',
    iniciais: 'AS',
    sop: null,
    ...over,
  };
}

const sessaoViva = (quandoMs: number) => ({
  agentId: 'ag-1',
  status: SessionStatus.rodando,
  ultimaAtividadeEm: new Date(AGORA.getTime() - quandoMs),
});

describe('A2: a situação é derivada e não mente', () => {
  it('estado que não trabalha responde por si — nunca "ocioso"', () => {
    for (const estado of [
      EstadoDeAgente.pausado,
      EstadoDeAgente.encerrado,
      EstadoDeAgente.planejado,
    ]) {
      expect(situacaoDoAgente(linhaDeAgente({ estado }), [], AGORA)).toBe(estado);
    }
  });

  it('ativo com sessão viva agora está RODANDO', () => {
    expect(situacaoDoAgente(linhaDeAgente(), [sessaoViva(5_000)], AGORA)).toBe('rodando');
  });

  it('SESSÃO PENDURADA NÃO FAZ O SELO FICAR VERDE PARA SEMPRE', () => {
    /*
     * `Session.status` nasce `rodando` e só sai disso quando alguém a encerra: um
     * processo que morre no meio deixa a linha aberta indefinidamente. Este caso é
     * a defesa contra derivar o selo direto dela — passado o teto de tempo do
     * agente mais a margem, aquilo é abandono, não trabalho.
     */
    const velha = 180 * 1000 + MARGEM_DA_SESSAO_VIVA_MS + 1;
    expect(situacaoDoAgente(linhaDeAgente(), [sessaoViva(velha)], AGORA)).toBe('ocioso');
  });

  it('sessão de OUTRO agente não conta', () => {
    const deOutro = { ...sessaoViva(1_000), agentId: 'ag-99' };
    expect(situacaoDoAgente(linhaDeAgente(), [deOutro], AGORA)).toBe('ocioso');
  });

  it('última passagem falhou = ERRO; e rodando agora vence o erro de ontem', () => {
    const comFalha = linhaDeAgente({ ultimoStatus: SessionStatus.falhou });
    expect(situacaoDoAgente(comFalha, [], AGORA)).toBe('erro');
    expect(situacaoDoAgente(comFalha, [sessaoViva(1_000)], AGORA)).toBe('rodando');
  });

  it('ativo, sem sessão e sem falha = OCIOSO', () => {
    expect(situacaoDoAgente(linhaDeAgente({ ultimoStatus: 'respondida' }), [], AGORA)).toBe(
      'ocioso',
    );
  });
});

/* ========================================================================== *
 * 3. Os gatilhos de heartbeat
 * ========================================================================== */

describe('A2: o heartbeat manual é o único ligado', () => {
  it('A6 ainda não chegou — só `manual` dispara', () => {
    expect([...MOTIVOS_LIGADOS]).toEqual(['manual']);
  });

  it('os quatro gatilhos do plano estão declarados', () => {
    expect([...MOTIVOS_DE_HEARTBEAT]).toEqual([
      'manual',
      'atribuicao',
      'mencao',
      'aprovacao_resolvida',
    ]);
  });

  it('cada gatilho já tem a frase de abertura — A6 só liga, não reescreve', () => {
    for (const motivo of MOTIVOS_DE_HEARTBEAT) {
      expect(pedidoDoHeartbeat(motivo).length).toBeGreaterThan(40);
    }
  });

  it('a nota do dono entra marcada, e não substitui o pedido', () => {
    const pedido = pedidoDoHeartbeat('manual', { nota: 'olhe o cliente Sucopira' });
    expect(pedido).toContain('Passagem manual');
    expect(pedido).toContain('Recado do dono: olhe o cliente Sucopira');
  });
});

/* ========================================================================== *
 * 4. O laço respeita o estado
 * ========================================================================== */

class ModeloQueContaChamada implements LlmProvider {
  readonly name = 'conta';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;
  chamadas: LlmStepInput[] = [];

  async complete(): Promise<string> {
    return 'n/d';
  }

  tetoDeSaida(): number {
    return 4000;
  }

  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas.push(input);
    return {
      text: 'pronto',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        custoUsd: 0,
        custoEstimado: true,
        modeloServido: 'claude-opus-5',
      },
      raw: [],
    };
  }
}

interface EventoGravado {
  tipo: string;
  payload?: Record<string, unknown>;
  agentSlug?: string | null;
  /** Os campos nomeados pela política. A A4 lê `argumentos.causa` daqui. */
  conteudo?: Record<string, unknown>;
}

function bancadaDoLaco(linha: ReturnType<typeof linhaDeAgente>) {
  const modelo = new ModeloQueContaChamada();
  const passos: PassoInput[] = [];
  const encerramentos: { status: SessionStatus; motivo?: string | null }[] = [];
  const eventos: EventoGravado[] = [];
  const abertas: { pedido: string }[] = [];

  const prisma = {
    agent: {
      findFirst: async ({ where }: { where: { orgId: string; slug: string } }) =>
        where.orgId === linha.orgId && where.slug === linha.slug ? linha : null,
      update: async () => linha,
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService;

  const sessoes = {
    abrir: async (i: { pedido: string }) => {
      abertas.push({ pedido: i.pedido });
      return { id: 'sess-1' };
    },
    retomar: async () => null,
    passo: async (_o: string, _s: string, p: PassoInput) => {
      passos.push(p);
    },
    encerrar: async (_id: string, f: { status: SessionStatus; motivo?: string | null }) => {
      encerramentos.push(f);
    },
  } as unknown as SessionService;

  const eventLog = {
    registrar: async (e: EventoGravado) => {
      eventos.push(e);
      return { id: 'ev', seq: 1n, hash: 'h' };
    },
  } as unknown as EventLogService;

  const runtime = new AgentRuntime(
    modelo,
    prisma,
    { resolverCapacidade: () => null } as unknown as PolicyService,
    { executar: vi.fn() } as unknown as ToolGateway,
    {
      montar: async () => ({ blocos: '', fontes: [], procedencia: new ProcedenciaExterna() }),
    } as unknown as ContextBuilder,
    sessoes,
    new EfeitosRegistry(),
    eventLog,
  );

  return { runtime, modelo, passos, encerramentos, eventos, abertas };
}

const pedidoBase = {
  orgId: 'org-a2',
  agentSlug: 'assistente',
  canal: SessionCanal.web,
  solicitanteId: 'u-pedro',
  solicitanteRotulo: 'Pedro',
};

describe('A2: o laço recusa passagem por estado, e a recusa entra no rastro', () => {
  for (const estado of [EstadoDeAgente.pausado, EstadoDeAgente.encerrado]) {
    it(`agente ${estado} NÃO chama o modelo, e a sessão fecha recusada`, async () => {
      const b = bancadaDoLaco(linhaDeAgente({ estado }));
      const r = await b.runtime.executar({ ...pedidoBase, pedido: 'faça algo' });

      expect(b.modelo.chamadas).toHaveLength(0);
      expect(r.status).toBe(SessionStatus.recusada);
      expect(b.encerramentos[0]?.status).toBe(SessionStatus.recusada);
      expect(r.motivo ?? r.resposta).toContain(
        estado === EstadoDeAgente.pausado ? 'pausado' : 'encerrado',
      );
    });

    it(`a recusa de agente ${estado} vira evento com causa própria`, async () => {
      const b = bancadaDoLaco(linhaDeAgente({ estado }));
      await b.runtime.executar({ ...pedidoBase, pedido: 'faça algo' });

      const ev = b.eventos.find((e) => e.tipo === 'agente.passagem_recusada');
      expect(ev, 'sem esta linha ninguém consegue contar quantas vezes o agente parado foi chamado')
        .toBeDefined();
      expect(ev?.payload?.causa).toBe(CAUSA_DA_RECUSA[estado].causa);
      expect(ev?.payload?.estado).toBe(estado);
      expect(ev?.agentSlug).toBe('assistente');
    });
  }

  it('agente ativo roda — o freio só morde quem foi freado', async () => {
    const b = bancadaDoLaco(linhaDeAgente());
    const r = await b.runtime.executar({ ...pedidoBase, pedido: 'quais os números?' });
    expect(b.modelo.chamadas.length).toBeGreaterThan(0);
    expect(r.status).not.toBe(SessionStatus.recusada);
    expect(b.eventos.some((e) => e.tipo === 'agente.passagem_recusada')).toBe(false);
  });

  it('planejado e sem capacidade continuam recusando, cada um com a sua causa', async () => {
    const planejado = bancadaDoLaco(linhaDeAgente({ estado: EstadoDeAgente.planejado }));
    await planejado.runtime.executar({ ...pedidoBase, pedido: 'x' });
    expect(
      planejado.eventos.find((e) => e.tipo === 'agente.passagem_recusada')?.payload?.causa,
    ).toBe('agente_planejado');

    const semCapacidade = bancadaDoLaco(linhaDeAgente({ capacidades: [] }));
    await semCapacidade.runtime.executar({ ...pedidoBase, pedido: 'x' });
    expect(
      semCapacidade.eventos.find((e) => e.tipo === 'agente.passagem_recusada')?.payload?.causa,
    ).toBe('agente_sem_capacidade');
  });
});

describe('A2: "Invocar" é o gatilho manual, e não uma porta dos fundos', () => {
  it('monta o pedido do heartbeat em vez de aceitar texto de quem clicou', async () => {
    const b = bancadaDoLaco(linhaDeAgente());
    await b.runtime.invocar({ ...pedidoBase, nota: 'foco no Sucopira' });

    expect(b.abertas[0]?.pedido).toContain('Passagem manual');
    expect(b.abertas[0]?.pedido).toContain('Recado do dono: foco no Sucopira');
  });

  it('registra QUEM apertou o botão, na cadeia de hash', async () => {
    const b = bancadaDoLaco(linhaDeAgente());
    await b.runtime.invocar(pedidoBase);
    const ev = b.eventos.find((e) => e.tipo === 'agente.invocado');
    expect(ev?.payload?.gatilho).toBe('manual');
    expect(ev?.agentSlug).toBe('assistente');
  });

  it('NÃO passa por cima do estado: invocar um agente pausado é recusado', async () => {
    const b = bancadaDoLaco(linhaDeAgente({ estado: EstadoDeAgente.pausado }));
    const r = await b.runtime.invocar(pedidoBase);
    expect(r.status).toBe(SessionStatus.recusada);
    expect(b.modelo.chamadas).toHaveLength(0);
    expect(
      b.eventos.find((e) => e.tipo === 'agente.passagem_recusada')?.payload?.causa,
    ).toBe('agente_pausado');
  });

  it('gatilho declarado mas não ligado (A6) NÃO acorda agente', async () => {
    const b = bancadaDoLaco(linhaDeAgente());
    await expect(b.runtime.invocar({ ...pedidoBase, motivo: 'mencao' })).rejects.toThrow(
      /não está ligado/,
    );
    expect(b.modelo.chamadas).toHaveLength(0);
    expect(b.abertas).toHaveLength(0);
  });
});

/* ========================================================================== *
 * 5. Pausar, retomar e encerrar — a decisão tem procedência
 * ========================================================================== */

/**
 * A bancada do serviço de estado.
 *
 * `tarefasPresas` existe por causa da fatia A4: `definirEstado` solta as
 * tarefas que o agente tem na mão, na MESMA transação da mudança de estado. O
 * dublê de `workTask` abaixo é o que faz esta suíte continuar medindo a A2 sem
 * cegar a A4 — construir o serviço com um checkout falso deixaria a soltura
 * acontecer só em produção.
 */
function bancadaDoServico(
  linha: ReturnType<typeof linhaDeAgente>,
  tarefasPresas: Array<{ id: string; title: string; agenteEm: Date | null }> = [],
) {
  const eventos: EventoGravado[] = [];
  const auditados: { action: string; before?: unknown; after?: unknown }[] = [];
  const soltas: string[] = [];

  const prisma = {
    /*
     * A transação do dublê é PASS-THROUGH: ela executa o corpo com o mesmo
     * `prisma` de dentro. O que esta suíte mede não é o isolamento da transação
     * (isso pede banco de verdade, e está em `checkout-de-tarefa.test.ts`) — é
     * que a mudança de estado CHAMA a soltura, e com que causa.
     */
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
    workTask: {
      findMany: async ({ where }: { where: { agenteId?: string } }) =>
        where.agenteId === linha.id ? tarefasPresas.map((t) => ({ ...t })) : [],
      updateMany: async ({ where }: { where: { agenteId?: string } }) => {
        if (where.agenteId !== linha.id) return { count: 0 };
        for (const t of tarefasPresas) soltas.push(t.id);
        tarefasPresas.length = 0;
        return { count: soltas.length };
      },
    },
    agent: {
      /*
       * DEVOLVE UMA CÓPIA, como o Prisma de verdade devolve.
       *
       * A primeira versão deste dublê devolvia a própria `linha`, e o caso
       * "pausar registra de → para" reprovou com `de: 'pausado'`: a escrita
       * mutava o mesmo objeto que o serviço tinha lido. Era defeito do dublê,
       * mas apontou para código frágil de verdade — o serviço passou a copiar o
       * estado anterior para uma constante antes do `update`. Dublê que
       * compartilha referência esconde exatamente essa classe de bug.
       */
      findFirst: async ({ where }: { where: { orgId: string; slug: string } }) =>
        where.orgId === linha.orgId && where.slug === linha.slug ? { ...linha } : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(linha, data);
        return { ...linha };
      },
    },
    session: { findMany: async () => [] },
  } as unknown as PrismaService;

  const audit = {
    log: async (e: { action: string; before?: unknown; after?: unknown }) => {
      auditados.push(e);
    },
  } as unknown as AuditService;
  const rastro = {
    registrar: async (e: EventoGravado) => {
      eventos.push(e);
      return { id: 'ev', seq: 1n, hash: 'h' };
    },
  } as unknown as EventLogService;

  /*
   * O CHECKOUT É O DE VERDADE, sobre o dublê de banco — não um `vi.fn()`. É a
   * diferença entre provar que a soltura acontece e provar que alguém a chamou.
   */
  const servico = new AgentsService(
    prisma,
    audit,
    new CheckoutDeTarefaService(prisma, audit, rastro),
    rastro,
  );

  return { servico, linha, eventos, auditados, soltas };
}

describe('A2: pausar, retomar e encerrar pela mão do dono', () => {
  it('pausar grava estado, DESLIGA o interruptor e registra quem, quando e por quê', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.pausado, {
      userId: 'u-pedro',
      motivo: 'está mandando mensagem errada',
    });

    expect(r.estado).toBe(EstadoDeAgente.pausado);
    expect(b.linha.estado).toBe(EstadoDeAgente.pausado);
    /*
     * O ESTADO E O INTERRUPTOR ANDAM JUNTOS. Se `ativo` ficar `true`, o
     * agendamento continua buscando este agente e o laço o recusa passagem por
     * passagem: barulho no rastro sem efeito nenhum.
     */
    expect(b.linha.ativo).toBe(false);
    expect(b.linha.estadoPorId).toBe('u-pedro');
    expect(b.linha.estadoEm).toBeInstanceOf(Date);
    expect(b.linha.estadoMotivo).toBe('está mandando mensagem errada');

    const ev = b.eventos.find((e) => e.tipo === 'agente.pausado');
    expect(ev?.payload).toMatchObject({ de: EstadoDeAgente.ativo, para: EstadoDeAgente.pausado });
    expect(b.auditados.map((a) => a.action)).toContain('agente.pausado');
  });

  it('pausar de novo é 409 e PRESERVA a data de quando ele parou', async () => {
    const desde = new Date('2026-09-01T10:00:00.000Z');
    const b = bancadaDoServico(
      linhaDeAgente({
        estado: EstadoDeAgente.pausado,
        ativo: false,
        estadoEm: desde,
        estadoPorId: 'u-lucas',
      }),
    );

    await expect(
      b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.pausado, {
        userId: 'u-pedro',
      }),
    ).rejects.toThrow(/já está pausado/);

    // É esta data que responde "desde quando este agente está parado?".
    expect(b.linha.estadoEm).toBe(desde);
    expect(b.linha.estadoPorId).toBe('u-lucas');
    expect(b.eventos).toHaveLength(0);
  });

  it('retomar religa o interruptor e deixa a marca de quem religou', async () => {
    const b = bancadaDoServico(
      linhaDeAgente({ estado: EstadoDeAgente.pausado, ativo: false, estadoPorId: 'u-lucas' }),
    );
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.ativo, {
      userId: 'u-pedro',
    });

    expect(r.estado).toBe(EstadoDeAgente.ativo);
    expect(b.linha.ativo).toBe(true);
    expect(b.linha.estadoPorId).toBe('u-pedro');
    expect(b.eventos.some((e) => e.tipo === 'agente.retomado')).toBe(true);
  });

  it('ENCERRAR SEM MOTIVO É RECUSADO — decisão definitiva pede razão escrita', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    await expect(
      b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.encerrado, {
        userId: 'u-pedro',
      }),
    ).rejects.toThrow(/Escreva o motivo/);
    expect(b.linha.estado).toBe(EstadoDeAgente.ativo);
    expect(b.eventos).toHaveLength(0);
  });

  it('encerrar tira de circulação e o rastro diz que não tem volta', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.encerrado, {
      userId: 'u-pedro',
      motivo: 'trabalho absorvido pela rotina de pauta',
    });

    expect(b.linha.estado).toBe(EstadoDeAgente.encerrado);
    expect(b.linha.ativo).toBe(false);
    const ev = b.eventos.find((e) => e.tipo === 'agente.encerrado');
    expect(ev).toBeDefined();
  });

  it('AGENTE ENCERRADO NÃO VOLTA, nem por retomar nem por pausar', async () => {
    const b = bancadaDoServico(
      linhaDeAgente({ estado: EstadoDeAgente.encerrado, ativo: false }),
    );

    for (const destino of [EstadoDeAgente.ativo, EstadoDeAgente.pausado]) {
      await expect(
        b.servico.definirEstado('org-a2', 'assistente', destino, {
          userId: 'u-pedro',
          motivo: 'mudei de ideia',
        }),
      ).rejects.toThrow(/encerrado não volta/);
    }
    expect(b.linha.estado).toBe(EstadoDeAgente.encerrado);
    expect(b.eventos).toHaveLength(0);
  });

  it('agente de outra empresa não é encontrado — o escopo é por empresa', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    await expect(
      b.servico.definirEstado('org-vizinha', 'assistente', EstadoDeAgente.pausado, {
        userId: 'u-pedro',
      }),
    ).rejects.toThrow(/não existe/);
    expect(b.linha.estado).toBe(EstadoDeAgente.ativo);
  });

  it('a resposta já diz para onde dá para ir daqui — a tela não deduz a regra', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.pausado, {
      userId: 'u-pedro',
    });
    expect(r.transicoes).toEqual([...TRANSICOES.pausado]);
  });

  it('motivo comprido é cortado, não recusado — freio não trava por redação', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.encerrado, {
      userId: 'u-pedro',
      motivo: 'x'.repeat(900),
    });
    expect(b.linha.estadoMotivo).toHaveLength(500);
  });

  /* ---- a ligação com a fatia A4: quem para, solta o que tem na mão ---- */

  it('PAUSAR SOLTA as tarefas que o agente tem na mão, e a resposta diz quais', async () => {
    const b = bancadaDoServico(linhaDeAgente(), [
      { id: 't-1', title: 'Fechar o mês', agenteEm: new Date('2026-09-14T10:00:00Z') },
      { id: 't-2', title: 'Conciliar cartão', agenteEm: null },
    ]);
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.pausado, {
      userId: 'u-pedro',
    });
    expect(b.soltas).toEqual(['t-1', 't-2']);
    expect(r.tarefasSoltas.map((t) => t.titulo)).toEqual(['Fechar o mês', 'Conciliar cartão']);
  });

  it('a soltura entra no RASTRO uma vez POR TAREFA, com a causa do estado', async () => {
    const b = bancadaDoServico(linhaDeAgente(), [
      { id: 't-1', title: 'Fechar o mês', agenteEm: null },
      { id: 't-2', title: 'Conciliar cartão', agenteEm: null },
    ]);
    await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.encerrado, {
      userId: 'u-pedro',
      motivo: 'não serve mais',
    });
    const soltadas = b.eventos.filter((e) => e.tipo === 'tarefa.soltada');
    expect(soltadas).toHaveLength(2);
    expect(soltadas.map((e) => e.payload?.taskId)).toEqual(['t-1', 't-2']);
    /*
     * A causa distingue "alguém devolveu" de "o agente saiu de circulação", e é
     * ela que responde, meses depois, por que a tarefa voltou para a fila.
     */
    expect(
      (soltadas[0]?.conteudo as { argumentos?: { causa?: string } })?.argumentos?.causa,
    ).toBe('agente_encerrado');
  });

  it('RETOMAR não solta nem devolve tarefa — quem voltou escolhe de novo', async () => {
    const b = bancadaDoServico(linhaDeAgente({ estado: EstadoDeAgente.pausado, ativo: false }), [
      { id: 't-1', title: 'Tarefa de outro agente agora', agenteEm: null },
    ]);
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.ativo, {
      userId: 'u-pedro',
    });
    expect(b.soltas).toEqual([]);
    expect(r.tarefasSoltas).toEqual([]);
    expect(b.eventos.some((e) => e.tipo === 'tarefa.soltada')).toBe(false);
  });

  it('pausar agente SEM tarefa na mão não registra soltura nenhuma', async () => {
    const b = bancadaDoServico(linhaDeAgente());
    const r = await b.servico.definirEstado('org-a2', 'assistente', EstadoDeAgente.pausado, {
      userId: 'u-pedro',
    });
    expect(r.tarefasSoltas).toEqual([]);
    expect(b.eventos.some((e) => e.tipo === 'tarefa.soltada')).toBe(false);
  });
});

/* ========================================================================== *
 * 6. A semente não ressuscita quem foi parado
 * ========================================================================== */

describe('A2: o reparo do roster NÃO desfaz a decisão do dono', () => {
  /*
   * `semearRosterDeEntrada` roda no cadastro E na leitura de estado ("o roster
   * incompleto é REPARADO na leitura", `test/onboarding.test.ts`). Se o `update`
   * do agente que JÁ EXISTE escrevesse `estado` ou `ativo`, todo agente pausado
   * voltaria a rodar no próximo carregamento de tela, e todo agente ENCERRADO
   * ressuscitaria — sem clique de ninguém e sem linha no rastro. A promessa
   * "encerrado não volta" morreria aí.
   *
   * A trava é sobre o CÓDIGO-FONTE porque é uma ausência que está sob teste, e
   * ausência não se exercita com dublê: o que se mede é que aqueles dois campos
   * continuam fora do `data`. Mesma técnica das catracas de
   * `test/arquitetura.test.ts`.
   */
  it('o `update` do agente existente não toca `estado` nem `ativo`', () => {
    const fonte = readFileSync(
      path.join(__dirname, '..', 'src', 'agents', 'roster', 'semear.ts'),
      'utf8',
    );
    const inicio = fonte.indexOf('if (existente) {');
    const fim = fonte.indexOf('resumo.jaExistiam.push');
    expect(inicio, 'o bloco do agente já existente mudou de forma — releia antes de confiar').
      toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);

    const bloco = fonte.slice(inicio, fim);
    const semComentario = bloco.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(semComentario).not.toMatch(/\bestado\s*:/);
    expect(semComentario).not.toMatch(/\bativo\s*:/);
  });
});
