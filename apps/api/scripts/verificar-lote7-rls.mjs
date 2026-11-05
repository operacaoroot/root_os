import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const regressoes = {
  'lote7-sala-rls.test.ts': ['um novo clique só reaproveita a aprovação confirmada se o aprovador ainda tem autorização'],
  'lote7-emissao-rls.test.ts': [
    'registro não reaproveita documento emitido por outra aprovação',
    'preflight recusa documento de outra aprovação com vínculo=true sem consumir',
    'preflight recusa documento de outra aprovação com vínculo=false sem consumir',
    'retry mantém documento vinculado da aprovação apesar de outro documento com mesmo hash',
  ],
};
const arquivos = Object.keys(regressoes);
export function validarLote7Rls(r) {
  if (!r || r.success !== true || r.numFailedTests !== 0 || r.numPendingTests !== 0 ||
      !Number.isInteger(r.numTotalTests) || r.numTotalTests !== r.numPassedTests || !Array.isArray(r.testResults)) {
    throw new Error('Lote 7: as provas RLS precisam passar sem pulos.');
  }
  let total = 0;
  for (const nome of arquivos) {
    const encontrados = r.testResults.filter(a => typeof a.name === 'string' && a.name.endsWith('/test/' + nome));
    if (encontrados.length !== 1 || !Array.isArray(encontrados[0].assertionResults) ||
        encontrados[0].assertionResults.length < 6 || encontrados[0].assertionResults.some(c => c.status !== 'passed')) {
      throw new Error(`Lote 7: ${nome} deve executar ao menos seis casos, todos aprovados.`);
    }
    if (regressoes[nome].some(titulo => !encontrados[0].assertionResults.some(c => c.title === titulo))) {
      throw new Error(`Lote 7: regressão obrigatória ausente em ${nome}.`);
    }
    total += encontrados[0].assertionResults.length;
  }
  if (r.testResults.length !== arquivos.length || total !== r.numTotalTests) throw new Error('Lote 7: total ou arquivos incoerentes.');
  return total;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const total = validarLote7Rls(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log(`Lote 7 RLS: ${total} casos aprovados em duas suites, sem pulos.`);
}
