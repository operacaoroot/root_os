// Valida a ponte IA ↔ MCP SEM Telegram: conecta ao MCP, lista as tools e faz
// algumas perguntas — a IA decide quais tools chamar e responde com dados reais.
// Requer a API rodando (:4001) + OPENAI_API_KEY (~/.config/root/openai.env).
// Uso: pnpm --filter @mktos/telegram ask  ["sua pergunta"]
import { config } from '../src/config.js';
import { McpAgent } from '../src/mcp-agent.js';

if (!config.openai.apiKey) {
  console.error('OPENAI_API_KEY ausente (~/.config/root/openai.env).');
  process.exit(1);
}

const agent = new McpAgent();
const tools = await agent.connect();
console.log(`MCP conectado · ${tools.length} tools: ${tools.join(', ')}\n`);

const perguntas = process.argv[2]
  ? [process.argv[2]]
  : [
      'Qual o resumo do dia? Quantos leads, vendas e qual a receita?',
      'Nos últimos 7 dias, quantos eventos do pixel e qual a principal origem de tráfego?',
      'Tem alguma tarefa atrasada ou campanha em risco?',
    ];

for (const q of perguntas) {
  console.log('❓', q);
  const a = await agent.ask(q);
  console.log('🤖', a, '\n');
}

await agent.close();
process.exit(0);
