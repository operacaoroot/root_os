import { defineConfig } from 'vitest/config';

// A suíte da API mora em test/, FORA do tsconfig.json de build — o Dockerfile
// confere `dist/main.js`, e um .ts fora de src/ desloca a saída para dist/src/.
// `pnpm typecheck:test` cobre os tipos dos testes sem tocar no build.
//
// tenant-isolation.test.ts fica de fora do `pnpm test` de propósito: é teste de
// integração, escreve em banco e exige TEST_DATABASE_URL com duas empresas
// semeadas. Roda por `pnpm test:isolamento`, e hoje sai VERMELHA — é a linha de
// base do isolamento por linha, que ainda não está ligado.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/tenant-isolation.test.ts'],
    environment: 'node',
    globals: true,
  },
});
