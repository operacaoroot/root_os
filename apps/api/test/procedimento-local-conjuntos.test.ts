import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('separação da prova de inferência nativa', () => {
  it('mantém o procedimento comum no padrão e exclui somente a prova com servidor real', async () => {
    vi.stubEnv('MKTOS_CONJUNTO_DE_TESTES', 'padrao'); vi.resetModules();
    const { default: config } = await import('../vitest.config');
    expect(config.test?.include).toContain('test/**/*.test.ts');
    expect(config.test?.exclude).toContain('test/procedimento-local-nativo.test.ts');
    expect(config.test?.exclude).not.toContain('test/procedimento-local.test.ts');
    expect(config.test?.exclude).not.toContain('test/m05-procedimento-recuperacao.test.ts');
  });
  it('o conjunto nativo coleta exclusivamente a prova com modelo real', async () => {
    vi.stubEnv('MKTOS_CONJUNTO_DE_TESTES', 'nativo'); vi.resetModules();
    const { default: config } = await import('../vitest.config');
    expect(config.test?.include).toEqual(['test/procedimento-local-nativo.test.ts']);
  });
});
