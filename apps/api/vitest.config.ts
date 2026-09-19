import { defineConfig } from 'vitest/config';

// A suíte da API mora em test/, FORA do tsconfig.json de build — o Dockerfile
// confere `dist/main.js`, e um .ts fora de src/ desloca a saída para dist/src/.
// `pnpm typecheck:test` cobre os tipos dos testes sem tocar no build.
//
// tenant-isolation.test.ts fica de fora do conjunto padrão de propósito: ele
// LANÇA no import quando falta TEST_DATABASE_URL, então não dá para pular
// sozinho. Roda por `pnpm test:isolamento`.
//
// ELA NÃO É MAIS LINHA DE BASE DE DÍVIDA (mudou na fatia 1.5, 11/09/2026): a
// migration `20260911050000_isolamento_por_linha` ligou o isolamento no banco e
// a suíte passa inteira. VERMELHO ALI AGORA SIGNIFICA VAZAMENTO ENTRE EMPRESAS.
// Só que ela precisa de DUAS conexões para medir alguma coisa — a dona, que
// semeia, e o papel restrito (`TENANT_DATABASE_URL`), que lê. Sem a segunda ela
// lê como dona, que atravessa policy, e avisa alto que o verde não vale nada.
//
// porta.test.ts fica no conjunto padrão: ele se pula sozinho sem
// TEST_DATABASE_URL, e deixá-lo dentro é o que garante que alguém com banco de
// teste o veja rodar.
//
// POR QUE UM INTERRUPTOR E NÃO UM FILTRO NA LINHA DE COMANDO
// `vitest run test/tenant-isolation.test.ts` NÃO funciona aqui: o argumento
// posicional é um filtro aplicado DEPOIS do glob de include/exclude, então um
// arquivo excluído nunca chega a ser coletado e o vitest sai com "No test files
// found". Trocar o conjunto de arquivos pelo ambiente é o que faz o script
// `test:isolamento` (e o job próprio da CI) rodar a suíte de verdade.
//
// O INTERRUPTOR TEM DOIS LADOS
// Se a variável vazar no shell de alguém, `pnpm test` passa a rodar SÓ o
// isolamento e some com os outros arquivos — verde e em silêncio. Três coisas
// contêm isso: (1) o nome é longo e prefixado (`MKTOS_`) para não colidir com
// nada de terceiros; (2) valor desconhecido derruba o vitest na hora, em vez de
// cair no padrão; (3) o conjunto resolvido é registrado no log de toda
// execução. Na CI ainda há um piso de quantidade de casos, que é o que de fato
// pega o conjunto errado (ver `.github/workflows/ci.yml`).
const CONJUNTOS = {
  padrao: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/tenant-isolation.test.ts', 'test/memoria-agent.integration.test.ts'],
  },
  isolamento: {
    include: ['test/tenant-isolation.test.ts'],
    exclude: ['**/node_modules/**'],
  },
  'memoria-agente': {
    include: ['test/memoria-agent.integration.test.ts'],
    exclude: ['**/node_modules/**'],
  },
} as const;

type NomeDeConjunto = keyof typeof CONJUNTOS;

const nomeDoConjunto = process.env.MKTOS_CONJUNTO_DE_TESTES ?? 'padrao';
if (!(nomeDoConjunto in CONJUNTOS)) {
  throw new Error(
    `MKTOS_CONJUNTO_DE_TESTES="${nomeDoConjunto}" não existe. ` +
      `Conjuntos válidos: ${Object.keys(CONJUNTOS).join(', ')}. ` +
      'Preferimos derrubar aqui a rodar o conjunto errado em silêncio.',
  );
}
const conjunto = CONJUNTOS[nomeDoConjunto as NomeDeConjunto];

// stderr de propósito: `--reporter=json` sem `--outputFile` escreve o resumo no
// stdout, e uma linha nossa no meio dele quebraria quem for ler o JSON.
console.error(
  `[vitest] conjunto de testes: ${nomeDoConjunto} — arquivos: ${conjunto.include.join(', ')}`,
);

export default defineConfig({
  test: {
    include: [...conjunto.include],
    exclude: [...conjunto.exclude],
    environment: 'node',
    globals: true,
  },
});
