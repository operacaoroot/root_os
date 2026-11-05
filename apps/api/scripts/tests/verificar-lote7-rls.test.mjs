import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarLote7Rls } from '../verificar-lote7-rls.mjs';
const nomes = ['lote7-sala-rls.test.ts', 'lote7-emissao-rls.test.ts'];
const titulos = [['um novo clique só reaproveita a aprovação confirmada se o aprovador ainda tem autorização'], ['registro não reaproveita documento emitido por outra aprovação', 'preflight recusa documento de outra aprovação com vínculo=true sem consumir', 'preflight recusa documento de outra aprovação com vínculo=false sem consumir', 'retry mantém documento vinculado da aprovação apesar de outro documento com mesmo hash']];
const resumo = () => ({ success: true, numTotalTests: 14, numPassedTests: 14, numFailedTests: 0, numPendingTests: 0, testResults: nomes.map((nome, grupo) => ({ name: '/app/test/'+nome, assertionResults: Array.from({length:7}, (_, i) => ({status:'passed', title:titulos[grupo][i]??`caso ${i}`})) })) });
test('aceita as duas provas completas', () => assert.equal(validarLote7Rls(resumo()), 14));
test('recusa arquivo que deixou de ser coletado', () => {const r=resumo();r.testResults.pop();assert.throws(()=>validarLote7Rls(r));});
test('recusa duplicata no lugar da outra prova', () => {const r=resumo();r.testResults[1]=r.testResults[0];assert.throws(()=>validarLote7Rls(r));});
test('recusa caso pulado, falho ou pendente mesmo com resumo verde', () => {for(const status of ['skipped','failed','pending','todo']){const r=resumo();r.testResults[0].assertionResults[0].status=status;assert.throws(()=>validarLote7Rls(r));}});
test('recusa resumo incompleto e totais incoerentes', () => {for(const valor of [{}, {...resumo(),numPassedTests:13}, {...resumo(),numTotalTests:15}, {...resumo(),success:false}]) assert.throws(()=>validarLote7Rls(valor));});
test('recusa queda silenciosa no número de casos', () => {const r=resumo();r.testResults[0].assertionResults.splice(-2);r.numTotalTests-=2;r.numPassedTests-=2;assert.throws(()=>validarLote7Rls(r));});

test('recusa remoção de uma regressão crítica mesmo mantendo piso e totais coerentes', () => {for(const grupo of [0,1]){const r=resumo();r.testResults[grupo].assertionResults.shift();r.numTotalTests--;r.numPassedTests--;assert.throws(()=>validarLote7Rls(r));}});

test('exige recusa pré-consumo e a repetição pelo documento vinculado', () => {for(const indice of [1,2,3]){const r=resumo();r.testResults[1].assertionResults.splice(indice,1);r.numTotalTests--;r.numPassedTests--;assert.throws(()=>validarLote7Rls(r));}});
