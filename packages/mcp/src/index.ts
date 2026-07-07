import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);

// IMPORTANTE: stdout é reservado ao protocolo MCP. Logs vão para stderr.
console.error('[marketing-os-mcp] servidor MCP no ar (stdio) — tools read-only.');
