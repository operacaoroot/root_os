import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { custoUsd, precoDe, PRECO_USD_MTOK } from '../src/llm/preco';
import { OpenAiProvider } from '../src/llm/openai.provider';
import type { LlmTurn } from '../src/llm/llm.provider';

describe('preço', () => {
  it('mede o modelo OpenRouter usado em produção quando o provedor não informa custo', () => {
    expect(custoUsd('anthropic/claude-sonnet-4.5', {
      entrada: 1000, saida: 200, cacheLeitura: 500, cacheEscrita: 100,
    })).toEqual({ custoUsd: 0.006525, custoEstimado: true });
  });

  it('precifica o identificador exato Sonnet 5.5, inclusive cache, pela rota Standard do OpenRouter', () => {
    expect(precoDe('anthropic/claude-sonnet-5.5')).toEqual({
      entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5,
    });
    expect(custoUsd('anthropic/claude-sonnet-5.5', {
      entrada: 1000, saida: 200, cacheLeitura: 500, cacheEscrita: 100,
    })).toEqual({ custoUsd: 0.00435, custoEstimado: true });
    expect(precoDe('anthropic/claude-sonnet-5.55')).toBeNull();
  });

  it('casa o modelo com data no nome com a entrada da tabela', () => {
    expect(precoDe('claude-opus-5')).toBe(PRECO_USD_MTOK['claude-opus-5']);
    expect(precoDe('claude-opus-5-20260101')).toBe(PRECO_USD_MTOK['claude-opus-5']);
    expect(precoDe('gpt-4o-2024-08-06')).toBe(PRECO_USD_MTOK['gpt-4o']);
    expect(precoDe('claude-haiku-4-5-20251001')).toBe(PRECO_USD_MTOK['claude-haiku-4-5']);
    expect(precoDe('claude-opus-5-preview')).toBeNull();
  });

  it('modelo fora da tabela devolve custo 0 MARCADO como não medido', () => {
    const r = custoUsd('modelo-que-nao-existe', { entrada: 1_000_000, saida: 1_000_000 });
    expect(r.custoUsd).toBe(0);
    // é isto que impede a tela de mostrar "R$ 0,00" para um custo desconhecido
    expect(r.custoEstimado).toBe(false);
  });

  it('conta cache de leitura e de escrita separado', () => {
    const semCache = custoUsd('claude-opus-5', { entrada: 1_000_000, saida: 0 });
    const comCache = custoUsd('claude-opus-5', {
      entrada: 0,
      saida: 0,
      cacheLeitura: 1_000_000,
    });
    expect(semCache.custoUsd).toBe(5);
    expect(comCache.custoUsd).toBe(0.5); // leitura de cache é 10x mais barata
  });

  it('não arredonda uma pergunta barata para zero', () => {
    // ~1200 tokens de entrada e 300 de saída: custa menos de um centavo de dólar
    const r = custoUsd('claude-opus-5', { entrada: 1200, saida: 300 });
    expect(r.custoUsd).toBeGreaterThan(0);
    expect(r.custoEstimado).toBe(true);
  });
});

describe('OpenAiProvider.step', () => {
  const original = { ...process.env };
  let corpoEnviado: Record<string, unknown>;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    corpoEnviado = {};
  });
  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  const respondeCom = (json: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      corpoEnviado = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

  it('devolve o pedido de ferramenta e NÃO executa nada', async () => {
    respondeCom({
      model: 'gpt-4o',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                function: { name: 'get_dashboard_summary', arguments: '{"periodo":"hoje"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1200, completion_tokens: 40 },
    });

    const p = new OpenAiProvider();
    const out = await p.step({
      system: 's',
      turns: [{ role: 'user', text: 'quanto entrou hoje?' }],
      tools: [{ name: 'get_dashboard_summary', description: 'd', inputSchema: { type: 'object' } }],
    });

    expect(out.stopReason).toBe('tool_use');
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: 'get_dashboard_summary',
      args: { periodo: 'hoje' },
    });
    expect(out.text).toBe('');
    expect(out.usage.custoEstimado).toBe(true);
    expect(out.usage.custoUsd).toBeGreaterThan(0);
  });

  it('argumento malformado não derruba o passo — vira objeto vazio', async () => {
    respondeCom({
      model: 'gpt-4o',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{quebrado' } }] },
        },
      ],
    });
    const out = await new OpenAiProvider().step({ system: 's', turns: [] });
    // quem recusa é a validação por schema na porta, não um crash aqui
    expect(out.toolCalls[0].args).toEqual({});
  });

  it('converte o histórico: assistant com tool_calls e um tool por resultado', async () => {
    respondeCom({ model: 'gpt-4o', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });

    const turns: LlmTurn[] = [
      { role: 'user', text: 'pergunta' },
      { role: 'assistant', toolCalls: [{ id: 'a', name: 'f1', args: { x: 1 } }] },
      {
        role: 'tool',
        results: [
          { id: 'a', content: '{"ok":true}' },
          { id: 'b', content: 'falhou', isError: true },
        ],
      },
    ];
    await new OpenAiProvider().step({ system: 'sys', turns });

    const msgs = corpoEnviado.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'pergunta' });
    expect(msgs[2].role).toBe('assistant');
    expect((msgs[2].tool_calls as unknown[])[0]).toMatchObject({ id: 'a', type: 'function' });
    // o OpenAI quer UMA mensagem por resultado — o Anthropic quer um turno só
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: '{"ok":true}' });
    expect(msgs[4]).toEqual({ role: 'tool', tool_call_id: 'b', content: 'falhou' });
  });

  it('sem ferramenta declarada, não manda tools nem tool_choice', async () => {
    respondeCom({ model: 'gpt-4o', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    await new OpenAiProvider().step({ system: 's', turns: [{ role: 'user', text: 'oi' }] });
    expect(corpoEnviado.tools).toBeUndefined();
    expect(corpoEnviado.tool_choice).toBeUndefined();
  });

  it('sem credencial, falha com mensagem que diz onde configurar', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(new OpenAiProvider().step({ system: 's', turns: [] })).rejects.toThrow(
      /OPENAI_API_KEY ausente/,
    );
  });

  it('filtro de conteúdo vira stopReason refusal, não exceção', async () => {
    respondeCom({
      model: 'gpt-4o',
      choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
    });
    const out = await new OpenAiProvider().step({ system: 's', turns: [] });
    // numa sessão a recusa é um passo do traço, não um 500
    expect(out.stopReason).toBe('refusal');
  });
});
