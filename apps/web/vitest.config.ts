import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Cobre os testes que vieram do root-central junto com o código da Central,
// mais a suíte da tela da Régua (fatia 2.3).
//
// `@mktos/policy` APONTA PARA O CÓDIGO-FONTE, e isso não é conveniência.
// O `package.json` do pacote resolve para `dist/`, que é artefato de build
// ignorado pelo git. Sem este atalho, o teste do simulador dependia do último
// `pnpm build` de alguém: num checkout limpo ele não resolvia nada, e com um
// `dist/` velho ele era pior do que falhar — validava o MOTOR ANTIGO contra um
// documento lido pelo esquema NOVO, e passava verde dizendo que a régua do
// repositório estava certa. Mesma razão pela qual `apps/api/test/
// modulos-por-tenant.test.ts` lê `packages/shared/src/nav.ts` pelo caminho.
//
// Os dois JSON entram por nome próprio porque `exports` do pacote os publica
// assim, e é assim que `policy.service.ts` os importa — o teste tem de carregar
// exatamente os mesmos bytes.
// `@mktos/shared` entra pelo mesmo motivo: `nav.test.ts` afirma coisas sobre o
// menu (quem vê a Régua, para onde foi cada tela antiga) e lia o `dist/`. Um
// `dist/` velho faria a suíte julgar o menu da semana passada.
//
// A ordem das chaves importa: o alias casa por igualdade ou por prefixo
// seguido de `/`, e o mais específico tem de vir primeiro — senão
// `@mktos/policy/politica-root.json` viraria `.../src/index.ts/politica-root.json`.
// (`'@'` não colide: ele só casa com `@/...`.)
const policy = path.resolve(__dirname, '../../packages/policy');
const shared = path.resolve(__dirname, '../../packages/shared');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@mktos/policy/politica-root.json': path.join(policy, 'politica-root.json'),
      '@mktos/policy/politica-marketing-os.json': path.join(policy, 'politica-marketing-os.json'),
      '@mktos/policy': path.join(policy, 'src/index.ts'),
      '@mktos/shared': path.join(shared, 'src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    globals: true,
  },
});
