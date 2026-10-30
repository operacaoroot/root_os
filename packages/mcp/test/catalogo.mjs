// QA sintético do MODO CATÁLOGO (A3, 30/10/2026): protocolo MCP stdio de verdade,
// API de mentira em HTTP local. Prova que (1) as ferramentas são as capacidades do
// catálogo do agente, mais `rootinha_definicao`; (2) leitura vai pelo GET da rota,
// escrita pela rota de execução do agente, sempre com o token do corpo e nunca com a
// conta de serviço; (3) a origem vai no `_meta`, não nos argumentos; (4) o modo de
// sempre continua com as 35 e não sobe sem a senha.
//
//   pnpm --filter @mktos/mcp build && node packages/mcp/test/catalogo.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOKEN = `rcx.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'s'.repeat(43)}`;
const requests = [];
const CATALOGO = {
  agente: 'rootinha',
  estado: 'ativo',
  semEfeito: ['email.rascunhar'],
  ferramentas: [
    { id: 'numeros.painel.ler', descricao: 'Resumo do painel.', nivel: 'R0', argsSchema: null, caminho: 'leitura', rota: 'GET /dashboard/summary', temEfeito: true },
    { id: 'crm.lead.ler', descricao: 'Ficha do lead.', nivel: 'R0', argsSchema: null, caminho: 'leitura', rota: 'GET /leads/:id', temEfeito: false },
    { id: 'operacao.tarefa.atrasada', descricao: 'Atrasadas.', nivel: 'R0', argsSchema: null, caminho: 'leitura', rota: 'GET /tasks?overdue=1', temEfeito: true },
    {
      id: 'operacao.tarefa.criar', descricao: 'Cria tarefa.', nivel: 'R1', caminho: 'execucao',
      rota: 'POST /agents/rootinha/capacidades/operacao.tarefa.criar/executar', temEfeito: true,
      argsSchema: { type: 'object', additionalProperties: false, required: ['titulo'], properties: { titulo: { type: 'string', minLength: 1, maxLength: 300 }, prazo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
    },
  ],
};
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let corpo = '';
  for await (const pedaco of req) corpo += pedaco;
  requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body: corpo ? JSON.parse(corpo) : null });
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; res.end('{}'); return; }
  if (url.pathname === '/api/agents/rootinha/catalogo-externo') return res.end(JSON.stringify(CATALOGO));
  if (url.pathname === '/api/agents/rootinha/definicao') return res.end(JSON.stringify({ slug: 'rootinha', missao: 'operar a Root', voz: { fonte: 'cadastro', texto: 'direta' } }));
  if (req.method === 'GET') return res.end(JSON.stringify({ lido: url.pathname }));
  if (req.method === 'POST' && url.pathname.endsWith('/executar')) return res.end(JSON.stringify({ status: 'executado', resultado: { criada: true } }));
  res.statusCode = 404; res.end('{}');
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const API = `http://127.0.0.1:${http.address().port}/api`;
const index = fileURLToPath(new URL('../dist/index.js', import.meta.url));

let cases = 0;
const client = new Client({ name: 'catalogo-qa', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [index],
    env: { PATH: process.env.PATH, MCP_API_URL: API, MCP_MODO: 'catalogo', MCP_AGENTE: 'rootinha', MCP_CORPO_TOKEN: TOKEN },
  }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['crm.lead.ler', 'numeros.painel.ler', 'operacao.tarefa.atrasada', 'operacao.tarefa.criar', 'rootinha_definicao']); cases++;
  const criar = tools.find((t) => t.name === 'operacao.tarefa.criar');
  assert.deepEqual(criar.inputSchema.required, ['titulo']);
  assert.equal(criar.inputSchema.properties.titulo.maxLength, 300); cases++;
  assert.deepEqual(tools.find((t) => t.name === 'crm.lead.ler').inputSchema.required, ['id']); cases++;

  const decode = (r) => JSON.parse(r.content[0].text);
  assert.deepEqual(decode(await client.callTool({ name: 'crm.lead.ler', arguments: { id: 'abc/1' } })), { lido: '/api/leads/abc%2F1' }); cases++;
  await client.callTool({ name: 'operacao.tarefa.atrasada', arguments: {} });
  assert.deepEqual(requests.at(-1).query, { overdue: '1' }); cases++;

  const r = await client.callTool({
    name: 'operacao.tarefa.criar',
    arguments: { titulo: 'revisar contrato' },
    _meta: { 'root/origem': { canal: 'whatsapp', mensagemId: 'WAMID-1', procedenciaExterna: true } },
  });
  assert.equal(decode(r).status, 'executado');
  const post = requests.at(-1);
  assert.equal(post.method, 'POST');
  assert.equal(post.path, '/api/agents/rootinha/capacidades/operacao.tarefa.criar/executar');
  assert.deepEqual(post.body, { args: { titulo: 'revisar contrato' }, procedenciaExterna: true, origem: { canal: 'whatsapp', mensagemId: 'WAMID-1' } }); cases++;

  const antes = requests.length;
  assert.equal((await client.callTool({ name: 'operacao.tarefa.criar', arguments: { titulo: 'x', prazo: 'amanhã' } })).isError, true);
  assert.equal(requests.length, antes); cases++;

  assert.equal(decode(await client.callTool({ name: 'rootinha_definicao', arguments: {} })).missao, 'operar a Root');
  const recurso = await client.readResource({ uri: 'rootos://agentes/rootinha/definicao' });
  assert.equal(JSON.parse(recurso.contents[0].text).slug, 'rootinha'); cases++;

  assert.ok(requests.every((q) => q.auth === `Bearer ${TOKEN}`));
  assert.ok(!requests.some((q) => q.path === '/api/auth/login'));
  assert.ok(requests.every((q) => q.method === 'GET' || q.path.endsWith('/executar'))); cases++;
} finally {
  await client.close();
}

// O modo de sempre: 35 ferramentas, e não sobe sem a senha da conta de serviço.
const sempre = new Client({ name: 'leitura-qa', version: '1.0.0' });
try {
  await sempre.connect(new StdioClientTransport({ command: process.execPath, args: [index], env: { PATH: process.env.PATH, MCP_API_URL: API, MCP_SERVICE_PASSWORD: 'synthetic-only' } }));
  assert.equal((await sempre.listTools()).tools.length, 35); cases++;
} finally {
  await sempre.close();
}
const semSenha = spawnSync(process.execPath, [index], { env: { PATH: process.env.PATH, MCP_API_URL: API }, encoding: 'utf8', timeout: 10_000 });
assert.notEqual(semSenha.status, 0);
assert.match(semSenha.stderr, /MCP_SERVICE_PASSWORD ausente/); cases++;
const semToken = spawnSync(process.execPath, [index], { env: { PATH: process.env.PATH, MCP_API_URL: API, MCP_MODO: 'catalogo' }, encoding: 'utf8', timeout: 10_000 });
assert.notEqual(semToken.status, 0);
assert.match(semToken.stderr, /MCP_CORPO_TOKEN ausente/); cases++;

await new Promise((resolve) => http.close(resolve));
console.log(JSON.stringify({ passed: cases, failed: 0, data: 'synthetic', boundary: 'stdio -> HTTP loopback (API de mentira)' }));
