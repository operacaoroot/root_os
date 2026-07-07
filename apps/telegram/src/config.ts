import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Credenciais PRÓPRIAS do root (isolamento): ~/.config/root/*.env — nunca no repo.
// Parser mínimo KEY=VALUE (sem dep de dotenv); não sobrescreve envs já definidas.
function loadRootEnv(name: string): void {
  const p = join(homedir(), '.config', 'root', name);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
for (const name of ['openai.env', 'telegram.env']) loadRootEnv(name);

export const config = {
  // OpenAI (mesma credencial usada pela API; gpt-4o temporário)
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  },
  // Telegram Bot API
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    // allowlist opcional de chat ids (segurança): só responde a esses. Vazio = responde a todos.
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // Resumo diário automático (empurrado pelo bot para os chats da allowlist).
  daily: {
    enabled: (process.env.DAILY_REPORT_ENABLED ?? '1') !== '0',
    time: process.env.DAILY_REPORT_TIME ?? '08:00', // HH:MM
    tz: process.env.DAILY_REPORT_TZ ?? 'America/Sao_Paulo',
  },
  // MCP: como spawnar o servidor (stdio). A conta de serviço é lida pelo próprio server.
  mcp: {
    entry:
      process.env.MCP_ENTRY ??
      join(homedir(), 'marketing-os', 'packages', 'mcp', 'dist', 'index.js'),
    apiUrl: process.env.MCP_API_URL ?? 'http://localhost:4001/api',
    serviceEmail: process.env.MCP_SERVICE_EMAIL ?? 'mcp@marketing-os.local',
    servicePassword: process.env.MCP_SERVICE_PASSWORD ?? 'mcp-service-12345',
  },
};

export function assertConfigured(): void {
  const missing: string[] = [];
  if (!config.openai.apiKey) missing.push('OPENAI_API_KEY (~/.config/root/openai.env)');
  if (!config.telegram.token) missing.push('TELEGRAM_BOT_TOKEN (~/.config/root/telegram.env)');
  if (missing.length) {
    throw new Error(`Configuração ausente:\n  - ${missing.join('\n  - ')}`);
  }
}
