#!/usr/bin/env bash
# Sobe a stack completa em containers (db/redis/minio + api/web/telegram), ISOLADA.
# Injeta os segredos PRÓPRIOS do root (~/.config/root/*.env) + apps/api/.env no
# ambiente para o compose interpolar — NADA de segredo fica no repo.
#
# Uso:  deploy/up.sh            (build + up -d de tudo)
#       deploy/up.sh --build    (força rebuild da imagem)
set -euo pipefail
cd "$(dirname "$0")/.."

# carrega credenciais no ambiente (KEY=VALUE) de forma SEGURA — sem executar o
# conteúdo (valores com espaço, ex.: APP_NAME=Marketing OS, quebrariam `source`).
load_env() {
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    [ "${line#*=}" = "$line" ] && continue   # sem '='
    key=${line%%=*}; val=${line#*=}
    val="${val%% #*}"                        # tira comentário inline " #..." (estilo dotenv)
    export "$key=$val"
  done < "$1"
}
load_env "$HOME/.config/root/openai.env"
load_env "$HOME/.config/root/telegram.env"
load_env "$HOME/.config/root/clickup.env"
load_env "$HOME/.config/root/google.env"
load_env "$HOME/.config/root/pluggy.env"   # bancos (Open Finance / Pluggy)
load_env "$HOME/.config/root/asaas.env"    # Asaas (cobranças + conta digital)
load_env "$HOME/.config/root/meta.env"     # Meta/Instagram (métricas)
load_env "$HOME/.config/root/bio-apps.env"    # Instagram/TikTok do Link na bio
load_env "$HOME/.config/root/bio-secrets.env" # ENCRYPTION_KEY (herdada do root-bio)
load_env apps/api/.env   # JWT_SECRET/AUTH_SECRET

# vault Obsidian a montar no container (base de conhecimento)
export OBSIDIAN_VAULT_HOST="${OBSIDIAN_VAULT_HOST:-$HOME/Documents/Obsidian Vault}"

# avisos úteis (não bloqueiam)
[ -z "${OPENAI_API_KEY:-}" ]     && echo "[up] aviso: OPENAI_API_KEY vazio (IA/resumo não vão funcionar)."
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] && echo "[up] aviso: TELEGRAM_BOT_TOKEN vazio (bot não sobe)."

echo "[up] subindo containers (build + up -d)…"
docker compose up -d --build "$@"
echo "[up] pronto. Ver: docker compose ps · logs: docker compose logs -f telegram"
