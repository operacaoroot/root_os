// QA sintético: protocolo MCP stdio, HTTP local, parser/WorkService reais e Prisma em memória.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const { WorkController } = require('../../../apps/api/dist/work/work.controller.js');
const { WorkService } = require('../../../apps/api/dist/work/work.service.js');
const { selectedTaskSnapshot } = require('../../../apps/api/dist/work/selected-work-tasks.js');
const rows = Array.from({ length: 501 }, (_, i) => ({
  id: `synthetic-${i}`, title: `QA ${i}`, orgId: 'synthetic-org', listId: 'synthetic-list',
  statusId: 'synthetic-status', status: { name: 'Aberta', type: 'open', color: '#000' },
  agenteId: null, dueDate: null, startDate: null, assignee: null, parentId: null,
  priority: 'normal', tags: [], values: [], _count: { subtasks: 0, comments: 0 },
}));
const queries = [], requests = [];
const prisma = {
  workTask: {
    findMany: async (q) => { queries.push(q); assert.equal(q.where.orgId, 'synthetic-org'); return rows.slice(q.skip, q.skip + q.take); },
    count: async () => rows.length,
  },
  workApontamento: { groupBy: async () => [] },
};
const work = new WorkService(prisma, {}, {});
const controller = new WorkController(work, {});
let unauthorizedOnce = false;
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/api/auth/login') { res.end(JSON.stringify({ token: 'synthetic-token' })); return; }
  if (unauthorizedOnce) { unauthorizedOnce = false; res.statusCode = 401; res.end('{}'); return; }
  assert.equal(req.headers.authorization, 'Bearer synthetic-token');
  try {
    const result = await controller.tarefas({ orgId: 'synthetic-org' }, Object.fromEntries(url.searchParams));
    res.end(JSON.stringify(result));
  } catch (e) { res.statusCode = e.getStatus?.() ?? 500; res.end(JSON.stringify({ message: e.message })); }
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  env: { PATH: process.env.PATH, MCP_API_URL: `http://127.0.0.1:${http.address().port}/api`, MCP_SERVICE_PASSWORD: 'synthetic-only' },
});
const client = new Client({ name: 'release-qa', version: '1.0.0' });
const call = (args) => client.callTool({ name: 'trabalho_tarefas', arguments: args });
const decode = (result) => JSON.parse(result.content[0].text);
let cases = 0;
try {
  await client.connect(transport);
  const tool = (await client.listTools()).tools.find((t) => t.name === 'trabalho_tarefas');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.properties.limit.maximum, 500); cases++;
  let result = decode(await call({}));
  assert.equal(result.items.length, 500); assert.equal(result.total, 501);
  assert.deepEqual(requests.at(-1).query, {}); cases++;
  result = decode(await call({ list_id: 'synthetic-list', page: 2, limit: 500 }));
  assert.deepEqual(result.items.map((r) => r.id), ['synthetic-500']);
  assert.deepEqual(requests.at(-1).query, { listId: 'synthetic-list', page: '2', limit: '500' }); cases++;
  for (const args of [{ page: 0 }, { page: 1.5 }, { page: 100001 }, { limit: 0 }, { limit: 501 }, { limit: '2' }]) {
    const before = requests.length;
    assert.equal((await call(args)).isError, true);
    assert.equal(requests.length, before); cases++;
  }
  assert.equal((await call({ page: 100000, limit: 500 })).isError, true);
  assert.equal(requests.at(-1).query.page, '100000'); cases++;
  unauthorizedOnce = true;
  const before = requests.length;
  result = decode(await call({ page: 2, limit: 500 }));
  assert.equal(result.items[0].id, 'synthetic-500');
  assert.deepEqual(requests.slice(before).map((r) => r.path), ['/api/trabalho/tarefas', '/api/auth/login', '/api/trabalho/tarefas']); cases++;
  queries.length = 0;
  const snapshot = await selectedTaskSnapshot(work, 'synthetic-org', { listId: 'synthetic-list' });
  assert.deepEqual(snapshot.items.map((r) => r.id), rows.map((r) => r.id));
  assert.deepEqual(queries.map((q) => [q.skip, q.take]), [[0, 500], [500, 500]]); cases++;
  assert.ok(requests.every((r) => r.path === '/api/auth/login' || r.method === 'GET'));
  console.log(JSON.stringify({ passed: cases, failed: 0, data: 'synthetic', paidApi: false, boundary: 'stdio -> HTTP loopback -> real WorkController parser -> real WorkService -> in-memory Prisma; auth stub', requests: requests.length }));
} finally {
  await client.close();
  await new Promise((resolve) => http.close(resolve));
}
