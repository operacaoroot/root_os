/*
 * O comando do documento normativo, preservado:
 *   pnpm --filter @mktos/policy verificar politica-root.json
 *
 * Chama a MESMA função que o vitest (verificarCatalogo), para que rodar à mão
 * e rodar no CI não possam discordar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lerPolitica, lerDelta, resolverPolitica, type Politica } from '../src/esquema.js';
import { verificarCatalogo, verificarReversibilidade, casosDeDecisao } from '../src/verificacao.js';

const resolve = (nome: string) =>
  nome.startsWith('/') ? nome : fileURLToPath(new URL(`../${nome}`, import.meta.url));
const ler = (nome: string) => JSON.parse(readFileSync(resolve(nome), 'utf8'));

const arq = process.argv[2] ?? 'politica-root.json';
const bruto = ler(arq);

// Um arquivo com `estende` é delta: só vale verificado JUNTO com a base que
// ele herda — verificar o delta sozinho testaria metade da política.
let pol: Politica;
if (typeof bruto?.estende === 'string') {
  const delta = lerDelta(bruto, arq);
  pol = resolverPolitica(lerPolitica(ler(delta.estende), delta.estende), delta);
  console.log(`${arq} é delta sobre ${delta.estende} — verificando o resolvido\n`);
} else {
  pol = lerPolitica(bruto, arq);
}

let falhas = 0;
for (const l of verificarCatalogo(pol)) {
  if (!l.ok) falhas++;
  console.log(`${l.ok ? 'ok  ' : 'FALHA'} ${l.id.padEnd(32)} declarado=${l.declarado} calculado=${l.calculado}`);
  for (const p of l.problemas) console.log(`      ${p}`);
}

// A segunda trava, a mesma que o vitest roda: promessa de volta que ninguém dá.
const pendencias = verificarReversibilidade(pol);
if (pendencias.length) {
  console.log('\n--- reversibilidade ---');
  for (const l of pendencias) {
    falhas++;
    console.log(`FALHA ${l.id.padEnd(32)} ${l.motivo}${l.desfazer ? ` → ${l.desfazer}` : ''}`);
  }
}

const externo = pol.capacidades.find((c) => c.efeito.exposicaoExterna)?.id;
const interno = pol.capacidades.find((c) => c.nivel === 'R2')?.id;

/*
 * Aviso e não silêncio: o bloco inteiro de casos de decisão era pulado quando
 * faltava um R2 no catálogo, e o processo saía 0 — quem rodasse à mão via um
 * relatório aparentemente completo, sem os dois casos do degrau em que o
 * cliente decide. Não é falha (catálogo pode legitimamente não ter R2, é o caso
 * do politica-root.json hoje), mas tem que aparecer.
 */
if (!interno) {
  console.log(
    '\nAVISO: nenhuma capacidade R2 neste catálogo — os dois casos de decisão do degrau' +
      '\n       (aprovação configurável desligada, e elevação por fonte não confiável)' +
      '\n       NÃO foram exercidos aqui. Rode contra o catálogo resolvido do produto' +
      '\n       (politica-marketing-os.json) para vê-los.',
  );
}
if (!externo) {
  console.log('\nAVISO: nenhuma capacidade com exposição externa — casos de decisão não exercidos.');
} else {
  console.log('\n--- casos de decisão ---');
  for (const { nome, decisao: d } of casosDeDecisao(pol, { externo, interno: interno ?? null })) {
    console.log(
      `${nome.padEnd(34)} -> ${d.nivel} permitido=${d.permitido} aprova=${d.exigeAprovacao} reauth=${d.exigeReautenticacao} | ${d.motivo}`,
    );
  }
}

console.log(`\n${pol.capacidades.length} capacidades · ${falhas} divergência(s)`);
process.exit(falhas ? 1 : 0);
