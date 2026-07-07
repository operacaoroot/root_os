import { config } from './config.js';

// Cliente mínimo da Telegram Bot API via fetch (long polling). Sem dependências.
const API = () => `https://api.telegram.org/bot${config.telegram.token}`;

export interface TgMessage {
  chatId: number;
  text: string;
  from: string;
  messageId: number;
}

export async function getMe(): Promise<{ username: string; id: number }> {
  const r = await fetch(`${API()}/getMe`);
  const j = (await r.json()) as { ok: boolean; result?: { username: string; id: number }; description?: string };
  if (!j.ok || !j.result) throw new Error(`getMe falhou: ${j.description ?? 'desconhecido'}`);
  return j.result;
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  // Telegram limita ~4096 chars por mensagem.
  const body = text.slice(0, 4000);
  await fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: true }),
  });
}

// Mensagem com botões inline (confirmação de ação). buttons: linhas de {text, data}.
export async function sendButtons(
  chatId: number,
  text: string,
  buttons: Array<Array<{ text: string; data: string }>>,
): Promise<void> {
  await fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      reply_markup: {
        inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      },
    }),
  });
}

export async function answerCallback(id: string, text?: string): Promise<void> {
  await fetch(`${API()}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text }),
  }).catch(() => {});
}

export async function sendChatAction(chatId: number, action = 'typing'): Promise<void> {
  await fetch(`${API()}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export interface TgCallback {
  id: string; // callback_query id
  chatId: number;
  data: string; // callback_data
  from: string;
}

// Long polling: mensagens de texto e cliques em botões (callback_query).
export async function poll(handlers: {
  onMessage: (m: TgMessage) => Promise<void>;
  onCallback?: (c: TgCallback) => Promise<void>;
}): Promise<void> {
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let updates: any[] = [];
    try {
      const r = await fetch(`${API()}/getUpdates?timeout=30&offset=${offset}`);
      const j = (await r.json()) as { ok: boolean; result?: any[] };
      updates = j.result ?? [];
    } catch {
      await sleep(2000);
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.callback_query && handlers.onCallback) {
        const cq = u.callback_query;
        await handlers
          .onCallback({
            id: cq.id,
            chatId: cq.message?.chat?.id,
            data: cq.data ?? '',
            from: cq.from?.first_name ?? cq.from?.username ?? 'usuário',
          })
          .catch((e) => console.error('[telegram] erro no callback:', e));
        continue;
      }
      const msg = u.message;
      const text: string | undefined = msg?.text;
      if (!msg || !text) continue;
      await handlers
        .onMessage({
          chatId: msg.chat.id,
          text,
          from: msg.from?.first_name ?? msg.from?.username ?? 'usuário',
          messageId: msg.message_id,
        })
        .catch((e) => console.error('[telegram] erro no handler:', e));
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
