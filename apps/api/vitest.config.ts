import { defineConfig } from 'vitest/config';

// A suíte da API mora em test/, FORA do tsconfig.json de build — o Dockerfile
// confere `dist/main.js`, e um .ts fora de src/ desloca a saída para dist/src/.
// `pnpm typecheck:test` cobre os tipos dos testes sem tocar no build.
//
// tenant-isolation.test.ts fica de fora do `pnpm test` de propósito: ele LANÇA
// no import quando falta TEST_DATABASE_URL, então não dá para pular sozinho.
// Roda por `pnpm test:isolamento` e hoje sai VERMELHA — é a linha de base do
// isolamento por linha, que ainda não está ligado.
//
// porta.test.ts fica no include: ele se pula sozinho sem TEST_DATABASE_URL, e
// deixá-lo dentro é o que garante que alguém com banco de teste o veja rodar.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/tenant-isolation.test.ts'],
    environment: 'node',
    globals: true,
  },
});
