#!/usr/bin/env bash
# Sobe a stack completa em containers (db/redis/minio + api/web/telegram), ISOLADA.
# Injeta os segredos PRÓPRIOS do root (~/.config/root/*.env) + apps/api/.env no
# ambiente para o compose interpolar — NADA de segredo fica no repo.
#
# Uso:  deploy/up.sh            (build + up -d de tudo)
#       deploy/up.sh --build    (força rebuild da imagem)
#       deploy/up.sh --vps      (na VPS: soma o docker-compose.vps.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

# Na VPS as portas ficam bindadas em 172.17.0.1 (só o Traefik alcança) — isso mora
# no docker-compose.vps.yml, que NÃO é override automático de propósito: se fosse,
# o Mac o carregaria sozinho e o painel sumiria do localhost. Sem --vps o compose
# base publica em 0.0.0.0; no servidor isso exporia banco, redis e minio.
COMPOSE_FILES=(-f docker-compose.yml)
NA_VPS=0
if [ "${1:-}" = "--vps" ]; then
  shift
  NA_VPS=1
  COMPOSE_FILES+=(-f docker-compose.vps.yml)
fi

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
# Só em dev. Na VPS os segredos vivem no .env (montado pelo merge-env.sh) e o
# compose o lê sozinho — injetar ~/.config/root/*.env lá seria ativamente
# perigoso, porque variável de ambiente VENCE o .env: o bio-secrets.env do
# servidor guarda a ENCRYPTION_KEY antiga do root-bio (tokens já cifrados
# parariam de abrir) e o default do vault aponta para um caminho que não existe
# no servidor (o bind mount falha e a API não sobe).
if [ "$NA_VPS" -eq 0 ]; then
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

  # avisos úteis (não bloqueiam) — `|| true` porque são o último comando do bloco
  # e o set -e mataria o script justamente quando a variável ESTÁ preenchida.
  [ -z "${OPENAI_API_KEY:-}" ]     && echo "[up] aviso: OPENAI_API_KEY vazio (IA/resumo não vão funcionar)." || true
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && echo "[up] aviso: TELEGRAM_BOT_TOKEN vazio (bot não sobe)." || true
fi

echo "[up] subindo containers (build + up -d)…"
docker compose "${COMPOSE_FILES[@]}" up -d --build "$@"
echo "[up] pronto. Ver: docker compose ps · logs: docker compose logs -f telegram"
