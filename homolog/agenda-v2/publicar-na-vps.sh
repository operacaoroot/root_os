#!/usr/bin/env bash
# =============================================================================
# PUBLICAR A AGENDA V2 NA VPS DA ROOT (rodada da Agenda v2, 29/10/2026)
# =============================================================================
#
# NÃO RODE DO PREDATOR. Quem roda é o orquestrador do Mac, NA VPS (`ssh` para o
# servidor da Root), na receita das releases: pasta por release, backup do banco
# com sha, a cadeia de compose lida do container vivo, imagem com o hash, a
# migration à parte, o seed da política, a subida só de api e web, e uma guarda
# que volta sozinha se a api não ficar saudável em 3 minutos.
#
# Pré-requisitos (o Mac faz antes):
#   1. o bundle `agenda-v2-delta.bundle` aplicado num clone na VPS, com a branch
#      `agenda-v2/20261029` e a tag `agenda-v2-entrega-20261030`;
#   2. FONTE apontando para esse clone, no commit da tag.
#
# Uso:
#   FONTE=/srv/rootos/fonte-agenda-v2 \
#   POLITICA_AUTOR='<nome de quem assina>' \
#   bash homolog/agenda-v2/publicar-na-vps.sh            # ensaia (não sobe nada)
#   ... VALER=1 bash homolog/agenda-v2/publicar-na-vps.sh # publica
#
# Sem VALER=1 o script vai até o ensaio da migration e da política num banco
# descartável e para, dizendo o que faria.
# =============================================================================
set -euo pipefail

BASE_ESPERADA=c946dcb7
PROJETO=root_marketing-os
API=mktos_api
FONTE=${FONTE:?defina FONTE (o clone na VPS, no commit da entrega)}
AUTOR=${POLITICA_AUTOR:?defina POLITICA_AUTOR (quem assina a política 1.13.0)}
VALER=${VALER:-0}

cd "$FONTE"
HASH=$(git rev-parse HEAD)
CURTO=${HASH:0:7}
DATA=$(date +%Y%m%d-%H%M)
REL=/srv/rootos/releases/agenda-v2-$CURTO-$DATA
# IMG_PRONTA: imagem já carregada na VPS, compilada fora dela (compilar aqui deu falta de memória em 02/11).
IMG=${IMG_PRONTA:-rootos-official:agenda-v2-$CURTO}
mkdir -p "$REL"
exec > >(tee -a "$REL/REPORT.txt") 2>&1
echo "== agenda v2 · release $REL · commit $HASH · $(date -Is)"

# -----------------------------------------------------------------------------
# 0. A produção ainda está na base desta rodada?
#    O Lucas publica direto: se a imagem viva não for a de 16a92871, PARE e diga
#    qual commit juntar antes (a entrega foi juntada a c946dcb7, a Área do cliente).
# -----------------------------------------------------------------------------
IMG_VIVA=$(docker inspect "$API" -f '{{.Config.Image}}')
echo "imagem viva da api: $IMG_VIVA"
COMMIT_VIVO=$(docker inspect "$API" -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)
case "$IMG_VIVA" in
  *c946dcb*) echo "ok: produção em $BASE_ESPERADA" ;;
  *)
    if [ -n "$COMMIT_VIVO" ] && [ "${COMMIT_VIVO:0:8}" = "$BASE_ESPERADA" ]; then
      echo "ok: produção em $BASE_ESPERADA (pela etiqueta da imagem)"
    else
      echo "PARE: a produção não está em $BASE_ESPERADA (imagem $IMG_VIVA, etiqueta '${COMMIT_VIVO:-sem}')."
      echo "Junte o commit vivo à branch agenda-v2/20261029 (git merge <commit vivo>), rode as suítes e refaça o bundle."
      exit 2
    fi
    ;;
esac
git merge-base --is-ancestor "$BASE_ESPERADA" HEAD || { echo "PARE: o commit da entrega não descende de $BASE_ESPERADA."; exit 2; }

# -----------------------------------------------------------------------------
# 1. A cadeia de compose que está no ar, lida do container vivo.
# -----------------------------------------------------------------------------
docker inspect "$API" -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' > "$REL/cadeia-antes.txt"
echo "cadeia antes: $(cat "$REL/cadeia-antes.txt")"
# A cadeia de antes como `-f a -f b` (a volta), e a de depois = a mesma + a
# sobreposição desta release, que só troca a imagem de api e web.
tr ',' '\n' < "$REL/cadeia-antes.txt" | sed 's/^/-f /' | tr '\n' ' ' > "$REL/cadeia-volta.txt"
printf 'services:\n  api:\n    image: %s\n  web:\n    image: %s\n' "$IMG" "$IMG" > "$REL/imagem.override.yml"
{ cat "$REL/cadeia-volta.txt"; echo " -f $REL/imagem.override.yml"; } | tr '\n' ' ' > "$REL/cadeia-depois.txt"
echo "cadeia depois: $(cat "$REL/cadeia-depois.txt")"
WORKDIR=$(docker inspect "$API" -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
echo "pasta do compose: $WORKDIR"

# -----------------------------------------------------------------------------
# 2. Backup do banco, com sha.
# -----------------------------------------------------------------------------
DB_CONT=$(docker ps --filter "label=com.docker.compose.project=$PROJETO" --filter "label=com.docker.compose.service=db" --format '{{.Names}}' | head -1)
[ -n "$DB_CONT" ] || { echo "PARE: não achei o container do banco do projeto $PROJETO."; exit 2; }
DB_USER=$(docker exec "$DB_CONT" printenv POSTGRES_USER)
DB_NAME=$(docker exec "$DB_CONT" printenv POSTGRES_DB)
docker exec "$DB_CONT" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$REL/banco-antes.dump"
sha256sum "$REL/banco-antes.dump" | tee "$REL/banco-antes.sha256"

# -----------------------------------------------------------------------------
# 3. A imagem, com os mesmos build args da viva.
# -----------------------------------------------------------------------------
ARGS=$(docker image inspect "$IMG_VIVA" -f '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(API_PROXY_TARGET|NEXT_PUBLIC_CENTRAL_PIXEL_KEY|NEXT_PUBLIC_RAIZ)=' || true)
BUILD_ARGS=()
while IFS= read -r l; do [ -n "$l" ] && BUILD_ARGS+=(--build-arg "$l"); done <<< "$ARGS"
if [ -n "${IMG_PRONTA:-}" ]; then
  docker image inspect "$IMG" >/dev/null || { echo "PARE: a imagem $IMG não está na VPS."; exit 2; }
  echo "imagem pronta, sem compilar aqui: $IMG"
else
  docker build -t "$IMG" --label "org.opencontainers.image.revision=$HASH" "${BUILD_ARGS[@]}" .
fi
docker image ls "$IMG" --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}'

# -----------------------------------------------------------------------------
# 4. Ensaio num banco descartável: restore do backup + migration + política.
# -----------------------------------------------------------------------------
REDE=$(docker inspect "$DB_CONT" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)
ENSAIO=agv2_ensaio_$CURTO
docker exec "$DB_CONT" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $ENSAIO" -c "CREATE DATABASE $ENSAIO"
docker exec -i "$DB_CONT" pg_restore -U "$DB_USER" -d "$ENSAIO" --no-owner < "$REL/banco-antes.dump" || true
DBPASS=$(docker exec "$DB_CONT" printenv POSTGRES_PASSWORD)
URL_ENSAIO="postgresql://$DB_USER:$DBPASS@$DB_CONT:5432/$ENSAIO"
# A URL do banco (com a senha) vai por arquivo de ambiente com 600, nunca na linha de comando (`ps`).
rodar() {
  local env_tmp; env_tmp=$(mktemp); chmod 600 "$env_tmp"
  echo "DATABASE_URL=$1" > "$env_tmp"
  local rc=0
  docker run --rm --network "$REDE" --env-file "$env_tmp" -w /app/apps/api "$IMG" sh -c "$2" || rc=$?
  rm -f "$env_tmp"; return $rc
}
rodar "$URL_ENSAIO" "pnpm exec prisma migrate deploy" | tee "$REL/ensaio-migration.txt"
rodar "$URL_ENSAIO" "POLITICA_CAPACIDADE_NOVA_AUTOR='$AUTOR' POLITICA_CAPACIDADE_NOVA_MOTIVO='agenda v2 29/10/2026: espelho (sincronizar, livre_ocupado), alterar, cancelar, desmarcar, reabrir' POLITICA_REBAIXAMENTO_AUTOR='$AUTOR' POLITICA_REBAIXAMENTO_MOTIVO='agenda v2 29/10/2026, decisão 2: marcar ganha o desfazer implementado agenda.reuniao.desmarcar e a escada o calcula R2; o esquema do marcar aceita bloqueio, pessoal, fora, responsaveis, chave e forcado' pnpm db:seed:politica" | tee "$REL/ensaio-politica.txt"
docker exec "$DB_CONT" psql -U "$DB_USER" -d "$ENSAIO" -Atc "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name='20261029230000_agenda_v2' AND finished_at IS NOT NULL" | tee "$REL/ensaio-conferencia.txt"
docker exec "$DB_CONT" psql -U "$DB_USER" -d postgres -c "DROP DATABASE $ENSAIO"

if [ "$VALER" != "1" ]; then
  echo "== ensaio verde. Nada foi publicado. Para publicar: VALER=1 (mesma linha)."
  exit 0
fi

# -----------------------------------------------------------------------------
# 5. Produção: migration à parte, política, e só então api e web.
# -----------------------------------------------------------------------------
URL_PROD="postgresql://$DB_USER:$DBPASS@$DB_CONT:5432/$DB_NAME"
rodar "$URL_PROD" "pnpm exec prisma migrate deploy" | tee "$REL/migration.txt"
rodar "$URL_PROD" "POLITICA_CAPACIDADE_NOVA_AUTOR='$AUTOR' POLITICA_CAPACIDADE_NOVA_MOTIVO='agenda v2 29/10/2026: espelho (sincronizar, livre_ocupado), alterar, cancelar, desmarcar, reabrir' POLITICA_REBAIXAMENTO_AUTOR='$AUTOR' POLITICA_REBAIXAMENTO_MOTIVO='agenda v2 29/10/2026, decisão 2: marcar ganha o desfazer implementado agenda.reuniao.desmarcar e a escada o calcula R2; o esquema do marcar aceita bloqueio, pessoal, fora, responsaveis, chave e forcado' pnpm db:seed:politica" | tee "$REL/politica.txt"

cd "$WORKDIR"
# A imagem nova entra pela sobreposição da release; nenhum arquivo do servidor é editado.
# shellcheck disable=SC2046
docker compose --project-name "$PROJETO" $(cat "$REL/cadeia-depois.txt") up -d --no-deps --no-build api web

# -----------------------------------------------------------------------------
# 6. Guarda: 3 minutos para a api ficar saudável, senão volta sozinha.
# -----------------------------------------------------------------------------
ok=0
for _ in $(seq 1 36); do
  st=$(docker inspect "$API" -f '{{.State.Health.Status}}' 2>/dev/null || echo nada)
  [ "$st" = healthy ] && { ok=1; break; }
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "VOLTANDO: a api não ficou saudável em 3 min. Imagem anterior: $IMG_VIVA"
  # shellcheck disable=SC2046
  docker compose --project-name "$PROJETO" $(cat "$REL/cadeia-volta.txt") up -d --no-deps --no-build api web
  echo "A migration 20261029230000_agenda_v2 é aditiva: a imagem anterior ignora as tabelas novas. O banco fica como está; o backup é $REL/banco-antes.dump."
  exit 1
fi

# -----------------------------------------------------------------------------
# 7. Conferências depois de subir.
# -----------------------------------------------------------------------------
{
  echo "== conferências $(date -Is)"
  docker exec "$API" node -e "fetch('http://127.0.0.1:4001/api/health').then(r=>r.text()).then(t=>console.log('health', t))"
  docker exec "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT 'migration agenda_v2', count(*) FROM \"_prisma_migrations\" WHERE migration_name='20261029230000_agenda_v2' AND finished_at IS NOT NULL"
  docker exec "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT 'capacidades da agenda', count(*) FROM \"Capability\" WHERE id IN ('comunicacao.agenda.sincronizar','comunicacao.agenda.livre_ocupado','agenda.reuniao.alterar','agenda.reuniao.cancelar','agenda.reuniao.desmarcar','agenda.reuniao.reabrir')"
  docker exec "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT 'rls nas 7', count(*) FROM pg_class WHERE relname IN ('AgendaEvento','AgendaSincronia','AgendaRegraPessoa','AgendaRito','Feriado','AgendaRegraTexto','AgendaConvite') AND relrowsecurity AND relforcerowsecurity"
  docker exec "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT 'permissao agenda.regras', count(*) FROM \"Permission\" WHERE key='agenda.regras'"
  echo "imagem no ar: $(docker inspect "$API" -f '{{.Config.Image}}')"
  echo "Lembrete: todos saem e entram (a permissão agenda.regras viaja no JWT)."
} | tee "$REL/conferencias.txt"
echo "== publicado: $IMG"
