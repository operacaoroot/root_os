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
import { verificarCatalogo, casosDeDecisao } from '../src/verificacao.js';

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
}

const externo = pol.capacidades.find((c) => c.efeito.exposicaoExterna)?.id;
const interno = pol.capacidades.find((c) => c.nivel === 'R2')?.id;
if (externo && interno) {
  console.log('\n--- casos de decisão ---');
  for (const { nome, decisao: d } of casosDeDecisao(pol, { externo, interno })) {
    console.log(
      `${nome.padEnd(34)} -> ${d.nivel} permitido=${d.permitido} aprova=${d.exigeAprovacao} reauth=${d.exigeReautenticacao} | ${d.motivo}`,
    );
  }
}

console.log(`\n${pol.capacidades.length} capacidades · ${falhas} divergência(s)`);
process.exit(falhas ? 1 : 0);
