// Chama UMA ferramenta do servidor MCP pela linha de comando, pelo mesmo protocolo que o Claude usa.
// Uso: pnpm --filter @mktos/mcp chamar <ferramenta> ['<json dos argumentos>']
// Ex.:  pnpm --filter @mktos/mcp chamar quem_sou
//       pnpm --filter @mktos/mcp chamar area_bancada '{"lead_id":"..."}'
// Variáveis: as mesmas do servidor (MCP_API_URL, MCP_SERVICE_PASSWORD, MCP_OPERADOR_*; ou ~/.config/root/mcp.env).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [ferramenta, argsJson = '{}'] = process.argv.slice(2);
if (!ferramenta) {
  console.error('uso: chamar <ferramenta> [json]  (ou "listar")');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.js');
const args = existsSync(dist) ? [dist] : ['--import', 'tsx', resolve(here, '../src/index.ts')];
const transport = new StdioClientTransport({ command: process.execPath, args, env: process.env as Record<string, string>, stderr: 'inherit' });
const client = new Client({ name: 'root-os-mcp-chamar', version: '0.0.0' });
await client.connect(transport);
if (ferramenta === 'listar') {
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`${t.name}\t${t.annotations?.readOnlyHint ? 'read_only' : 'write'}\t${t.annotations?.title ?? ''}`);
  console.log(`total: ${tools.length}`);
} else {
  const r = await client.callTool({ name: ferramenta, arguments: JSON.parse(argsJson) });
  for (const c of r.content as Array<{ type: string; text?: string }>) if (c.type === 'text') console.log(c.text);
  if (r.isError) process.exitCode = 1;
}
await client.close();
