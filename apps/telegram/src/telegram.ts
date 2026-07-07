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

export async function sendChatAction(chatId: number, action = 'typing'): Promise<void> {
  await fetch(`${API()}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

// Long polling: chama onMessage para cada mensagem de texto nova.
export async function poll(onMessage: (m: TgMessage) => Promise<void>): Promise<void> {
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
      const msg = u.message;
      const text: string | undefined = msg?.text;
      if (!msg || !text) continue;
      await onMessage({
        chatId: msg.chat.id,
        text,
        from: msg.from?.first_name ?? msg.from?.username ?? 'usuário',
        messageId: msg.message_id,
      }).catch((e) => console.error('[telegram] erro no handler:', e));
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
