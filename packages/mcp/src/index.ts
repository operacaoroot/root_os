import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';
import { buildServerDoCatalogo } from './catalogo.js';
import { exigirSenhaDaContaDeServico } from './client.js';

/*
 * Dois modos (A3, 30/10/2026):
 *   · `leitura` (padrão): as 35 ferramentas escritas à mão, só leitura, com a
 *     conta de serviço `ia_servico`. Intacto.
 *   · `catalogo`: as ferramentas são as capacidades que o agente do token do
 *     corpo declarou (`MCP_CORPO_TOKEN`, `MCP_AGENTE`), geradas do catálogo da
 *     API no arranque. Leituras pelas rotas GET de sempre; escritas pela rota de
 *     execução do agente, que passa pela porta.
 */
const modo = (process.env.MCP_MODO ?? 'leitura').trim();

let server;
if (modo === 'catalogo') {
  server = await buildServerDoCatalogo();
} else if (modo === 'leitura') {
  exigirSenhaDaContaDeServico();
  server = buildServer();
} else {
  throw new Error(`MCP_MODO="${modo}" não existe: use "leitura" (padrão) ou "catalogo".`);
}
const transport = new StdioServerTransport();
await server.connect(transport);

// IMPORTANTE: stdout é reservado ao protocolo MCP. Logs vão para stderr.
console.error(
  modo === 'catalogo'
    ? '[marketing-os-mcp] servidor MCP no ar (stdio) — modo catálogo, pelo token do corpo.'
    : '[marketing-os-mcp] servidor MCP no ar (stdio) — tools read-only.',
);
