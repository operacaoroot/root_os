import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { funcaoPorId } from '@mktos/shared';

import { AnthropicProvider } from '../src/llm/anthropic.provider';
import { PonteProvider } from '../src/llm/ponte.provider';
import { OpenRouterProvider } from '../src/llm/openrouter.provider';
import { StubProvider } from '../src/llm/stub.provider';
import {
  aceitaFallbackDeServidor,
  ambienteDosModelos,
  modeloDaChamada,
  slugDaChamada,
  tipoDaBuscaNaWeb,
} from '../src/llm/modelo-da-chamada';
import { MODELOS_DA_PONTE, argumentosDoCli, modeloDoPedido } from '../../../homolog/ponte-modelo/modelos.mjs';

/*
 * O MODELO POR FUNÇÃO NO PROVEDOR (rodada dos agentes, 21/10/2026, A1).
 *
 * O provedor `anthropic` escolhe o modelo e o esforço pela FUNÇÃO do cadastro
 * único (`escolherModelo` do shared), com o explícito por cima e as variáveis
 * por função no meio; manda o esforço SEMPRE; só manda fallback de servidor para
 * o modelo que o aceita (o Haiku 5.5 não tem); nunca manda temperature, top_p
 * nem budget_tokens; e a busca na web do servidor só vai quando a chamada pede.
 * Dublê do SDK: nenhum caso sai para a rede.
 */

const VARIAVEIS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_EFFORT',
  'LLM_MODELO_CO_11',
  'LLM_ESFORCO_CO_11',
  'LLM_MODELOS_POR_FUNCAO',
  'LLM_ESFORCOS_POR_FUNCAO',
  'PONTE_MODELO',
  'PONTE_MODELO_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
] as const;
const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};

beforeEach(() => {
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
  process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-nao-e-chave';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
});

interface Pedido {
  model: string;
  output_config?: { effort?: string };
  thinking?: { type: string };
  betas?: string[];
  fallbacks?: unknown;
  tools?: Array<{ type?: string; name: string; max_uses?: number }>;
  [k: string]: unknown;
}

/** O provedor com o SDK trocado por um dublê que guarda o pedido. */
function provedor(resposta?: Partial<{ model: string; usage: Record<string, unknown> }>) {
  const p = new AnthropicProvider();
  const pedidos: Pedido[] = [];
  const create = vi.fn(async (pedido: Pedido) => {
    pedidos.push(pedido);
    return {
      model: resposta?.model ?? pedido.model,
      stop_reason: 'end_turn',
      stop_details: null,
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1000, output_tokens: 100, ...(resposta?.usage ?? {}) },
    };
  });
  (p as unknown as { client: unknown }).client = { beta: { messages: { create } } };
  return { p, pedidos };
}

describe('a regra pura: explícito > variável > cadastro > padrão', () => {
  const PADRAO = { modelo: 'claude-opus-5-5', esforco: 'high' as const };

  it('sem função, o padrão do provedor', () => {
    expect(modeloDaChamada({}, PADRAO, {})).toEqual({ ...PADRAO, origem: 'padrao' });
  });
  it('com função, o cadastro', () => {
    const f = funcaoPorId('CO-11')!;
    expect(modeloDaChamada({ funcao: 'CO-11' }, PADRAO, {})).toEqual({ modelo: f.modelo, esforco: f.esforco, origem: 'cadastro' });
  });
  it('a variável por função vence o cadastro, e a lista do compose também', () => {
    expect(modeloDaChamada({ funcao: 'CO-11' }, PADRAO, { LLM_MODELO_CO_11: 'claude-sonnet-5-5' }).modelo).toBe('claude-sonnet-5-5');
    const lista = { LLM_MODELOS_POR_FUNCAO: 'CO-11=claude-opus-5-5, CO-03=claude-sonnet-5-5', LLM_ESFORCOS_POR_FUNCAO: 'CO-11=high' };
    expect(modeloDaChamada({ funcao: 'CO-11' }, PADRAO, lista)).toMatchObject({ modelo: 'claude-opus-5-5', esforco: 'high', origem: 'variavel' });
    expect(modeloDaChamada({ funcao: 'CO-03' }, PADRAO, lista).modelo).toBe('claude-sonnet-5-5');
    // A variável específica vence a lista.
    expect(
      modeloDaChamada({ funcao: 'CO-11' }, PADRAO, { ...lista, LLM_MODELO_CO_11: 'claude-haiku-5-5' }).modelo,
    ).toBe('claude-haiku-5-5');
    expect(ambienteDosModelos({ LLM_MODELOS_POR_FUNCAO: 'lixo,XX=1,CO-11=' })).toEqual({ LLM_MODELOS_POR_FUNCAO: 'lixo,XX=1,CO-11=' });
  });
  it('o explícito vence tudo, e cada metade cai sozinha', () => {
    expect(modeloDaChamada({ funcao: 'CO-11', model: 'claude-opus-5-5', effort: 'max' }, PADRAO, {})).toEqual({
      modelo: 'claude-opus-5-5',
      esforco: 'max',
      origem: 'explicito',
    });
    expect(modeloDaChamada({ funcao: 'CO-11', model: 'claude-opus-5-5' }, PADRAO, {}).esforco).toBe(funcaoPorId('CO-11')!.esforco);
  });
  it('o slug do gasto: o agentSlug, senão o da função', () => {
    expect(slugDaChamada({ funcao: 'CO-11' })).toBe(funcaoPorId('CO-11')!.slug);
    expect(slugDaChamada({ funcao: 'CO-11', agentSlug: 'outro' })).toBe('outro');
    expect(slugDaChamada({ funcao: 'XX-99' })).toBe('');
  });
  it('fallback de servidor só onde existe; o Haiku 5.5 não tem', () => {
    expect(aceitaFallbackDeServidor('claude-opus-5-5')).toBe(true);
    expect(aceitaFallbackDeServidor('claude-sonnet-5-5')).toBe(true);
    expect(aceitaFallbackDeServidor('claude-opus-5')).toBe(true);
    expect(aceitaFallbackDeServidor('claude-haiku-5-5')).toBe(false);
    expect(aceitaFallbackDeServidor('claude-haiku-4-5')).toBe(false);
    expect(aceitaFallbackDeServidor('modelo-qualquer')).toBe(false);
  });
});

describe('o provedor anthropic, com dublê do SDK', () => {
  it('sem ANTHROPIC_MODEL o padrão é claude-opus-5-5, e o esforço vai explícito', async () => {
    const { p, pedidos } = provedor();
    expect(p.model).toBe('claude-opus-5-5');
    await p.complete({ system: 's', user: 'u' });
    expect(pedidos[0].model).toBe('claude-opus-5-5');
    expect(pedidos[0].output_config?.effort).toBe('high');
    expect(pedidos[0].thinking).toEqual({ type: 'adaptive' });
  });

  it('função em Haiku: modelo e esforço do cadastro, e SEM fallback de servidor', async () => {
    const { p, pedidos } = provedor();
    await p.complete({ system: 's', user: 'u', funcao: 'CO-11' });
    expect(pedidos[0].model).toBe('claude-haiku-5-5');
    expect(pedidos[0].output_config?.effort).toBe('low');
    expect(pedidos[0]).not.toHaveProperty('fallbacks');
    expect(pedidos[0]).not.toHaveProperty('betas');
  });

  it('função em Sonnet: só a forma "default" do fallback, com o beta de 2026-07-01', async () => {
    const { p, pedidos } = provedor();
    await p.complete({ system: 's', user: 'u', funcao: 'CO-04' });
    expect(pedidos[0].model).toBe('claude-sonnet-5-5');
    expect(pedidos[0].fallbacks).toBe('default');
    expect(pedidos[0].betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('função em Opus: high do cadastro, com fallback', async () => {
    const { p, pedidos } = provedor();
    await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'CO-03' });
    expect(pedidos[0].model).toBe('claude-opus-5-5');
    expect(pedidos[0].output_config?.effort).toBe('high');
    expect(pedidos[0].fallbacks).toBe('default');
  });

  it('modelo e esforço explícitos (o laço do agente) valem por cima do cadastro', async () => {
    const { p, pedidos } = provedor();
    await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'CO-11', model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(pedidos[0].model).toBe('claude-sonnet-5-5');
    expect(pedidos[0].output_config?.effort).toBe('medium');
  });

  it('LLM_MODELO_<ID> sobrescreve a função no provedor', async () => {
    process.env.LLM_MODELO_CO_11 = 'claude-sonnet-5-5';
    process.env.LLM_ESFORCO_CO_11 = 'high';
    const { p, pedidos } = provedor();
    await p.complete({ system: 's', user: 'u', funcao: 'CO-11' });
    expect(pedidos[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'high' }, fallbacks: 'default' });
  });

  it('nunca manda temperature, top_p, top_k nem budget_tokens, nem thinking disabled', async () => {
    const { p, pedidos } = provedor();
    for (const funcao of ['CO-03', 'CO-04', 'CO-11', undefined]) {
      await p.complete({ system: 's', user: 'u', funcao });
      await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao });
    }
    for (const pedido of pedidos) {
      expect(Object.keys(pedido)).not.toEqual(expect.arrayContaining(['temperature']));
      for (const proibido of ['temperature', 'top_p', 'top_k']) expect(pedido).not.toHaveProperty(proibido);
      expect(JSON.stringify(pedido)).not.toMatch(/budget_tokens|"disabled"/);
      expect(pedido.thinking).toEqual({ type: 'adaptive' });
      expect(pedido.output_config?.effort).toBeTruthy();
    }
  });

  it('a busca na web do servidor só vai quando a chamada pede, com max_uses, na variante do modelo', async () => {
    const { p, pedidos } = provedor({ usage: { server_tool_use: { web_search_requests: 3 } } });
    expect(p.buscaNaWeb).toBe(true);
    await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'IM-02' });
    expect(pedidos[0].tools).toBeUndefined();
    const saida = await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'IM-02', servidor: { buscaNaWeb: { maxUsos: 4 } } });
    expect(pedidos[1].tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }]);
    // 1000 de entrada e 100 de saída no Opus 5.5 = 0,006; mais 3 buscas a US$ 0,01.
    expect(saida.usage.custoUsd).toBeCloseTo(0.006 + 0.03, 6);
    expect(tipoDaBuscaNaWeb('claude-haiku-5-5')).toBe('web_search_20250305');
  });

  it('o custo é o do modelo SERVIDO (o fallback pode trocar o modelo)', async () => {
    const { p } = provedor({ model: 'claude-opus-5' });
    const saida = await p.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'CO-03' });
    expect(saida.usage.modeloServido).toBe('claude-opus-5');
    expect(saida.usage.custoUsd).toBeCloseTo((1000 * 5 + 100 * 25) / 1e6, 6);
  });
});

describe('a ponte respeita o modelo pedido', () => {
  it('o provider manda `model` escolhido pela função', async () => {
    const corpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      corpos.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ texto: 'oi', modelo: corpos.at(-1)!.model }), { status: 200 });
    });
    const ponte = new PonteProvider(new StubProvider('/nao-existe'));
    expect(ponte.model).toBe('claude-opus-5-5');
    await ponte.complete({ system: 's', user: 'u', funcao: 'CO-11' });
    await ponte.complete({ system: 's', user: 'u' });
    await ponte.step({ system: 's', turns: [{ role: 'user', text: 'u' }], funcao: 'CO-04' });
    expect(corpos.map((c) => c.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  });

  it('a ponte aceita só os três modelos 5.5 e passa --model ao CLI', () => {
    expect(MODELOS_DA_PONTE).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(modeloDoPedido({}, 'claude-opus-5-5')).toEqual({ modelo: 'claude-opus-5-5' });
    expect(modeloDoPedido({ model: 'claude-haiku-5-5' }, 'claude-opus-5-5')).toEqual({ modelo: 'claude-haiku-5-5' });
    expect(modeloDoPedido({ model: 'claude-fable-5-1' }, 'claude-opus-5-5')).toHaveProperty('erro');
    expect(modeloDoPedido({ model: 42 }, 'claude-opus-5-5')).toHaveProperty('erro');
    const args = argumentosDoCli('claude-sonnet-5-5', ['Bash']);
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'claude-sonnet-5-5']);
    expect(args).toContain('--strict-mcp-config');
    expect(() => argumentosDoCli('claude-fable-5-1', [])).toThrow();
  });
});

describe('o OpenRouter usa o modelo da função só onde há preço conferido', () => {
  it('os 5.5 do cadastro viram o nome do OpenRouter; sem função fica o OPENROUTER_MODEL', () => {
    const r = new OpenRouterProvider();
    expect(r.modeloDaChamada({ funcao: 'CO-04' }).modelo).toBe('anthropic/claude-sonnet-5.5');
    // Desde 29/10/2026 o Haiku e o Opus 5.5 têm preço no OpenRouter: a função não cai mais no Sonnet.
    expect(r.modeloDaChamada({ funcao: 'CO-11' }).modelo).toBe('anthropic/claude-haiku-5.5');
    expect(r.modeloDaChamada({ funcao: 'CO-03' }).modelo).toBe('anthropic/claude-opus-5.5');
    expect(r.modeloDaChamada({}).modelo).toBe(r.model);
    expect(r.modeloDaChamada({ funcao: 'CO-04', model: 'x/y' }).modelo).toBe('x/y');
  });
});
