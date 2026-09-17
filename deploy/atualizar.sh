#!/usr/bin/env bash
# ============================================================================
# deploy/atualizar.sh — troca a versão de uma instância sem sobrescrever o que é dela.
# ============================================================================
#
#   deploy/atualizar.sh --ambiente producao --tag v0.4.0
#   deploy/atualizar.sh --ambiente producao --so-checar --tag v0.4.0
#   deploy/atualizar.sh --ambiente producao --voltar            # para a versão anterior registrada
#
# A ORDEM, e o que cada passo protege:
#   1. compatibilidade ANTES de tocar em qualquer coisa: a tag existe; toda migration
#      já aplicada no banco existe na tag nova (senão é downgrade/divergência); todo
#      `${VAR}` sem default do compose novo está no .env
#   2. BACKUP do banco (deploy/backup-db.sh) — o dump é o único caminho de volta do dado
#   3. checkout DESTACADO na tag; `ferramentas/` (ADR-014) é conferida por checksum
#      antes e depois — se mudou, desfaz e para
#   4. build da imagem com tag IMUTÁVEL (versão+commit) usando um override TEMPORÁRIO —
#      o .env e o override da instância continuam intocados; a imagem anterior fica no host
#   5. ENSAIO: cópia do banco (pg_dump|psql) num banco `rootos_ensaio_*`, `migrate deploy`
#      e smoke NELA com a imagem nova; qualquer falha para aqui, com o runtime intocado
#   6. `migrate deploy` no banco REAL (ponto sem volta do schema — o dump do passo 2 é a volta)
#      e `db:seed:politica` ANTES do up (recusa de assinatura para aqui)
#   7. O CORTE, transacional: backup do .env e do override, trap armado, então as 3 chaves
#      de versão no .env + override novo + `up -d --no-build api web` + saúde + versão no ar.
#      Qualquer falha ou sinal antes da saúde restaura os dois arquivos e re-sobe a imagem
#      anterior. O trap só desarma depois da saúde confirmada.
#   8. saúde falhou → o trap voltou o runtime e o script diz por extenso: o BANCO ficou com
#      as migrations novas; para o dado anterior, restaure o dump indicado. Isto é
#      recuperação de runtime — não é rollback de schema.
#
# O que este script NUNCA faz: tocar no vault, nos backups, em `ferramentas/`, ou em
# qualquer chave do .env além das três marcas de versão — e nem nessas antes do corte.
set -euo pipefail
NOME_DO_SCRIPT="atualizar"
# shellcheck source=deploy/lib-instancia.sh
. "$(dirname "$0")/lib-instancia.sh"

uso() {
  cat >&2 <<MSG
uso: deploy/atualizar.sh --ambiente producao|homologacao (--tag <tag> | --voltar [tag]) [--base /srv/root-os] [--so-checar]
MSG
  exit 64
}

AMBIENTE=""; TAG=""; VOLTAR=0; VOLTAR_PARA=""; BASE="${ROOTOS_BASE:-/srv/root-os}"; SO_CHECAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente) AMBIENTE="${2:-}"; shift 2 ;;
    --tag)      TAG="${2:-}"; shift 2 ;;
    --voltar)   VOLTAR=1; shift; if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then VOLTAR_PARA="$1"; shift; fi ;;
    --base)     BASE="${2:-}"; shift 2 ;;
    --so-checar) SO_CHECAR=1; shift ;;
    *) echo "argumento desconhecido: $1" >&2; uso ;;
  esac
done
[ -n "$AMBIENTE" ] && ambiente_valido "$AMBIENTE" || { echo "--ambiente precisa ser producao ou homologacao" >&2; uso; }
if [ "$VOLTAR" = 0 ]; then
  [ -n "$TAG" ] || { echo "--tag é obrigatória (ou --voltar)" >&2; uso; }
  case "$TAG" in *[!A-Za-z0-9._-]*) falha "tag inválida: '$TAG'" 64 ;; esac
fi

DIR_INSTANCIA="$BASE/$AMBIENTE"; DIR_REPO="$DIR_INSTANCIA/repo"; ENV="$DIR_INSTANCIA/.env"
[ -d "$DIR_REPO/.git" ] || falha "$DIR_INSTANCIA não é uma instância instalada (sem repo/). Use deploy/instalar.sh."
carregar_env_da_instancia "$ENV"
: "${ROOTOS_PROJECT:?ROOTOS_PROJECT ausente no .env}" "${ROOTOS_CONTAINER_PREFIX:?}" "${ROOTOS_NETWORK_NAME:?}" "${ROOTOS_BIND_IP:?}"
: "${DB_USER:?}" "${DB_PASSWORD:?}" "${DB_NAME:?}" "${API_HOST_PORT:?}" "${WEB_HOST_PORT:?}" "${DB_PORT:?}" "${REDIS_PORT:?}" "${MINIO_PORT:?}" "${MINIO_CONSOLE_PORT:?}"
ATUAL_TAG="${ROOTOS_VERSION:-}"; ATUAL_COMMIT="${ROOTOS_COMMIT:-}"; ATUAL_IMAGEM="${ROOTOS_IMAGE:-}"
DB_CONT="${ROOTOS_CONTAINER_PREFIX}_db"
URL_SAUDE="http://$ROOTOS_BIND_IP:$API_HOST_PORT/api/health"
URL_VERSAO="http://$ROOTOS_BIND_IP:$API_HOST_PORT/api/health/versao"

apontar_para() { # imagem tag commit — regrava override + 3 chaves do .env
  escrever_override "$DIR_INSTANCIA/override.yml" "$ROOTOS_CONTAINER_PREFIX" "$ROOTOS_NETWORK_NAME" "$1" "$ROOTOS_BIND_IP" \
    "$WEB_HOST_PORT" "$API_HOST_PORT" "$DB_PORT" "$REDIS_PORT" "$MINIO_PORT" "$MINIO_CONSOLE_PORT"
  gravar_chave_no_env "$ENV" ROOTOS_IMAGE "$1"
  gravar_chave_no_env "$ENV" ROOTOS_VERSION "$2"
  gravar_chave_no_env "$ENV" ROOTOS_COMMIT "$3"
  export ROOTOS_IMAGE="$1" ROOTOS_VERSION="$2" ROOTOS_COMMIT="$3"
}

checksum_ferramentas() {
  local hash
  if command -v sha256sum >/dev/null 2>&1; then
    hash=(sha256sum)
  elif command -v shasum >/dev/null 2>&1; then
    hash=(shasum -a 256)
  else
    falha "nem sha256sum nem shasum estão disponíveis; não consigo provar que ferramentas/ foi preservada"
  fi
  if [ -d "$DIR_REPO/ferramentas" ]; then
    (cd "$DIR_REPO/ferramentas" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 "${hash[@]}" 2>/dev/null | "${hash[@]}" | cut -d' ' -f1)
  else
    echo "ausente"
  fi
}

# FALHA FECHADA: não conseguir ler o banco não é "nenhuma migration aplicada" — é
# não saber, e não saber não libera atualização.
migrations_aplicadas() {
  local saida
  saida="$("$DOCKER" exec "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "select migration_name || ':' || coalesce(checksum,'') from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1")" \
    || falha "não consegui ler _prisma_migrations em $DB_CONT/$DB_NAME; sem saber o que está aplicado a atualização não segue"
  printf '%s\n' "$saida"
}

# Contagem de migrations num banco — é o que prova que a cópia do ensaio é inteira.
contar_migrations() {
  "$DOCKER" exec "$DB_CONT" psql -U "$DB_USER" -d "$1" -tAc "select count(*) from _prisma_migrations" 2>/dev/null | tr -d '[:space:]'
}

# Os diretórios de migration na tag: `commit:caminho` lista os FILHOS do caminho.
migrations_na_tag() {
  local saida
  saida="$("$GIT" -C "$DIR_REPO" ls-tree -d --name-only "$1:apps/api/prisma/migrations" 2>/dev/null)" \
    || falha "não consegui ler apps/api/prisma/migrations no commit $1; sem inventário da tag a atualização não segue"
  printf '%s\n' "$saida"
}

# ------------------------------------------------------------- --voltar
if [ "$VOLTAR" = 1 ]; then
  passo "voltar para a versão anterior registrada"
  # A linha "atualizado" registra "anterior=<imagem>@<tag>@<commit>".
  if [ -n "$VOLTAR_PARA" ]; then
    LINHA="$(grep -E "\| $VOLTAR_PARA \| " "$DIR_INSTANCIA/versoes.log" | tail -1 || true)"
    [ -n "$LINHA" ] || falha "a versão '$VOLTAR_PARA' nunca esteve nesta instância (versoes.log)"
    ANT_TAG="$VOLTAR_PARA"
    ANT_COMMIT="$(printf '%s' "$LINHA" | awk -F' \\| ' '{print $3}')"
    ANT_IMAGEM="rootos-app:${ANT_TAG}-${ANT_COMMIT:0:12}"
  else
    LINHA="$(grep -E '\| atualizado anterior=' "$DIR_INSTANCIA/versoes.log" | tail -1 || true)"
    [ -n "$LINHA" ] || falha "não há versão anterior registrada em versoes.log"
    ANTERIOR="${LINHA##*anterior=}"
    ANT_IMAGEM="${ANTERIOR%%@*}"; RESTO="${ANTERIOR#*@}"; ANT_TAG="${RESTO%%@*}"; ANT_COMMIT="${RESTO#*@}"
  fi
  "$DOCKER" image inspect "$ANT_IMAGEM" >/dev/null 2>&1 || falha "a imagem anterior $ANT_IMAGEM não está mais neste host — sem ela não há volta de runtime; restaure pelo dump e reinstale a versão"
  if [ "$SO_CHECAR" = 1 ]; then
    cat <<MSG
[atualizar] só checando — nada será tocado.
  voltaria de: ${ATUAL_IMAGEM:-?} (tag ${ATUAL_TAG:-?})
  para:        $ANT_IMAGEM (tag $ANT_TAG, commit ${ANT_COMMIT:0:12}) — imagem presente no host
  faria: checkout destacado, 3 chaves de versão no .env, override, up -d --no-build api web, saúde+versão
  NÃO faria: nada no banco (as migrations atuais ficam)
MSG
    exit 0
  fi
  travar_instancia
  trap 'destravar_instancia' EXIT
  "$GIT" -C "$DIR_REPO" checkout --quiet --detach "$ANT_COMMIT"
  apontar_para "$ANT_IMAGEM" "$ANT_TAG" "$ANT_COMMIT"
  compose up -d --no-build api web
  registrar_versao "$ANT_TAG" "$ANT_COMMIT" "voltou de=$ATUAL_IMAGEM"
  esperar_saude "$URL_SAUDE" 60 || falha "voltou para $ANT_IMAGEM mas a API não respondeu; veja os logs" 2
  V_AR="$(versao_no_ar "$URL_VERSAO")"; C_AR="$(commit_no_ar "$URL_VERSAO")"
  { [ "$V_AR" = "$ANT_TAG" ] && [ "$C_AR" = "$ANT_COMMIT" ]; } \
    || falha "a API responde, mas diz '$V_AR@$C_AR' e esperava '$ANT_TAG@$ANT_COMMIT' — a volta NÃO está confirmada" 2
  ULTIMO_DUMP="$(ls -t "$DIR_INSTANCIA"/backups/diario/*.sql.gz 2>/dev/null | head -1 || true)"
  cat <<MSG

  Runtime de volta em $ANT_IMAGEM (tag $ANT_TAG).
  ATENÇÃO: o BANCO continua com as migrations que a versão $ATUAL_TAG aplicou. Se precisar do dado
  anterior, restaure o dump: ${ULTIMO_DUMP:-<nenhum dump em $DIR_INSTANCIA/backups/diario>}
  (deploy/backup-db.sh --restore-test para ensaiar num banco descartável antes.)

MSG
  exit 0
fi

# ------------------------------------------------------------- atualizar
passo "1/8 compatibilidade (nada é tocado ainda)"
if [ "$SO_CHECAR" = 1 ]; then
  # Só checando: nem o fetch (grava refs no repo da instância). ls-remote não escreve nada.
  NOVO_COMMIT="$("$GIT" -C "$DIR_REPO" ls-remote --tags origin "refs/tags/$TAG^{}" "refs/tags/$TAG" 2>/dev/null | awk '{print $1}' | tail -1)"
  [ -n "$NOVO_COMMIT" ] || falha "a tag '$TAG' não existe no remoto"
  if ! "$GIT" -C "$DIR_REPO" cat-file -e "$NOVO_COMMIT^{commit}" 2>/dev/null; then
    echo "  tag $TAG → commit ${NOVO_COMMIT:0:12} (no remoto). Os objetos não estão neste clone: o inventário de migrations e do compose exige o fetch, que só a execução real faz."
    echo "[atualizar] só checando — nada foi tocado."
    exit 0
  fi
else
  "$GIT" -C "$DIR_REPO" fetch --quiet --tags origin || falha "git fetch falhou (a deploy key tem leitura?)"
  NOVO_COMMIT="$("$GIT" -C "$DIR_REPO" rev-parse --verify --quiet "refs/tags/$TAG^{commit}" || true)"
  [ -n "$NOVO_COMMIT" ] || falha "a tag '$TAG' não existe no remoto"
fi
[ "$NOVO_COMMIT" != "$ATUAL_COMMIT" ] || falha "a instância já está em $TAG ($NOVO_COMMIT)"
NOVA_IMAGEM="rootos-app:${TAG}-${NOVO_COMMIT:0:12}"

APLICADAS_COM_SOMA="$(migrations_aplicadas)"
APLICADAS="$(printf '%s\n' "$APLICADAS_COM_SOMA" | cut -d: -f1)"
NA_TAG="$(migrations_na_tag "$NOVO_COMMIT")"
FALTANDO=""
while IFS= read -r m; do
  [ -n "$m" ] || continue
  if ! printf '%s\n' "$NA_TAG" | grep -qxF "$m"; then FALTANDO="$FALTANDO $m"; fi
done <<< "$APLICADAS"
[ -z "$FALTANDO" ] || falha "migrations já aplicadas no banco que NÃO existem na tag $TAG:$FALTANDO — isso é downgrade ou histórico divergente; não há caminho seguro por aqui."
# MIGRATION HISTÓRICA ALTERADA: o checksum que o Prisma gravou ao aplicar tem de
# ser o sha256 do migration.sql que a tag nova traz. Diferente = alguém editou o
# passado; `migrate deploy` falharia (ou pior, não) — recusa aqui.
ALTERADAS=""
while IFS= read -r par; do
  [ -n "$par" ] || continue
  nome="${par%%:*}"; soma="${par#*:}"
  [ -n "$soma" ] && [ "$soma" != "$nome" ] || continue
  atual="$("$GIT" -C "$DIR_REPO" show "$NOVO_COMMIT:apps/api/prisma/migrations/$nome/migration.sql" 2>/dev/null | sha256_stdin || true)"
  [ -n "$atual" ] && [ "$atual" != "$soma" ] && ALTERADAS="$ALTERADAS $nome"
done <<< "$APLICADAS_COM_SOMA"
[ -z "$ALTERADAS" ] || falha "migrations já aplicadas cujo conteúdo é DIFERENTE na tag $TAG:$ALTERADAS — histórico alterado depois de aplicado; não há caminho seguro por aqui."
PENDENTES="$(comm -13 <(printf '%s\n' "$APLICADAS" | sort) <(printf '%s\n' "$NA_TAG" | sort) | grep -v '^$' || true)"

TMP_COMPOSE="$(mktemp)"
"$GIT" -C "$DIR_REPO" show "$NOVO_COMMIT:docker-compose.yml" > "$TMP_COMPOSE" 2>/dev/null || falha "a tag $TAG não tem docker-compose.yml"
conferir_variaveis_do_compose "$TMP_COMPOSE" "$ENV"

echo "  de:   ${ATUAL_TAG:-?} (${ATUAL_COMMIT:0:12}) · imagem ${ATUAL_IMAGEM:-?}"
echo "  para: $TAG (${NOVO_COMMIT:0:12}) · imagem $NOVA_IMAGEM"
echo "  migrations pendentes: $(printf '%s' "$PENDENTES" | grep -c . || true)"
if [ "$SO_CHECAR" = 1 ]; then echo "[atualizar] só checando — nada será tocado."; exit 0; fi

travar_instancia
# Um único ponto de saída: limpa a trava e os temporários; o corte (passo 7) troca
# esta função pela sua, que restaura e depois chama esta.
ao_sair() { local st=$?; rm -f "${TMP_COMPOSE:-}" "${OVERRIDE_TMP:-}"; destravar_instancia; exit "$st"; }
trap ao_sair EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

passo "2/8 backup do banco"
BACKUP_DB_CONTAINER="$DB_CONT" PGUSER="$DB_USER" PGDATABASE="$DB_NAME" BACKUP_DIR="$DIR_INSTANCIA/backups" \
  bash "$DIR_REPO/deploy/backup-db.sh" || falha "o backup falhou; sem dump não há caminho de volta do dado, e a atualização não segue"
ULTIMO_DUMP="$(ls -t "$DIR_INSTANCIA"/backups/diario/*.sql.gz 2>/dev/null | head -1 || true)"
[ -n "$ULTIMO_DUMP" ] || falha "o backup terminou sem deixar dump em $DIR_INSTANCIA/backups/diario"

passo "3/8 código na tag $TAG (checkout destacado; ferramentas/ conferida)"
ANTES="$(checksum_ferramentas)"
"$GIT" -C "$DIR_REPO" checkout --quiet --detach "$NOVO_COMMIT"
DEPOIS="$(checksum_ferramentas)"
if [ "$ANTES" != "$DEPOIS" ]; then
  "$GIT" -C "$DIR_REPO" checkout --quiet --detach "$ATUAL_COMMIT"
  falha "o checkout de $TAG alterou ferramentas/ (a tag rastreia arquivos ali?). Desfeito. As ferramentas do cliente não podem ser tocadas pela atualização (ADR-014)."
fi
desfazer_codigo() { "$GIT" -C "$DIR_REPO" checkout --quiet --detach "$ATUAL_COMMIT" 2>/dev/null || true; }

passo "4/8 imagem $NOVA_IMAGEM (a anterior ${ATUAL_IMAGEM:-?} fica; instância intocada)"
# Override TEMPORÁRIO: o build e o ensaio usam a imagem nova sem que o .env ou o
# override da instância mudem. Até o corte, `compose` da instância continua igual.
OVERRIDE_TMP="$(mktemp "$DIR_INSTANCIA/.override.novo.XXXXXX")"
escrever_override "$OVERRIDE_TMP" "$ROOTOS_CONTAINER_PREFIX" "$ROOTOS_NETWORK_NAME" "$NOVA_IMAGEM" "$ROOTOS_BIND_IP" \
  "$WEB_HOST_PORT" "$API_HOST_PORT" "$DB_PORT" "$REDIS_PORT" "$MINIO_PORT" "$MINIO_CONSOLE_PORT"
export ROOTOS_VERSION="$TAG" ROOTOS_COMMIT="$NOVO_COMMIT" ROOTOS_IMAGE="$NOVA_IMAGEM"
if ! OVERRIDE_ATIVO="$OVERRIDE_TMP" compose build api; then desfazer_codigo; falha "o build de $TAG falhou; nada subiu, a instância não foi tocada"; fi
"$DOCKER" image inspect "$NOVA_IMAGEM" >/dev/null 2>&1 || { desfazer_codigo; falha "o build não produziu $NOVA_IMAGEM"; }

passo "5/8 ensaio: migrate deploy + smoke numa CÓPIA do banco"
ENSAIO="rootos_ensaio_$(date +%Y%m%d%H%M%S)"
"$DOCKER" exec "$DB_CONT" psql -U "$DB_USER" -d postgres -qc "CREATE DATABASE \"$ENSAIO\"" \
  || { desfazer_codigo; falha "não consegui criar o banco de ensaio"; }
limpar_ensaio() { "$DOCKER" exec "$DB_CONT" psql -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS \"$ENSAIO\"" >/dev/null 2>&1 || true; }
# FALHA FECHADA nas duas pontas: pipefail pega o pg_dump que morreu no meio; ON_ERROR_STOP
# pega o psql que engoliria um erro de SQL. E a contagem de migrations prova que a cópia é inteira.
"$DOCKER" exec "$DB_CONT" bash -o pipefail -c "pg_dump -U '$DB_USER' '$DB_NAME' | psql -q -v ON_ERROR_STOP=1 -U '$DB_USER' '$ENSAIO'" >/dev/null \
  || { limpar_ensaio; desfazer_codigo; falha "não consegui copiar o banco para o ensaio (pg_dump ou psql falharam). Cópia incompleta não serve de ensaio. Produção não foi tocada."; }
N_REAL="$(contar_migrations "$DB_NAME")"; N_ENSAIO="$(contar_migrations "$ENSAIO")"
[ -n "$N_REAL" ] && [ "$N_REAL" = "$N_ENSAIO" ] \
  || { limpar_ensaio; desfazer_codigo; falha "a cópia do ensaio tem $N_ENSAIO migration(s) e o banco real tem $N_REAL — cópia incompleta, ensaio inválido. Produção não foi tocada."; }
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_CONT:5432/$ENSAIO"
if ! "$DOCKER" run --rm --network "$ROOTOS_NETWORK_NAME" -e DATABASE_URL -e ROTINAS_CRON=off -e OBSIDIAN_REINDEX_MIN=0 \
     -e BIO_SYNC_INTERVAL_MIN=0 -e BIO_BRIDGE_INTERVAL_MIN=0 -e CLICKUP_SYNC_INTERVAL_MIN=0 \
     -e ASAAS_SYNC_INTERVAL_MIN=0 -e PLUGGY_SYNC_INTERVAL_MIN=0 \
     -w /app/apps/api "$NOVA_IMAGEM" sh -c 'pnpm exec prisma migrate deploy && pnpm smoke'; then
  limpar_ensaio; unset DATABASE_URL; desfazer_codigo
  falha "o ENSAIO reprovou (migration ou boot da imagem nova numa cópia do banco). Produção não foi tocada."
fi
# A volta automática só é segura se o runtime anterior também conviver com o
# schema novo. Prova isso na mesma cópia já migrada, antes de tocar no banco real.
if ! "$DOCKER" run --rm --network "$ROOTOS_NETWORK_NAME" -e DATABASE_URL -e ROTINAS_CRON=off -e OBSIDIAN_REINDEX_MIN=0 \
     -e BIO_SYNC_INTERVAL_MIN=0 -e BIO_BRIDGE_INTERVAL_MIN=0 -e CLICKUP_SYNC_INTERVAL_MIN=0 \
     -e ASAAS_SYNC_INTERVAL_MIN=0 -e PLUGGY_SYNC_INTERVAL_MIN=0 \
     -w /app/apps/api "$ATUAL_IMAGEM" sh -c 'pnpm smoke'; then
  limpar_ensaio; unset DATABASE_URL; desfazer_codigo
  falha "a imagem anterior não roda sobre o schema novo no ENSAIO; a volta automática seria insegura. Produção não foi tocada."
fi
limpar_ensaio; unset DATABASE_URL

passo "6/8 migrations no banco REAL e política versionada (antes do up)"
# Ponto sem volta do SCHEMA. O ensaio já provou que aplica; o dump do passo 2 é a
# volta do dado. Roda com a imagem nova (override temporário), no banco real.
if ! OVERRIDE_ATIVO="$OVERRIDE_TMP" compose run --rm --no-deps api sh -c 'pnpm exec prisma migrate deploy'; then
  desfazer_codigo
  falha "migrate deploy no banco real falhou depois de passar no ensaio. O runtime antigo continua no ar; confira o estado das migrations (_prisma_migrations) antes de qualquer coisa. Dump de antes: $ULTIMO_DUMP"
fi
SCHEMA_MIGRADO=1
if ! OVERRIDE_ATIVO="$OVERRIDE_TMP" compose run --rm --no-deps api sh -c 'pnpm db:seed:politica'; then
  desfazer_codigo
  falha "db:seed:politica recusou (afrouxamento sem assinatura?). O runtime antigo continua no ar — mas o schema JÁ está em $TAG; assine as variáveis POLITICA_* e rode de novo em vez de voltar."
fi

passo "7/8 O CORTE — transacional"
CARIMBO="$(date +%Y%m%d_%H%M%S)"
cp -a "$ENV" "$ENV.bak.$CARIMBO"
cp -a "$DIR_INSTANCIA/override.yml" "$DIR_INSTANCIA/override.yml.bak.$CARIMBO"
CORTE_ARMADO=1
# O trap: qualquer saída (erro, Ctrl-C, kill) enquanto o corte estiver armado
# restaura .env e override byte a byte e re-sobe a imagem ANTERIOR.
desfazer_corte() {
  local st=$?
  if [ "${CORTE_ARMADO:-0}" != 1 ]; then rm -f "$TMP_COMPOSE" "$OVERRIDE_TMP"; destravar_instancia; exit "$st"; fi
  CORTE_ARMADO=0
  printf '\n[atualizar] CORTE INTERROMPIDO — restaurando .env e override e re-subindo %s\n' "${ATUAL_IMAGEM:-?}" >&2
  cp -a "$ENV.bak.$CARIMBO" "$ENV"
  cp -a "$DIR_INSTANCIA/override.yml.bak.$CARIMBO" "$DIR_INSTANCIA/override.yml"
  export ROOTOS_IMAGE="$ATUAL_IMAGEM" ROOTOS_VERSION="$ATUAL_TAG" ROOTOS_COMMIT="$ATUAL_COMMIT"
  desfazer_codigo
  compose up -d --no-build api web >/dev/null 2>&1 || true
  # A RECUPERAÇÃO É VERIFICADA, não anunciada: saúde E versão+commit da anterior.
  local recuperado=0 v c
  if esperar_saude "$URL_SAUDE" 30; then
    v="$(versao_no_ar "$URL_VERSAO")"; c="$(commit_no_ar "$URL_VERSAO")"
    [ "$v" = "$ATUAL_TAG" ] && [ "$c" = "$ATUAL_COMMIT" ] && recuperado=1
  fi
  if [ "$recuperado" = 1 ]; then
    registrar_versao "$ATUAL_TAG" "$ATUAL_COMMIT" "voltou automaticamente de=$NOVA_IMAGEM (confirmada no ar)"
    cat >&2 <<MSG

  A versão $TAG não ficou de pé. O RUNTIME voltou para ${ATUAL_IMAGEM:-?} — CONFIRMADO no ar
  (saúde ok, versão $ATUAL_TAG@${ATUAL_COMMIT:0:12}); .env e override restaurados.
  O BANCO ficou com as migrations de $TAG aplicadas — isto NÃO é rollback de schema.
  Se a versão antiga não conviver com o schema novo, restaure o dump tirado antes:
     $ULTIMO_DUMP
  (deploy/backup-db.sh --restore-test para ensaiar num banco descartável.)
  Logs: $DOCKER compose -p $ROOTOS_PROJECT logs api

MSG
    rm -f "$TMP_COMPOSE" "$OVERRIDE_TMP"; destravar_instancia
    exit 1
  fi
  registrar_versao "$ATUAL_TAG" "$ATUAL_COMMIT" "tentou voltar de=$NOVA_IMAGEM — RECUPERAÇÃO NÃO CONFIRMADA"
  cat >&2 <<MSG

  A versão $TAG não ficou de pé E A RECUPERAÇÃO NÃO ESTÁ CONFIRMADA: depois de re-subir
  ${ATUAL_IMAGEM:-?}, a API não respondeu saúde ok com versão $ATUAL_TAG@${ATUAL_COMMIT:0:12}.
  .env e override foram restaurados; o runtime precisa de olho humano AGORA:
     $DOCKER compose -p $ROOTOS_PROJECT ps
     $DOCKER compose -p $ROOTOS_PROJECT logs api
  O BANCO ficou com as migrations de $TAG — isto NÃO é rollback de schema. Dump de antes: $ULTIMO_DUMP

MSG
  rm -f "$TMP_COMPOSE" "$OVERRIDE_TMP"; destravar_instancia
  exit 2
}
trap desfazer_corte EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
apontar_para "$NOVA_IMAGEM" "$TAG" "$NOVO_COMMIT"
registrar_versao "$TAG" "$NOVO_COMMIT" "atualizado anterior=${ATUAL_IMAGEM}@${ATUAL_TAG}@${ATUAL_COMMIT}"
compose up -d --no-build api web

passo "8/8 saúde e versão no ar"
esperar_saude "$URL_SAUDE" 60
NO_AR="$(versao_no_ar "$URL_VERSAO")"
COMMIT_NO_AR="$(commit_no_ar "$URL_VERSAO")"
if [ -z "$NO_AR" ] || [ -z "$COMMIT_NO_AR" ]; then
  echo "[atualizar] a API não expôs version+commit; não dá para provar o artefato no ar" >&2
  false
fi
if [ "$NO_AR" != "$TAG" ] || [ "$COMMIT_NO_AR" != "$NOVO_COMMIT" ]; then
  echo "[atualizar] a API no ar diz '$NO_AR@$COMMIT_NO_AR', esperava '$TAG@$NOVO_COMMIT'" >&2
  false
fi
# Saúde confirmada: desarma o trap; o corte virou definitivo.
CORTE_ARMADO=0
trap - EXIT INT TERM
rm -f "$TMP_COMPOSE" "$OVERRIDE_TMP"
destravar_instancia

cat <<MSG

  Instância '$AMBIENTE' em $TAG (${NOVO_COMMIT:0:12}), imagem $NOVA_IMAGEM.
  Anterior registrada em versoes.log: ${ATUAL_IMAGEM:-?}. Dump de antes: $ULTIMO_DUMP
  Voltar o runtime (sem mexer no banco): deploy/atualizar.sh --ambiente $AMBIENTE --voltar

MSG
