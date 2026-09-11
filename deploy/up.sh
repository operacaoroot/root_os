#!/usr/bin/env bash
# Sobe a stack completa em containers (db/redis/minio + api/web), ISOLADA.
# Injeta os segredos PRÓPRIOS do root (~/.config/root/*.env) + apps/api/.env no
# ambiente para o compose interpolar — NADA de segredo fica no repo.
#
# Uso:  deploy/up.sh                      (build + up -d de tudo)
#       deploy/up.sh --build              (força rebuild da imagem — é o padrão)
#       deploy/up.sh --no-build           (NÃO constrói: sobe a imagem que já está no host)
#       deploy/up.sh --vps                (na VPS: soma o docker-compose.vps.yml)
#       deploy/up.sh --vps --no-build api web
#
# As flags vêm ANTES dos nomes de serviço, em qualquer ordem entre si. O que
# sobrar é repassado ao compose como lista de serviços — e uma flag desconhecida
# ali é erro, não descuido silencioso: era assim que um `--vps` fora de lugar
# viraria "nome de serviço" e publicaria o banco em 0.0.0.0.
#
# --no-build existe por causa do procedimento do docs/DEPLOY.md: constrói-se a
# imagem, roda-se o smoke NELA, e sobe-se EXATAMENTE a imagem que passou. Com
# build forçado no `up`, a imagem que sobe é outra construção — não a testada.
set -euo pipefail
cd "$(dirname "$0")/.."

# Na VPS as portas ficam bindadas em 172.17.0.1 (só o Traefik alcança) — isso mora
# no docker-compose.vps.yml, que NÃO é override automático de propósito: se fosse,
# o Mac o carregaria sozinho e o painel sumiria do localhost. Sem --vps o compose
# base publica em 0.0.0.0; no servidor isso exporia banco, redis e minio.
COMPOSE_FILES=(-f docker-compose.yml)
NA_VPS=0
CONSTRUIR=1
while [ $# -gt 0 ]; do
  case "$1" in
    # `--vps` repetido não empilha o override duas vezes: o compose tolera, mas
    # a lista de arquivos é o que se lê para conferir o que subiu.
    --vps)      if [ "$NA_VPS" -eq 0 ]; then COMPOSE_FILES+=(-f docker-compose.vps.yml); fi; NA_VPS=1; shift ;;
    --build)    CONSTRUIR=1; shift ;;
    --no-build) CONSTRUIR=0; shift ;;
    *) break ;;
  esac
done

# Nada de flag no meio dos nomes de serviço: `--vps` que chega aqui não foi lido
# acima, e subir sem ele na VPS expõe banco/redis/minio na internet.
for arg in "$@"; do
  case "$arg" in
    -*) echo "[up] erro: '$arg' não é serviço nem flag conhecida. As flags (--vps, --build, --no-build) vêm antes dos nomes de serviço." >&2; exit 2 ;;
  esac
done

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
  # Continua valendo mesmo sem o bot: o serviço `telegram` saiu do compose na
  # fatia 5.8, mas TELEGRAM_BOT_TOKEN vai para o bloco `environment:` da API,
  # que o lê para a tela de Conexões dizer se o Telegram está configurado.
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
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && echo "[up] aviso: TELEGRAM_BOT_TOKEN vazio (Telegram aparece como não configurado em Conexões)." || true
fi

if [ "$CONSTRUIR" -eq 1 ]; then
  echo "[up] subindo containers (build + up -d)…"
  docker compose "${COMPOSE_FILES[@]}" up -d --build "$@"
else
  echo "[up] subindo containers SEM construir (usa a imagem que já está no host)…"
  docker compose "${COMPOSE_FILES[@]}" up -d --no-build "$@"
fi
echo "[up] pronto. Ver: docker compose ps · logs: docker compose logs -f api"
