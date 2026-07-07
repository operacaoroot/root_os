import { config, assertConfigured } from './config.js';
import { McpAgent } from './mcp-agent.js';
import { getMe, poll, sendChatAction, sendMessage, type TgMessage } from './telegram.js';

const HELP = `🤖 Assistente do Marketing OS
Pergunte em linguagem natural que eu consulto o sistema pelas ferramentas do MCP.

Exemplos:
• Qual o resumo do dia?
• Quantos eventos e qual a receita nos últimos 7 dias?
• Como está o funil?
• Tem tarefa atrasada?
• Quais campanhas estão em risco?

Comandos: /resumo · /start · /help · /id`;

// Briefing do dia sob demanda (mesmos dados do painel, via tools do MCP).
const RESUMO_PROMPT = `Gere um BRIEFING EXECUTIVO do dia para o Telegram, curto e em bullets.
Consulte as ferramentas e cubra: leads (hoje/mês) e vendas/receita; taxa de conversão e CPL;
tráfego do pixel (eventos e principal origem nos últimos 7 dias); tarefas atrasadas; campanhas
em risco. Não invente números — use só o que vier das ferramentas.`;

function allowed(chatId: number): boolean {
  const list = config.telegram.allowedChatIds;
  return list.length === 0 || list.includes(String(chatId));
}

async function main() {
  assertConfigured();

  const agent = new McpAgent();
  const toolNames = await agent.connect();
  const me = await getMe();
  console.log(`[telegram] bot @${me.username} no ar · MCP com ${toolNames.length} tools: ${toolNames.join(', ')}`);
  if (config.telegram.allowedChatIds.length === 0) {
    console.warn('[telegram] ATENÇÃO: sem allowlist (TELEGRAM_ALLOWED_CHAT_IDS) — responde a QUALQUER um. Use /id p/ pegar seu chat id e restringir.');
  }

  const handle = async (m: TgMessage) => {
    const cmd = m.text.trim().toLowerCase();
    console.log(`[telegram] ${m.from} (chat ${m.chatId}): ${m.text.slice(0, 80)}`);

    if (cmd === '/id') {
      await sendMessage(m.chatId, `Seu chat id: ${m.chatId}\nAdicione em TELEGRAM_ALLOWED_CHAT_IDS para restringir o bot a você.`);
      return;
    }
    if (cmd === '/start' || cmd === '/help') {
      await sendMessage(m.chatId, HELP);
      return;
    }
    if (!allowed(m.chatId)) {
      await sendMessage(m.chatId, `Sem permissão. Seu chat id é ${m.chatId} — peça ao admin para liberar.`);
      console.warn(`[telegram] mensagem de chat não autorizado ${m.chatId} (${m.from})`);
      return;
    }

    const question = cmd === '/resumo' ? RESUMO_PROMPT : m.text;
    await sendChatAction(m.chatId, 'typing');
    try {
      const answer = await agent.ask(question);
      await sendMessage(m.chatId, answer);
    } catch (e) {
      await sendMessage(m.chatId, `⚠️ Erro: ${(e as Error).message}`);
      console.error('[telegram] erro ao responder:', e);
    }
  };

  const shutdown = async () => {
    console.log('\n[telegram] encerrando…');
    await agent.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await poll(handle);
}

main().catch((e) => {
  console.error('[telegram] falha fatal:', e.message);
  process.exit(1);
});
