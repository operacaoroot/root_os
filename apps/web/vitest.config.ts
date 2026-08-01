import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Cobre os testes que vieram do root-central junto com o código da Central.
// O painel não tem suíte própria; quando tiver, entra no mesmo include.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    globals: true,
  },
});
