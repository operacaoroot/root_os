import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { funcaoPorId } from '@mktos/shared';

import { ProviderComTeto } from '../src/llm/provider-com-teto';
import { MedidorDeGastoExterno, tokensDaRespostaDeEmbedding } from '../src/llm/gasto-externo';
import { OrcamentoIlegivelError } from '../src/llm/orcamento-de-agente.service';
import { TetoDiarioEstouradoError } from '../src/llm/teto-diario.service';
import { FUNCAO_DA_TRANSCRICAO, TranscricaoIndisponivelError, TranscricaoService, custoDoUso } from '../src/llm/transcricao.provider';
import type { LlmProvider, LlmStepOutput } from '../src/llm/llm.provider';
import { quemGastou } from '../src/llm/gasto-por-funcao.service';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { PautaService } from '../src/pauta/pauta.service';

/*
 * O ENVELOPE DO MODELO E O GASTO QUE NÃO É CONVERSA (rodada dos agentes, 21/10/2026, A1).
 *
 *  · a reserva do teto usa o modelo que a FUNÇÃO escolhe, não o padrão do provedor;
 *  · o agente da chamada é o `agentSlug`, senão o slug da função; função sem
 *    registro `Agent` não é recusada pelo orçamento por isso;
 *  · toda chamada soma no livro por função;
 *  · vetorização e transcrição passam pelo teto: reserva ANTES, acerto depois,
 *    recusa sem chamar o fornecedor.
 */

const ORG = 'org-envelope';

function tetoFalso(opcoes: { recusar?: boolean } = {}) {
  const chamadas: string[] = [];
  const reservas: Array<Record<string, unknown>> = [];
  const teto = {
    reservar: vi.fn(async (p: Record<string, unknown>) => {
      chamadas.push('reservar');
      reservas.push(p);
      if (opcoes.recusar) {
        throw new TetoDiarioEstouradoError('o dia fechou', {
          orgId: ORG, dia: '2026-10-21', causa: 'dia_no_teto', tetoUsd: 1, gastoUsd: 1, gastoEstimadoUsd: 0,
          reservadoUsd: 0, estimativaUsd: 0.1, modelo: String(p.modelo),
        } as never);
      }
      return { orgId: ORG, dia: '2026-10-21', modelo: p.modelo, valorUsd: 0.01, medivel: true, entrada: p.entrada };
    }),
    reservarValor: vi.fn(async (p: Record<string, unknown>) => {
      chamadas.push('reservarValor');
      reservas.push(p);
      if (opcoes.recusar) throw new TetoDiarioEstouradoError('o dia fechou', { orgId: ORG } as never);
      return { orgId: ORG, dia: '2026-10-21', modelo: p.modelo, valorUsd: p.usd, medivel: true };
    }),
    liquidar: vi.fn(async () => void chamadas.push('liquidar')),
    liquidarPeloObservado: vi.fn(async () => void chamadas.push('liquidarPeloObservado')),
    soltar: vi.fn(async () => void chamadas.push('soltar')),
    motivoDeCorte: vi.fn(async () => null),
  };
  return { teto, chamadas, reservas };
}

function gastoFalso() {
  const lancamentos: Array<Record<string, unknown>> = [];
  return { lancamentos, registrar: vi.fn(async (l: Record<string, unknown>) => void lancamentos.push(l)) };
}

/** Um provedor de dublê que escolhe o modelo pela função, como o `anthropic`. */
function interno(): LlmProvider & { recebidos: unknown[] } {
  const recebidos: unknown[] = [];
  const escolher = (i: { funcao?: string; model?: string }) => ({
    modelo: i.model ?? funcaoPorId(i.funcao ?? '')?.modelo ?? 'claude-opus-5-5',
  });
  return {
    name: 'duble',
    model: 'claude-opus-5-5',
    configured: true,
    supportsTools: true,
    buscaNaWeb: true,
    recebidos,
    modeloDaChamada: escolher,
    tetoDeSaida: () => 1000,
    complete: async (i) => {
      recebidos.push(i);
      return 'resposta curta';
    },
    step: async (i): Promise<LlmStepOutput> => {
      recebidos.push(i);
      return {
        text: 'ok',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, custoUsd: 0.0123, custoEstimado: true, modeloServido: escolher(i).modelo },
        raw: null,
      };
    },
  };
}

describe('o envelope do teto com a função', () => {
  it('reserva com o modelo da FUNÇÃO e soma no livro por função (step e complete)', async () => {
    const { teto, reservas } = tetoFalso();
    const gasto = gastoFalso();
    const envelope = new ProviderComTeto(interno(), teto as never, undefined, gasto as never);
    await envelope.step({ system: 's', turns: [{ role: 'user', text: 'u' }], orgId: ORG, funcao: 'CO-11' });
    await envelope.complete({ system: 's', user: 'u', orgId: ORG, funcao: 'CO-04' });
    expect(reservas.map((r) => r.modelo)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(gasto.lancamentos[0]).toMatchObject({ orgId: ORG, funcao: 'CO-11', agentSlug: funcaoPorId('CO-11')!.slug, modelo: 'claude-haiku-5-5', gastoUsd: 0.0123 });
    expect(gasto.lancamentos[1]).toMatchObject({ orgId: ORG, funcao: 'CO-04', agentSlug: funcaoPorId('CO-04')!.slug, modelo: 'claude-sonnet-5-5' });
    expect(Number(gasto.lancamentos[1].estimadoUsd)).toBeGreaterThan(0);
    expect(envelope.buscaNaWeb).toBe(true);
  });

  it('o orçamento por agente passa a ver a função; slug da função sem Agent legível não recusa', async () => {
    const { teto } = tetoFalso();
    const conferidos: string[] = [];
    const orcamento = {
      conferir: vi.fn(async (p: { agentSlug: string }) => {
        conferidos.push(p.agentSlug);
        throw new OrcamentoIlegivelError(ORG, p.agentSlug, null);
      }),
    };
    const envelope = new ProviderComTeto(interno(), teto as never, orcamento as never, gastoFalso() as never);
    // Slug deduzido da função: a leitura ilegível vira aviso e a chamada segue.
    await expect(envelope.complete({ system: 's', user: 'u', orgId: ORG, funcao: 'TR-07' })).resolves.toBe('resposta curta');
    expect(conferidos).toEqual([funcaoPorId('TR-07')!.slug]);
    // Slug explícito: a regra de sempre (falha fechada).
    await expect(
      envelope.step({ system: 's', turns: [{ role: 'user', text: 'u' }], orgId: ORG, agentSlug: 'assistente' }),
    ).rejects.toBeInstanceOf(OrcamentoIlegivelError);
  });

  it('a recusa do orçamento continua barrando antes de reservar', async () => {
    const { teto, chamadas } = tetoFalso();
    const orcamento = { conferir: vi.fn(async () => { throw new Error('orçamento do mês atingido'); }) };
    const envelope = new ProviderComTeto(interno(), teto as never, orcamento as never);
    await expect(envelope.complete({ system: 's', user: 'u', orgId: ORG, funcao: 'CO-11' })).rejects.toThrow('orçamento');
    expect(chamadas).toEqual([]);
  });

  it('o livro normaliza função e slug (um deduz o outro; função torta vira vazia)', () => {
    expect(quemGastou({ funcao: 'co-11' })).toEqual({ funcao: 'CO-11', agentSlug: funcaoPorId('CO-11')!.slug });
    expect(quemGastou({ agentSlug: 'assistente' })).toEqual({ funcao: 'CE-01', agentSlug: 'assistente' });
    expect(quemGastou({ funcao: 'lixo', agentSlug: 'slug-livre' })).toEqual({ funcao: '', agentSlug: 'slug-livre' });
  });
});

describe('o medidor do gasto externo', () => {
  it('vetorização: reserva antes, chama, liquida pelos tokens contados e soma no livro', async () => {
    const { teto, chamadas, reservas } = tetoFalso();
    const gasto = gastoFalso();
    const m = new MedidorDeGastoExterno(teto as never, gasto as never);
    const r = await m.vetorizacao({ orgId: ORG, funcao: 'CE-05', modelo: 'text-embedding-3-small', textos: ['a', 'b'] }, async () => {
      chamadas.push('fornecedor');
      return { resultado: [[1], [2]], tokens: 1_000_000 };
    });
    expect(r).toEqual([[1], [2]]);
    expect(chamadas).toEqual(['reservar', 'fornecedor', 'liquidar']);
    expect(reservas[0]).toMatchObject({ orgId: ORG, modelo: 'text-embedding-3-small', tokensSaida: 0 });
    expect(teto.liquidar).toHaveBeenCalledWith(expect.anything(), { custoUsd: 0.02, custoEstimado: true });
    expect(gasto.lancamentos[0]).toMatchObject({ funcao: 'CE-05', tipo: 'vetorizacao', gastoUsd: 0.02 });
  });

  it('vetorização recusada pelo teto NÃO chama o fornecedor', async () => {
    const { teto, chamadas } = tetoFalso({ recusar: true });
    const m = new MedidorDeGastoExterno(teto as never, gastoFalso() as never);
    const fornecedor = vi.fn();
    await expect(m.vetorizacao({ orgId: ORG, funcao: 'CE-05', modelo: 'text-embedding-3-small', textos: ['a'] }, fornecedor)).rejects.toBeInstanceOf(
      TetoDiarioEstouradoError,
    );
    expect(fornecedor).not.toHaveBeenCalled();
    expect(chamadas).toEqual(['reservar']);
  });

  it('falha do fornecedor solta a reserva e não soma no livro', async () => {
    const { teto, chamadas } = tetoFalso();
    const gasto = gastoFalso();
    const m = new MedidorDeGastoExterno(teto as never, gasto as never);
    await expect(
      m.vetorizacao({ orgId: ORG, funcao: 'CE-05', modelo: 'text-embedding-3-small', textos: ['a'] }, async () => {
        throw new Error('HTTP 503');
      }),
    ).rejects.toThrow('503');
    expect(chamadas).toEqual(['reservar', 'soltar']);
    expect(gasto.lancamentos).toEqual([]);
  });

  it('sem tokens contados, liquida pela estimativa do tamanho', async () => {
    const { teto } = tetoFalso();
    const m = new MedidorDeGastoExterno(teto as never);
    await m.vetorizacao({ orgId: ORG, funcao: 'CE-05', modelo: 'text-embedding-3-small', textos: ['abc'] }, async () => ({ resultado: 1, tokens: null }));
    expect(teto.liquidarPeloObservado).toHaveBeenCalled();
    expect(tokensDaRespostaDeEmbedding({ usage: { prompt_tokens: 12 } })).toBe(12);
    expect(tokensDaRespostaDeEmbedding({ data: [] })).toBeNull();
  });

  it('transcrição: reserva o valor do minuto antes e liquida pelo medido', async () => {
    const { teto, chamadas, reservas } = tetoFalso();
    const gasto = gastoFalso();
    const m = new MedidorDeGastoExterno(teto as never, gasto as never);
    await m.transcricao({ orgId: ORG, funcao: 'IM-06', modelo: 'gpt-4o-transcribe', usdEstimado: 0.006 }, async () => {
      chamadas.push('fornecedor');
      return { resultado: 'texto', custoUsd: 0.004, medido: true };
    });
    expect(chamadas).toEqual(['reservarValor', 'fornecedor', 'liquidar']);
    expect(reservas[0]).toMatchObject({ usd: 0.006 });
    expect(gasto.lancamentos[0]).toMatchObject({ funcao: 'IM-06', tipo: 'transcricao', gastoUsd: 0.004 });
  });
});

describe('a transcrição e a vetorização dos serviços passam pelo medidor', () => {
  const salvas = { chave: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-teste-nao-e-chave';
    delete process.env.OPENAI_BASE_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (salvas.chave === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = salvas.chave;
    if (salvas.base !== undefined) process.env.OPENAI_BASE_URL = salvas.base;
  });

  it('a transcrição recusada pelo teto não chama a OpenAI e o cliente lê a mensagem de sempre', async () => {
    const { teto } = tetoFalso({ recusar: true });
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const t = new TranscricaoService(teto as never, new MedidorDeGastoExterno(teto as never));
    await expect(t.transcrever({ orgId: ORG, audio: Buffer.alloc(8000), mimetype: 'audio/webm' })).rejects.toBeInstanceOf(
      TranscricaoIndisponivelError,
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('a transcrição liquida pelo uso em tokens que a OpenAI devolve, em nome do IM-06', async () => {
    const { teto, chamadas } = tetoFalso();
    const gasto = gastoFalso();
    vi.stubGlobal('fetch', async () => {
      chamadas.push('openai');
      return new Response(JSON.stringify({ text: 'oi', usage: { type: 'tokens', input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
    });
    const t = new TranscricaoService(teto as never, new MedidorDeGastoExterno(teto as never, gasto as never));
    const r = await t.transcrever({ orgId: ORG, audio: Buffer.alloc(8000), mimetype: 'audio/webm' });
    expect(r.texto).toBe('oi');
    expect(chamadas).toEqual(['reservarValor', 'openai', 'liquidar']);
    expect(r.custoUsd).toBeCloseTo((1000 * 2.5 + 100 * 10) / 1e6, 6);
    expect(gasto.lancamentos[0]).toMatchObject({ funcao: FUNCAO_DA_TRANSCRICAO, tipo: 'transcricao' });
    expect(custoDoUso('whisper-1', { type: 'duration', seconds: 60 })).toBe(0.006);
    expect(custoDoUso('gpt-4o-transcribe', null)).toBeNull();
    // O OpenRouter devolve o valor cobrado, sem `type`: ele ganha da tabela.
    expect(custoDoUso('gpt-4o-transcribe', { input_tokens: 10, output_tokens: 6, cost: 0.000085 })).toBe(0.000085);
  });

  it('o embedding da vault e o do acervo reservam no teto em nome da função, com a empresa da chamada', async () => {
    const { teto, chamadas, reservas } = tetoFalso();
    vi.stubGlobal('fetch', async (_u: unknown, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)) as { input: string[] };
      chamadas.push('openai');
      return new Response(JSON.stringify({ data: corpo.input.map(() => ({ embedding: [0.1, 0.2] })), usage: { prompt_tokens: 7 } }), { status: 200 });
    });
    const gasto = gastoFalso();
    const medidor = new MedidorDeGastoExterno(teto as never, gasto as never);
    const vault = new ObsidianService({} as never, {} as never, {} as never, {} as never, undefined, undefined, medidor);
    const acervo = new PautaService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, medidor);
    expect(await vault['embed'](['nota'], 1000, ORG)).toEqual([[0.1, 0.2]]);
    expect(await acervo['embed'](['ficha'], 1000, ORG)).toEqual([[0.1, 0.2]]);
    expect(chamadas).toEqual(['reservar', 'openai', 'liquidar', 'reservar', 'openai', 'liquidar']);
    expect(reservas.map((r) => r.orgId)).toEqual([ORG, ORG]);
    expect(gasto.lancamentos.map((l) => l.funcao)).toEqual(['CE-05', 'CT-02']);
  });

  it('o teto que recusa o embedding vira FalhaDeEmbedding (a busca cai para texto)', async () => {
    const { teto } = tetoFalso({ recusar: true });
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const vault = new ObsidianService({} as never, {} as never, {} as never, {} as never, undefined, undefined, new MedidorDeGastoExterno(teto as never));
    await expect(vault['embed'](['nota'], 1000, ORG)).rejects.toMatchObject({ name: 'FalhaDeEmbedding' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
