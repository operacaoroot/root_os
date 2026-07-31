import { config, assertConfigured } from './config.js';
import { McpAgent } from './mcp-agent.js';
import { DAILY_BRIEFING_PROMPT } from './prompts.js';
import { scheduleDaily } from './scheduler.js';
import { executeAction, type ProposedAction } from './actions.js';
import { writeClient } from './write-client.js';
import {
  answerCallback,
  getMe,
  poll,
  sendButtons,
  sendChatAction,
  sendMessage,
  type TgCallback,
  type TgMessage,
} from './telegram.js';

const HELP = `🤖 Assistente do Marketing OS
Pergunte em linguagem natural que eu consulto o sistema pelas ferramentas do MCP.

Exemplos (leitura):
• Qual o resumo do dia?
• Quantos eventos e qual a receita nos últimos 7 dias?
• Como está o funil?

Exemplos (ação — eu proponho e você confirma no botão):
• Marque o lead do Bruno como ganho
• Conclua a tarefa "Revisar copy da página"
• Pause a campanha Remarketing Q3

Comandos: /resumo · /start · /help · /id`;

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

  // Empurra o briefing do dia para os chats da allowlist (destinatários = quem pode usar o bot).
  const sendDaily = async (reason: string) => {
    const chats = config.telegram.allowedChatIds;
    if (chats.length === 0) {
      console.warn('[daily] sem chat de destino (defina TELEGRAM_ALLOWED_CHAT_IDS).');
      return;
    }
    const { text: answer } = await agent.ask(DAILY_BRIEFING_PROMPT);
    const text = `☀️ Resumo do dia (${reason})\n\n${answer}`;
    for (const c of chats) await sendMessage(Number(c), text);
    console.log(`[daily] enviado p/ ${chats.length} chat(s) — ${reason}`);
  };

  // Ações propostas aguardando confirmação (id curto → proposta + ticket de aprovação).
  const pending = new Map<string, { action: ProposedAction; approvalId: string; token: string }>();
  let seq = 0;

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

    const question = cmd === '/resumo' ? DAILY_BRIEFING_PROMPT : m.text;
    await sendChatAction(m.chatId, 'typing');
    try {
      const { text, action } = await agent.ask(question);
      await sendMessage(m.chatId, text);
      if (action) {
        // registra a proposta no backend (pending) ANTES de oferecer o botão —
        // a escrita real só sai com o token confirmado (enforced na API).
        const ticket = await writeClient.createApproval({
          resourceType: action.resourceType,
          resourceId: action.resourceId,
          changes: action.changes,
          summary: action.describe,
        });
        const id = `a${++seq}`;
        pending.set(id, { action, approvalId: ticket.approvalId, token: ticket.token });
        await sendButtons(m.chatId, `🔔 Confirmar ação?\n${action.describe}`, [
          [{ text: '✅ Confirmar', data: `confirm:${id}` }, { text: '✖️ Cancelar', data: `cancel:${id}` }],
        ]);
      }
    } catch (e) {
      await sendMessage(m.chatId, `⚠️ Erro: ${(e as Error).message}`);
      console.error('[telegram] erro ao responder:', e);
    }
  };

  const handleCallback = async (c: TgCallback) => {
    if (!allowed(c.chatId)) {
      await answerCallback(c.id, 'Sem permissão.');
      return;
    }
    const [verb, id] = c.data.split(':');
    const entry = id ? pending.get(id) : undefined;
    if (!entry) {
      await answerCallback(c.id, 'Ação expirada.');
      return;
    }
    pending.delete(id);
    if (verb === 'cancel') {
      writeClient.rejectApproval(entry.approvalId).catch(() => {});
      await answerCallback(c.id, 'Cancelado.');
      await sendMessage(c.chatId, '✖️ Ação cancelada.');
      return;
    }
    try {
      // confirma a aprovação (backend) e só então executa a escrita com o token
      await writeClient.confirmApproval(entry.approvalId);
      const result = await executeAction(entry.action, entry.token);
      await answerCallback(c.id, 'Feito ✓');
      await sendMessage(c.chatId, result);
      console.log(`[telegram] ${c.from} confirmou: ${entry.action.describe}`);
    } catch (e) {
      await answerCallback(c.id, 'Falhou.');
      await sendMessage(c.chatId, `⚠️ Não consegui executar: ${(e as Error).message}`);
      console.error('[telegram] erro ao executar ação:', e);
    }
  };

  const shutdown = async () => {
    console.log('\n[telegram] encerrando…');
    await agent.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Agendamento do resumo diário (in-process).
  if (config.daily.enabled && config.telegram.allowedChatIds.length > 0) {
    scheduleDaily({
      time: config.daily.time,
      tz: config.daily.tz,
      onFire: () => sendDaily('automático'),
      log: (msg) => console.log('[scheduler]', msg),
    });
  } else if (config.daily.enabled) {
    console.warn('[scheduler] resumo diário ligado, mas sem allowlist p/ destino — não agendado.');
  }

  // Gatilho de teste: DAILY_REPORT_NOW=1 envia um resumo agora (validação).
  if (process.env.DAILY_REPORT_NOW === '1') {
    await sendDaily('teste manual');
  }

  await poll({ onMessage: handle, onCallback: handleCallback });
}

main().catch((e) => {
  console.error('[telegram] falha fatal:', e.message);
  process.exit(1);
});
