// Teste end-to-end do MCP: sobe o servidor via stdio, lista as tools e chama algumas.
// Requer a API rodando (http://localhost:4001) com o seed aplicado.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/index.ts');

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ['--import', 'tsx', entry],
  env: process.env as Record<string, string>,
});

const client = new Client({ name: 'mktos-smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\nTools expostas (${tools.length}):`);
for (const t of tools) {
  console.log(`  • ${t.name} — ${t.annotations?.readOnlyHint ? 'read_only' : 'write'}`);
}

const summary = await client.callTool({ name: 'get_dashboard_summary', arguments: {} });
const text = (summary.content as Array<{ type: string; text: string }>)[0].text;
const d = JSON.parse(text);
console.log('\nget_dashboard_summary →', {
  leadsToday: d.leadsToday,
  conversions: d.conversions,
  revenue: d.revenue,
  overdueTasks: d.overdueTasks,
  source: d.source?.tool,
});

const funnel = await client.callTool({ name: 'get_funnel_metrics', arguments: {} });
const f = JSON.parse((funnel.content as Array<{ text: string }>)[0].text);
console.log('get_funnel_metrics → etapas:', f.stages.map((s: any) => `${s.label}:${s.count}`).join(' > '));

const leads = await client.callTool({ name: 'search_leads', arguments: { period: 'month' } });
const l = JSON.parse((leads.content as Array<{ text: string }>)[0].text);
console.log('search_leads(month) → total:', l.total);

console.log('\n✔ MCP OK');
await client.close();
process.exit(0);
