# @mktos/telegram — Bot de Telegram (valida o MCP com IA)

Bot de Telegram que serve de **cliente de IA para o MCP** do Marketing OS. Você pergunta em
linguagem natural; uma IA (OpenAI, `gpt-4o` temporário) recebe as **tools do MCP** como
function-calling, decide o que chamar e responde com **dados reais**.

Cadeia: **Telegram → IA (OpenAI) → MCP (stdio) → API (conta de serviço só-leitura, RBAC) → banco.**
A IA nunca toca o banco direto — tudo passa pelo MCP e pela API. É a validação do MCP como Hub.

> Substitui o WhatsApp **por enquanto** (Zapfy fica para o app consolidado). Mesmo canal servirá
> depois para empurrar o resumo diário e alertas.

## Pré-requisitos
- API do Marketing OS no ar (`:4001`) com o seed (conta de serviço `mcp@marketing-os.local`).
- MCP buildado: `pnpm --filter @mktos/mcp build`.
- Credenciais em `~/.config/root/` (isolamento do root; nunca no repo):
  - `openai.env` → `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o`.
  - `telegram.env` → `TELEGRAM_BOT_TOKEN`, opcional `TELEGRAM_ALLOWED_CHAT_IDS`.

## Criar o bot (1 min)
1. No Telegram, fale com **@BotFather** → `/newbot` → escolha nome e username (termina em `bot`).
2. Copie o **token** e cole em `~/.config/root/telegram.env` (`TELEGRAM_BOT_TOKEN=...`).
3. (Recomendado) mande `/id` para o bot depois de subir, pegue seu `chat id` e coloque em
   `TELEGRAM_ALLOWED_CHAT_IDS` para o bot só responder a você.

## Rodar
```bash
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
# valida a cadeia IA↔MCP SEM Telegram (só precisa da API + OPENAI_API_KEY):
pnpm --filter @mktos/telegram ask
pnpm --filter @mktos/telegram ask "como está o funil?"

# sobe o bot ao vivo (precisa do TELEGRAM_BOT_TOKEN):
pnpm --filter @mktos/telegram build && pnpm --filter @mktos/telegram start
# ou em dev: pnpm --filter @mktos/telegram dev
```

## Comandos no chat
- `/start` · `/help` — ajuda e exemplos.
- `/resumo` — briefing executivo do dia (mesmo conteúdo do envio automático).
- `/id` — mostra seu chat id (para a allowlist).
- Qualquer texto — vira pergunta ao assistente (ex.: *"resumo do dia"*, *"tarefas atrasadas"*).

## Resumo diário automático
O bot empurra o briefing do dia para os chats da allowlist, 1x/dia.
- `DAILY_REPORT_TIME` (default `08:00`) e `DAILY_REPORT_TZ` (default `America/Sao_Paulo`).
- `DAILY_REPORT_ENABLED=0` desliga o agendamento.
- `DAILY_REPORT_NOW=1` (só na subida) envia um resumo **agora**, para testar.
- Agendador é **in-process**: só dispara enquanto o bot está rodando. Para 24/7 de verdade,
  containerizar (ou usar cron do sistema chamando um one-shot). Sem allowlist não há destino.

## Segurança
- **Allowlist**: com `TELEGRAM_ALLOWED_CHAT_IDS` preenchido, o bot ignora quem não estiver na lista.
  Sem allowlist ele responde a qualquer um (só leitura, mas exponha com cuidado).
- A IA só tem as **tools read-only** do MCP (papel `ia_servico`). Nada de escrita/ações.
