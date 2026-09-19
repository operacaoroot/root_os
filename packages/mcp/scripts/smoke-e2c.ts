import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

type Modo = 'ok' | 'unauthorized' | 'redirect' | 'timeout' | 'headers-pending' | 'invalid-json' | 'legacy-unauthorized' | 'legacy-login-timeout';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/index.ts');
const chave = (...partes: string[]) => partes.join('_');
const chaveModo = chave('MCP', 'MODE');
const chaveApi = chave('MCP', 'API', 'URL');
const chavePat = chave('MCP', 'AGENT', 'TOKEN');
const chaveTimeout = chave('MCP', 'TIMEOUT', 'MS');
const chaveSenhaLegada = chave('MCP', 'SERVICE', 'PASSWORD');
let modo: Modo = 'ok';
const requests: IncomingMessage[] = [];
let legacyLogins = 0;

function responder(req: IncomingMessage, res: ServerResponse): void {
  requests.push(req);
  if (req.url === '/api/auth/login') {
    legacyLogins += 1;
    if (modo === 'legacy-login-timeout') {
      setTimeout(() => res.end(), 500);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ token: 'legacy-sintetico' }));
    return;
  }
  if (modo === 'legacy-unauthorized') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (modo === 'timeout') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ diagnostico: 'ok', itens: [] }));
    }, 500);
    return;
  }
  if (modo === 'headers-pending') {
    res.writeHead(200, { 'content-type': 'application/json' });
    setTimeout(() => res.end(JSON.stringify({ diagnostico: 'ok', itens: [] })), 500);
    return;
  }
  if (modo === 'invalid-json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('INVALID_MARKER_SECRET');
    return;
  }
  if (modo === 'unauthorized') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', message: 'token revogado' }));
    return;
  }
  if (modo === 'redirect') {
    res.writeHead(302, { location: 'https://example.invalid/segredo' });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    diagnostico: 'ok', modo: 'textual', itens: [{ id: 'nota-sintetica', sourceRef: 'fixture.md', fields: { title: 'fixture' } }],
  }));
}

async function ouvir(): Promise<{ server: ReturnType<typeof createServer>; url: string }> {
  const server = createServer(responder);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, url: `http://127.0.0.1:${address.port}/api` };
}

async function rodarCliente(url: string, chamada: 'buscar' | 'ler' | 'legacy', mode = 'memoria'): Promise<{ names: string[]; resultado: any }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    cwd: resolve(here, '..'),
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      [chaveModo]: mode,
      [chaveApi]: url,
      [chavePat]: 'pat-sintetico-256bits',
      [chaveTimeout]: '100',
      ...(mode === 'legacy' ? { [chaveSenhaLegada]: 'segredo-legado-sintetico' } : {}),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-e2c-smoke', version: '0.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const resultado = await client.callTool({
    name: chamada === 'buscar' ? 'memoria_buscar' : chamada === 'ler' ? 'memoria_ler' : 'get_dashboard_summary',
    arguments: chamada === 'buscar' ? { q: 'fixture' } : chamada === 'ler' ? { id: 'nota-sintetica' } : {},
  });
  await client.close();
  await transport.close();
  return { names, resultado };
}

async function executar(): Promise<void> {
  const { server, url } = await ouvir();
  try {
    const ok = await rodarCliente(url, 'buscar');
    assert.deepEqual(ok.names, ['memoria_buscar', 'memoria_ler']);
    assert.equal(ok.resultado.isError, undefined);
    const leitura = await rodarCliente(url, 'ler');
    assert.equal(leitura.resultado.isError, undefined);
    assert(requests.some((req) => req.url?.startsWith('/api/agent/memoria/ler/')));

    for (const proximoModo of ['unauthorized', 'redirect', 'timeout', 'headers-pending', 'invalid-json'] as const) {
      requests.length = 0;
      modo = proximoModo;
      const falha = await rodarCliente(url, 'buscar');
      assert.deepEqual(falha.names, ['memoria_buscar', 'memoria_ler']);
      assert.equal(falha.resultado.isError, true);
      if (proximoModo === 'invalid-json') {
        assert.equal(JSON.stringify(falha.resultado).includes('INVALID_MARKER_SECRET'), false);
      }
      assert.equal(requests.some((req) => req.url?.includes('/auth/login')), false);
      assert.equal(requests.every((req) => req.headers.authorization === 'Bearer pat-sintetico-256bits'), true);
    }
    requests.length = 0;
    legacyLogins = 0;
    modo = 'legacy-unauthorized';
    const legacyFalha = await rodarCliente(url, 'legacy', 'legacy');
    assert.equal(legacyFalha.resultado.isError, true);
    assert.equal(legacyLogins, 2, 'modo legado deve autenticar no máximo uma vez após 401');

    requests.length = 0;
    legacyLogins = 0;
    modo = 'legacy-login-timeout';
    const loginFalho = await rodarCliente(url, 'legacy', 'legacy');
    assert.equal(loginFalho.resultado.isError, true);
    assert.equal(legacyLogins, 1);
    console.log('MCP_E2C_SMOKE_OK: catálogo canônico, PAT inválido/revogado, redirect sem bearer e timeout.');
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

await executar();
