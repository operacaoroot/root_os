// O inventário fechado e o casamento de rotas (dist/: rodar depois do build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROTAS } from '../dist/rotas.gen.js';
import { acharRota, alcancavel, buscarRotas, normalizarRota, totalDeRotas } from '../dist/rotas.js';

test('o inventário tem o tamanho da API e nenhuma rota repetida', () => {
  assert.ok(ROTAS.length > 700, `rotas: ${ROTAS.length}`);
  const chaves = new Set(ROTAS.map((r) => `${r.m} ${r.r}`));
  assert.equal(chaves.size, ROTAS.length);
});

test('normaliza caminho com ou sem /api, query e barra final', () => {
  assert.equal(normalizarRota('/comercial/funil?dono=eu'), '/api/comercial/funil');
  assert.equal(normalizarRota('api/comercial/funil/'), '/api/comercial/funil');
});

test('acha a rota pelos parâmetros e prefere a mais específica', () => {
  const r = acharRota('GET', '/comercial/lead/abc-123/area');
  assert.equal(r?.r, '/api/comercial/lead/:id/area');
  assert.equal(acharRota('PUT', '/api/comercial/lead/x/area/atas/rascunho')?.r, '/api/comercial/lead/:id/area/:item/rascunho');
  assert.equal(acharRota('GET', '/nao/existe'), null);
  assert.equal(acharRota('DELETE', '/comercial/funil'), null);
});

test('rota pública e de login não são alcançáveis; as demais são', () => {
  const sala = ROTAS.find((r) => r.r === '/api/sala/:token');
  assert.ok(sala && !alcancavel(sala));
  const login = ROTAS.find((r) => r.r === '/api/auth/login');
  assert.ok(login && !alcancavel(login));
  const funil = ROTAS.find((r) => r.r === '/api/comercial/funil');
  assert.ok(funil && alcancavel(funil));
  const t = totalDeRotas();
  assert.equal(t.total, ROTAS.length);
  assert.ok(t.alcancaveis < t.total && t.publicas > 40);
});

test('busca por palavras acha a rota de mover tarefa e respeita método e módulo', () => {
  const achadas = buscarRotas('tarefas mover', { metodo: 'POST', modulo: 'trabalho' });
  assert.ok(achadas.some((r) => r.r === '/api/trabalho/tarefas/:id/mover'));
  assert.ok(achadas.every((r) => r.m === 'POST' && r.r.startsWith('/api/trabalho')));
  assert.equal(buscarRotas('xyzw-nada-disso').length, 0);
});
