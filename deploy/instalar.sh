#!/usr/bin/env bash
# ============================================================================
# deploy/instalar.sh — uma instância do ROOT OS nasce numa VPS limpa, sem o Pedro.
# ============================================================================
#
#   deploy/instalar.sh --ambiente producao   --tag v0.3.0 --dominio os.cliente.com.br \
#                      --admin-email dono@cliente.com.br [--bind-ip 172.16.0.1] [--cliente acme]
#   deploy/instalar.sh --ambiente homologacao --tag v0.3.0 --dominio homolog.cliente.com.br ...
#
#   MÁQUINA LOCAL (o Mac do cliente, com Colima): --bind-ip 127.0.0.1. Aí --dominio é
#   opcional (sem ele os endereços são http://localhost:<porta do web>), --painel é
#   recusado (easyPanel é da VPS) e a base padrão é ~/root-os — no macOS a raiz do
#   disco é só leitura, e o Colima só enxerga o que mora dentro do $HOME.
#
# O que faz, nesta ordem, e para no primeiro erro:
#   1. confere docker, git, o diretório-base e que a instância ainda NÃO existe
#      (instalar é criar; atualizar é deploy/atualizar.sh)
#   2. escolhe nomes e portas do ambiente e RECUSA se colidirem com uma irmã
#   3. `git clone --branch <tag>` — a versão é explícita e fica registrada
#   4. gera os segredos (openssl rand) direto no .env, 0600; nada em stdout
#   5. o que ninguém gera é pedido/validado: domínio, e-mail do admin, chave de LLM
#   6. escreve o override de isolamento (nomes, rede, imagem:tag, portas em bind-ip)
#   7. build da imagem com tag explícita
#   8. sobe o banco; `migrate deploy`; `db:seed` (preservação exata); `db:seed:politica`;
#      opcionalmente provisiona a empresa do cliente
#   9. sobe tudo; espera a saúde; confere a versão no ar (se a imagem expuser)
#  10. imprime o que falta fazer À MÃO: a rota do Traefik/easyPanel e apagar segredos-iniciais.txt
#
# Segredos NUNCA passam pela linha de comando (apareceriam no `ps`): `docker compose
# run -e VAR` sem valor lê do ambiente do próprio script.
set -euo pipefail
NOME_DO_SCRIPT="instalar"
# shellcheck source=deploy/lib-instancia.sh
. "$(dirname "$0")/lib-instancia.sh"

uso() {
  cat >&2 <<MSG
uso: deploy/instalar.sh --ambiente producao|homologacao --tag <tag> --dominio <host>
        [--cliente <slug> --admin-email <email>]   (a empresa do cliente; o admin entra pelo Google, sem senha)
        [--base /srv/root-os] [--repo <url|caminho>] [--bind-ip 172.17.0.1] [--sem-llm] [--so-checar]
        [--bind-ip 127.0.0.1]   (máquina local: --dominio opcional, endereço http://localhost:<web>, base ~/root-os)
        [--painel <projeto>/<servico>]   (easyPanel: nasce com o projeto Compose do painel e gera o compose para colar lá)
Segredos que não se geram vêm do AMBIENTE, nunca de argumento:
        ROOTOS_ANTHROPIC_API_KEY / ROOTOS_OPENAI_API_KEY   (uma das duas, ou --sem-llm)
        ROOTOS_GOOGLE_CLIENT_ID + ROOTOS_GOOGLE_CLIENT_SECRET   (OBRIGATÓRIAS com --cliente: o admin entra pelo Google)
MSG
  exit 64
}

AMBIENTE=""; TAG=""; DOMINIO=""; ADMIN_EMAIL=""; BASE="${ROOTOS_BASE:-}"
REPO="${ROOTOS_REPO:-https://github.com/operacaoroot/marketing-os.git}"
BIND_IP="${ROOTOS_BIND_IP:-172.17.0.1}"; CLIENTE=""; SEM_LLM=0; SO_CHECAR=0; PAINEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente)    AMBIENTE="${2:-}"; shift 2 ;;
    --tag)         TAG="${2:-}"; shift 2 ;;
    --dominio)     DOMINIO="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --base)        BASE="${2:-}"; shift 2 ;;
    --repo)        REPO="${2:-}"; shift 2 ;;
    --bind-ip)     BIND_IP="${2:-}"; shift 2 ;;
    --cliente)     CLIENTE="${2:-}"; shift 2 ;;
    --sem-llm)     SEM_LLM=1; shift ;;
    --so-checar)   SO_CHECAR=1; shift ;;
    --painel)      PAINEL="${2:-}"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; uso ;;
  esac
done

# ---------------------------------------------------------------- validação
[ -n "$AMBIENTE" ] && ambiente_valido "$AMBIENTE" || { echo "--ambiente precisa ser producao ou homologacao" >&2; uso; }
[ -n "$TAG" ] || { echo "--tag é obrigatória: a versão instalada tem de ser explícita" >&2; uso; }
case "$TAG" in *[!A-Za-z0-9._-]*|'') falha "tag inválida: '$TAG'" 64 ;; esac
case "$BIND_IP" in *[!0-9.]*|'') falha "bind-ip inválido: '$BIND_IP' (o IP interno do docker0 desta VPS; confira com: ip -4 addr show docker0)" 64 ;; esac
# MÁQUINA LOCAL: porta só no loopback. Ninguém de fora alcança, então não há rota,
# domínio nem painel — o endereço é o da própria máquina.
MODO_LOCAL=0
case "$BIND_IP" in 127.*) MODO_LOCAL=1 ;; esac
if [ "$MODO_LOCAL" = 0 ]; then
  [ -n "$DOMINIO" ] || { echo "--dominio é obrigatório (é o WEB_ORIGIN e a rota do Traefik)" >&2; uso; }
fi
if [ -n "$DOMINIO" ]; then
  case "$DOMINIO" in *://*|*/*|*[[:space:]]*) falha "domínio inválido: '$DOMINIO' — só o host, sem esquema nem caminho" 64 ;; esac
fi
[ -n "$BASE" ] || { if [ "$MODO_LOCAL" = 1 ]; then BASE="$HOME/root-os"; else BASE="/srv/root-os"; fi; }
# `--admin-email` é o administrador da EMPRESA DO CLIENTE (provisionar-tenant) e entra
# pelo login com Google, sem senha. A conta com senha que o seed cria é fixa:
# admin@marketing-os.local. Não confundir as duas — foi um achado de revisão.
if [ -n "$CLIENTE" ] || [ -n "$ADMIN_EMAIL" ]; then
  [ -n "$CLIENTE" ] && [ -n "$ADMIN_EMAIL" ] || falha "--cliente e --admin-email andam juntos" 64
  # Validação CONSERVADORA: estes valores viram argv dentro do container.
  [[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || falha "e-mail inválido: '$ADMIN_EMAIL'" 64
  [[ "$CLIENTE" =~ ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$ ]] || falha "slug de cliente inválido: '$CLIENTE' (a-z, 0-9 e hífen; sem começar/terminar com hífen)" 64
fi
if [ -n "$PAINEL" ]; then
  [ "$MODO_LOCAL" = 0 ] || falha "--painel é do easyPanel da VPS; com --bind-ip $BIND_IP a instância é local e não tem painel" 64
  painel_valido "$PAINEL" || falha "--painel inválido: '$PAINEL' — formato <projeto>/<servico>, minúsculas, dígitos e hífen (o nome vira o projeto Compose <projeto>_<servico>)" 64
fi

# Chaves de LLM: só do ambiente. Vazias = LLM desligado, e isso é dito.
ANTHROPIC_KEY="${ROOTOS_ANTHROPIC_API_KEY:-}"; OPENAI_KEY="${ROOTOS_OPENAI_API_KEY:-}"
LLM_PROVIDER_ESCOLHIDO="$([ -n "$ANTHROPIC_KEY" ] && echo anthropic || { [ -n "$OPENAI_KEY" ] && echo openai || true; })"
# Login com Google: só do ambiente. Sem ele o admin do cliente NÃO consegue entrar —
# e uma instalação em que o dono não entra não está instalada.
GOOGLE_ID="${ROOTOS_GOOGLE_CLIENT_ID:-}"; GOOGLE_SECRET="${ROOTOS_GOOGLE_CLIENT_SECRET:-}"
if [ -n "$CLIENTE" ]; then
  [ -n "$GOOGLE_ID" ] && [ -n "$GOOGLE_SECRET" ] || falha "--cliente cria um admin que entra pelo Google: ROOTOS_GOOGLE_CLIENT_ID e ROOTOS_GOOGLE_CLIENT_SECRET precisam estar no ambiente (nunca em argumento)." 64
  case "$GOOGLE_ID$GOOGLE_SECRET" in *[[:space:]]*|*\'*|*\"*) falha "credencial do Google com caractere inválido" 64 ;; esac
fi
if [ "$SEM_LLM" = 0 ] && [ -z "$ANTHROPIC_KEY" ] && [ -z "$OPENAI_KEY" ]; then
  falha "nenhuma chave de LLM no ambiente (ROOTOS_ANTHROPIC_API_KEY / ROOTOS_OPENAI_API_KEY). Para instalar sem modelo de propósito, passe --sem-llm." 64
fi

# Nomes e portas por ambiente — os defaults são distintos entre os dois.
case "$AMBIENTE" in
  producao)    PROJ="rootos-producao";    PREFIXO="rootos_prod";    REDE="rootos-producao-net";    WEB=4000; API=4001; DBP=5442; RED=6390; MIN=9010; MINC=9011 ;;
  homologacao) PROJ="rootos-homologacao"; PREFIXO="rootos_homolog"; REDE="rootos-homologacao-net"; WEB=4100; API=4101; DBP=5443; RED=6391; MIN=9012; MINC=9013 ;;
esac
# No easyPanel o projeto Compose é <projeto>_<serviço>, e é dele que saem os nomes dos
# volumes: para o painel adotar a instância depois, o nome tem de ser este desde o primeiro up.
[ -z "$PAINEL" ] || PROJ="$(projeto_do_painel "$PAINEL")"
# O endereço público: o domínio na VPS; na máquina local sem domínio, o próprio web.
if [ -n "$DOMINIO" ]; then URL_PUBLICA="https://$DOMINIO"; else URL_PUBLICA="http://localhost:$WEB"; fi
# A imagem só ganha nome depois do clone: a tag é IMUTÁVEL por versão+commit.
IMAGEM=""

DIR_INSTANCIA="$BASE/$AMBIENTE"; DIR_REPO="$DIR_INSTANCIA/repo"

passo "1/10 pré-condições"
command -v "$DOCKER" >/dev/null 2>&1 || falha "docker não encontrado no PATH"
command -v "$GIT" >/dev/null 2>&1 || falha "git não encontrado no PATH"
command -v openssl >/dev/null 2>&1 || falha "openssl não encontrado no PATH"
"$DOCKER" compose version >/dev/null 2>&1 || falha "docker compose (v2) não responde"
[ ! -e "$DIR_INSTANCIA" ] || falha "$DIR_INSTANCIA já existe. Instalar é criar; para trocar de versão use deploy/atualizar.sh --ambiente $AMBIENTE --tag <tag>."

umask 077
if [ "$SO_CHECAR" = 1 ]; then
  # SÓ CHECANDO: nada persistente é criado — nem a base, nem a instância, nem segredo.
  # O .env candidato vai para um temporário FORA da base, só para a conferência de
  # conflito com as irmãs, e é apagado ao sair.
  [ -d "$BASE" ] && [ ! -w "$BASE" ] && falha "$BASE existe e não é gravável"
  ENV="$(mktemp -t rootos-so-checar.XXXXXX)"; trap 'rm -f "$ENV"' EXIT
else
  mkdir -p "$BASE" || falha "não consigo criar $BASE"
  # .env ANTES de clonar: se a validação de nomes recusar, nada foi baixado.
  mkdir -p "$DIR_INSTANCIA" "$DIR_INSTANCIA/backups"
  ENV="$DIR_INSTANCIA/.env"
fi

passo "2/10 nomes e portas do ambiente (isolamento entre irmãs)"
gerar() { openssl rand -hex "$1"; }
{
  echo "# ROOT OS — instância '$AMBIENTE' — gerado por deploy/instalar.sh em $(date +%Y-%m-%d)"
  echo "# 0600. Este arquivo é a verdade desta instância; o compose lê daqui. Nunca versionar."
  echo "ROOTOS_AMBIENTE=$AMBIENTE"
  echo "ROOTOS_PROJECT=$PROJ"
  echo "ROOTOS_PAINEL=$PAINEL"
  echo "ROOTOS_CONTAINER_PREFIX=$PREFIXO"
  echo "ROOTOS_NETWORK_NAME=$REDE"
  echo "ROOTOS_IMAGE="
  echo "ROOTOS_BIND_IP=$BIND_IP"
  echo "ROOTOS_VERSION=$TAG"
  echo "ROOTOS_COMMIT="
  echo "WEB_HOST_PORT=$WEB"
  echo "API_HOST_PORT=$API"
  echo "DB_PORT=$DBP"
  echo "REDIS_PORT=$RED"
  echo "MINIO_PORT=$MIN"
  echo "MINIO_CONSOLE_PORT=$MINC"
  echo "# --- banco (dona das tabelas; o papel restrito é operação posterior: deploy/papel-app.sh) ---"
  echo "DB_USER=rootos"
  echo "DB_PASSWORD=$(gerar 24)"
  echo "DB_NAME=rootos_${AMBIENTE}"
  echo "DB_APP_USER="
  echo "DB_APP_PASSWORD="
  echo "# --- segredos gerados ---"
  echo "JWT_SECRET=$(gerar 32)"
  echo "AUTH_SECRET=$(gerar 32)"
  echo "ENCRYPTION_KEY=$(gerar 32)"
  echo "COFRE_CHAVES="
  echo "COFRE_CHAVE_ATUAL="
  echo "S3_ACCESS_KEY=rootos"
  echo "S3_SECRET_KEY=$(gerar 24)"
  echo "CANAL_APROVACAO_SEGREDO="
  echo "CANAL_APROVACAO_CODIGO_SEGREDO="
  echo "CANAL_APROVACAO_CAPACIDADES="
  echo "# --- endereços ---"
  echo "WEB_ORIGIN=$URL_PUBLICA"
  echo "PUBLIC_BASE_URL=$URL_PUBLICA"
  echo "PUBLIC_BIO_ORIGIN=$URL_PUBLICA"
  echo "# --- login com Google (o admin do cliente entra por aqui; o callback serve ao login e ao conector) ---"
  echo "GOOGLE_CLIENT_ID=$GOOGLE_ID"
  echo "GOOGLE_CLIENT_SECRET=$GOOGLE_SECRET"
  echo "GOOGLE_REDIRECT_URI=$URL_PUBLICA/api/google/callback"
  echo "GOOGLE_LOGIN_ALLOWED_EMAILS=$ADMIN_EMAIL"
  echo "# --- modelo (o provedor segue a chave que veio; sem chave, o LLM fica desligado e a instância diz isso) ---"
  if [ -n "$ANTHROPIC_KEY" ]; then echo "LLM_PROVIDER=anthropic"; elif [ -n "$OPENAI_KEY" ]; then echo "LLM_PROVIDER=openai"; else echo "LLM_PROVIDER="; fi
  echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY"
  echo "OPENAI_API_KEY=$OPENAI_KEY"
  echo "# --- a porta e o relógio (calibragem começa observando) ---"
  echo "GATEWAY_MODO=observar"
  echo "TENANT_MODO=observar"
  if [ "$AMBIENTE" = homologacao ]; then
    # HOMOLOGAÇÃO NASCE SEM RELÓGIO NEM SINCRONIZAÇÃO: nada de rotina disparando,
    # reindexação ou integração externa ativa num ambiente de ensaio.
    echo "ROTINAS_CRON=off"
    echo "BIO_SYNC_INTERVAL_MIN=0"
    echo "BIO_BRIDGE_INTERVAL_MIN=0"
    echo "CLICKUP_SYNC_INTERVAL_MIN=0"
    echo "ASAAS_SYNC_INTERVAL_MIN=0"
    echo "PLUGGY_SYNC_INTERVAL_MIN=0"
  else
    echo "ROTINAS_CRON=on"
  fi
  echo "OBSIDIAN_REINDEX_MIN=0"
  echo "OBSIDIAN_VAULT_HOST=$DIR_INSTANCIA/vault"
  echo "RASTRO_RETENCAO_DIAS=1825"
  echo "BACKUP_DIR=$DIR_INSTANCIA/backups"
} > "$ENV"
chmod 600 "$ENV"
[ "$SO_CHECAR" = 1 ] || mkdir -p "$DIR_INSTANCIA/vault"
conferir_portas_internas "$ENV"
[ -d "$BASE" ] && conferir_distinto_das_irmas "$BASE" "$AMBIENTE" "$ENV"

if [ "$SO_CHECAR" = 1 ]; then
  echo "[instalar] só checando — nada foi criado (nem diretório, nem segredo, nem clone)."
  echo "  instância: $DIR_INSTANCIA · projeto $PROJ · prefixo $PREFIXO · rede $REDE · imagem rootos-app:$TAG-<commit>"
  echo "  portas em $BIND_IP: web $WEB · api $API · db $DBP · redis $RED · minio $MIN/$MINC"
  echo "  endereço: $URL_PUBLICA$([ "$MODO_LOCAL" = 1 ] && echo " (máquina local: só esta máquina alcança)" || true)"
  echo "  LLM: ${LLM_PROVIDER_ESCOLHIDO:-desligado} · cliente: ${CLIENTE:-nenhum} · relógio: $([ "$AMBIENTE" = homologacao ] && echo desligado || echo ligado)"
  [ -z "$PAINEL" ] || echo "  easyPanel: serviço '$PAINEL' → projeto Compose $PROJ; geraria $DIR_INSTANCIA/painel/docker-compose.yml (sem build:, imagem por variável)"
  exit 0
fi

# A senha inicial do admin é o único segredo que precisa chegar a uma pessoa.
SENHA_ADMIN="$(gerar 18)"; SENHA_MCP="$(gerar 18)"
{
  echo "ROOT OS — instância '$AMBIENTE' — segredos iniciais (gerados em $(date +%Y-%m-%d))"
  echo "APAGUE ESTE ARQUIVO depois de guardar no gerenciador de senhas."
  echo "conta com senha criada pelo seed: admin@marketing-os.local"
  echo "ADMIN_PASSWORD=$SENHA_ADMIN"
  echo "conta de serviço só-leitura (MCP): mcp@marketing-os.local"
  echo "MCP_SERVICE_PASSWORD=$SENHA_MCP"
  if [ -n "$ADMIN_EMAIL" ]; then echo "admin da empresa '$CLIENTE': $ADMIN_EMAIL — entra pelo login com Google, NÃO tem senha aqui"; fi
} > "$DIR_INSTANCIA/segredos-iniciais.txt"
chmod 600 "$DIR_INSTANCIA/segredos-iniciais.txt"

passo "3/10 código na tag $TAG"
"$GIT" -c advice.detachedHead=false clone --quiet --branch "$TAG" --depth 1 "$REPO" "$DIR_REPO" 2> >(grep -v "depth is ignored in local clones" >&2 || true) || falha "clone da tag '$TAG' de $REPO falhou (a tag existe? a deploy key tem leitura?)"
COMMIT="$("$GIT" -C "$DIR_REPO" rev-parse HEAD)"
IMAGEM="rootos-app:${TAG}-${COMMIT:0:12}"
gravar_chave_no_env "$ENV" ROOTOS_COMMIT "$COMMIT"
gravar_chave_no_env "$ENV" ROOTOS_IMAGE "$IMAGEM"
[ -f "$DIR_REPO/docker-compose.yml" ] || falha "a tag $TAG não tem docker-compose.yml na raiz"
conferir_variaveis_do_compose "$DIR_REPO/docker-compose.yml" "$ENV"

passo "4/10 override de isolamento"
escrever_override "$DIR_INSTANCIA/override.yml" "$PREFIXO" "$REDE" "$IMAGEM" "$BIND_IP" "$WEB" "$API" "$DBP" "$RED" "$MIN" "$MINC" \
  "${PAINEL:+instancia}" "${PAINEL:+${PROJ}_web}"
carregar_env_da_instancia "$ENV"
export ROOTOS_VERSION="$TAG" ROOTOS_COMMIT="$COMMIT"

passo "5/10 imagem $IMAGEM"
compose build api
"$DOCKER" image inspect "$IMAGEM" >/dev/null 2>&1 || falha "o build não produziu a imagem $IMAGEM (o override aponta image: para ela; confira o compose da tag)"

passo "6/10 banco"
compose up -d db redis minio
DB_CONT="${PREFIXO}_db"
for _ in $(seq 1 60); do
  if "$DOCKER" exec "$DB_CONT" pg_isready -U "$DB_USER" >/dev/null 2>&1; then break; fi
  sleep "${ESPERA_ENTRE_TENTATIVAS:-2}"
done
"$DOCKER" exec "$DB_CONT" pg_isready -U "$DB_USER" >/dev/null 2>&1 || falha "o banco $DB_CONT não ficou pronto"

passo "7/10 migrations (deploy) + empresa + política"
compose run --rm --no-deps api sh -c 'pnpm exec prisma migrate deploy'
ADMIN_PASSWORD="$SENHA_ADMIN" MCP_SERVICE_PASSWORD="$SENHA_MCP" \
  compose run --rm --no-deps -e ADMIN_PASSWORD -e MCP_SERVICE_PASSWORD api sh -c 'pnpm db:seed'
compose run --rm --no-deps api sh -c 'pnpm db:seed:politica'
if [ -n "$CLIENTE" ]; then
  # argv direto — nunca `sh -c` com interpolação: os dois valores já foram validados,
  # mas validação não é motivo para abrir um shell dentro do container.
  compose run --rm --no-deps api node dist/scripts/provisionar-tenant.js "$CLIENTE" --modulos todos --admin "$ADMIN_EMAIL"
fi

passo "8/10 subir"
compose up -d --no-build
registrar_versao "$TAG" "$COMMIT" "instalado"

passo "9/10 saúde"
URL_SAUDE="http://$BIND_IP:$API/api/health"
esperar_saude "$URL_SAUDE" 60 || falha "a API não respondeu em $URL_SAUDE. Veja: $DOCKER compose -p $PROJ logs api"
NO_AR="$(versao_no_ar "http://$BIND_IP:$API/api/health/versao")"
COMMIT_NO_AR="$(commit_no_ar "http://$BIND_IP:$API/api/health/versao")"
[ -n "$NO_AR" ] && [ -n "$COMMIT_NO_AR" ] \
  || falha "a API não expôs version+commit em /api/health/versao; não dá para provar qual artefato está no ar"
[ "$NO_AR" = "$TAG" ] || falha "a API no ar diz versão '$NO_AR', esperava '$TAG'"
[ "$COMMIT_NO_AR" = "$COMMIT" ] || falha "a API no ar diz commit '$COMMIT_NO_AR', esperava '$COMMIT'"

passo "10/10 pronto — o que fica À MÃO"
if [ -n "$PAINEL" ]; then
  carregar_env_da_instancia "$ENV"
  gerar_compose_do_painel "$DIR_INSTANCIA/painel/docker-compose.yml"
fi
cat <<MSG

  Instância '$AMBIENTE' no ar em $DIR_INSTANCIA (tag $TAG, commit ${COMMIT:0:12}).
  Provado por este script: saúde ok, artefato $TAG@${COMMIT:0:12} no ar, migrations aplicadas, política semeada.
  NÃO provado por este script: login humano (ninguém entrou), modelo respondendo$([ -z "$ANTHROPIC_KEY$OPENAI_KEY" ] && echo " (LLM desligado)" || true)$([ "$MODO_LOCAL" = 1 ] && echo ", a tela abrindo no navegador" || echo ", rota do Traefik").

$(if [ "$MODO_LOCAL" = 1 ]; then echo "  1. ENDEREÇO (máquina local, sem rota a configurar): $URL_PUBLICA — porta só em $BIND_IP"; else echo "  1. ROTA NO TRAEFIK/easyPanel (manual): $DOMINIO → $BIND_IP:$WEB"; fi)
$(if [ -n "$PAINEL" ]; then echo "  1b. ADOTAR NO PAINEL:"; lembrete_do_painel instalar; fi)
  2. SEGREDOS INICIAIS (0600): $DIR_INSTANCIA/segredos-iniciais.txt — guarde e APAGUE.
     (a senha é de admin@marketing-os.local; o admin do cliente entra pelo Google)
$(if [ -n "$CLIENTE" ]; then echo "  2b. No console do Google, a URI de redirect autorizada tem de ser: $URL_PUBLICA/api/google/callback"; else echo "  2b. Para login com Google mais tarde: ROOTOS_GOOGLE_CLIENT_ID/SECRET no ambiente e GOOGLE_* no .env, depois up -d --no-build api"; fi)
  3. BACKUP diário ($([ "$MODO_LOCAL" = 1 ] && echo "crontab -e do usuário desta máquina" || echo "crontab do root")):
     BACKUP_DB_CONTAINER=$DB_CONT PGUSER=$DB_USER PGDATABASE=$DB_NAME BACKUP_DIR=$DIR_INSTANCIA/backups \\
       $DIR_REPO/deploy/backup-db.sh
  4. Atualizar: deploy/atualizar.sh --ambiente $AMBIENTE --tag <tag-nova>
  5. Papel restrito do banco (quando decidir): $DIR_REPO/deploy/papel-app.sh

MSG
