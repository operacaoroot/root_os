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
      'Tem alguma tarefa atrasada ou campanha em risco?',
      'Marque a lead Ana Prado como qualificado', // deve PROPOR (não executar)
    ];

for (const q of perguntas) {
  console.log('❓', q);
  const { text, action } = await agent.ask(q);
  console.log('🤖', text);
  if (action) console.log('   ⚑ AÇÃO PROPOSTA (aguardaria confirmação):', action.describe);
  console.log('');
}

await agent.close();
process.exit(0);
