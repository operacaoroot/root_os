import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, envOpcional, envNumero } from '../src/llm/env';
import { OpenRouterProvider } from '../src/llm/openrouter.provider';

/*
 * A regressão que quebrou o motor em produção com a credencial CERTA no lugar.
 *
 * `process.env.X ?? padrao` só cai no default para null/undefined, e o
 * docker-compose entrega STRING VAZIA para toda variável declarada `${X:-}` e
 * não preenchida. O baseUrl virou '' e a chamada morreu com
 * "Failed to parse URL from /chat/completions".
 */
describe('env com default de verdade', () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.TESTE_X;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('string vazia vale como ausente — é o caso do compose', () => {
    process.env.TESTE_X = '';
    expect(env('TESTE_X', 'padrao')).toBe('padrao');
  });

  it('só espaço também vale como ausente', () => {
    process.env.TESTE_X = '   ';
    expect(env('TESTE_X', 'padrao')).toBe('padrao');
  });

  it('valor de verdade passa, sem espaço nas pontas', () => {
    process.env.TESTE_X = '  https://exemplo.com  ';
    expect(env('TESTE_X', 'padrao')).toBe('https://exemplo.com');
  });

  it('envOpcional devolve vazio, e é isso que faz `configured` ser falso', () => {
    process.env.TESTE_X = '';
    expect(envOpcional('TESTE_X')).toBe('');
  });

  it('número inválido cai no default em vez de virar NaN', () => {
    process.env.TESTE_X = 'nao-e-numero';
    expect(envNumero('TESTE_X', 16000)).toBe(16000);
    process.env.TESTE_X = '';
    expect(envNumero('TESTE_X', 16000)).toBe(16000);
  });
});

describe('OpenRouterProvider com o ambiente que a produção entrega', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('BASE_URL vazio no compose NÃO deixa a URL vazia', () => {
    // exatamente o que ${OPENROUTER_BASE_URL:-} produz quando ninguém preenche
    process.env.OPENROUTER_BASE_URL = '';
    process.env.OPENROUTER_MODEL = '';
    process.env.OPENROUTER_API_KEY = 'sk-or-teste';
    const p = new OpenRouterProvider();
    expect(p.configured).toBe(true);
    expect(p.model).toBe('anthropic/claude-sonnet-4.5');
    // se isto voltar a ser '', a chamada morre com "Failed to parse URL"
    expect(p['baseUrl']).toBe('https://openrouter.ai/api/v1');
    expect(p.name).toBe('openrouter');
  });

  it('sem chave, `configured` é falso e a falha vem clara no uso', async () => {
    process.env.OPENROUTER_API_KEY = '';
    const p = new OpenRouterProvider();
    expect(p.configured).toBe(false);
    await expect(p.step({ system: 's', turns: [] })).rejects.toThrow(/OPENROUTER_API_KEY ausente/);
  });
});
