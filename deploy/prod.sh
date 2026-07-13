#!/usr/bin/env bash
# Sobe o Marketing OS em PRODUÇÃO (servidor Linux, 24/7, HTTPS via Caddy).
# Injeta os segredos de ~/.config/root/*.env + ~/.config/root/prod.env e sobe a stack.
# Ver DEPLOY.md para o passo a passo completo (Hetzner + sslip.io).
set -euo pipefail
cd "$(dirname "$0")/.."

# parser seguro KEY=VALUE (não executa o conteúdo; tira comentário inline " #...")
load_env() {
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    [ "${line#*=}" = "$line" ] && continue
    key=${line%%=*}; val=${line#*=}; val="${val%% #*}"
    export "$key=$val"
  done < "$1"
}
for f in openai telegram clickup google pluggy asaas meta; do load_env "$HOME/.config/root/$f.env"; done
load_env "$HOME/.config/root/prod.env"   # PANEL_HOST + JWT/DB/ADMIN etc. (obrigatório em prod)

: "${PANEL_HOST:?defina PANEL_HOST em ~/.config/root/prod.env (ex.: 1-2-3-4.sslip.io)}"
export OBSIDIAN_VAULT_HOST="${OBSIDIAN_VAULT_HOST:-$HOME/marketing-os-vault}"
mkdir -p "$OBSIDIAN_VAULT_HOST"          # vault vazia se não houver sync (0 notas, ok)

echo "[prod] PANEL_HOST=$PANEL_HOST · subindo (build + up -d)…"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build "$@"
echo "[prod] pronto. Acesse: https://$PANEL_HOST"
echo "[prod] 1ª vez? rode o seed:  docker compose exec api sh -c 'cd /app/apps/api && pnpm db:seed'"
