#!/usr/bin/env bash
# Deploy da máquina de conteúdo (frente MC) na VPS ROOT, em etapas.
#
#   bash /root/mc/vps.sh <etapa>
#
# Ordem: diagnostico → backup → codigo → painel → build → ensaio → segredos →
#        seed "Seu Nome" → permissoes → subir → conferir   (voltar = rollback)
#
# Caminho real do deploy: docs/DEPLOY.md §1.0 e §2.3l. Cada etapa que muda algo
# pede SIM antes. Nenhuma etapa imprime segredo.
set -euo pipefail

FONTE=/srv/projetos/root_os
PAINEL=/etc/easypanel/projects/root/marketing-os/code
PROJETO=root_marketing-os
DIR=/root/mc
BUNDLE=$DIR/mc.bundle
SEGREDOS=$DIR/segredos.env
IMG=mktos-app
VOLTA=rollback-mc
SMOKE_DB=smoke_mc
BACKUPS=/root/backups/root-os

falha() { echo "PARADO: $*" >&2; exit 1; }
confirma() { read -r -p "$1 Digite SIM para seguir: " r; case "$r" in SIM|sim|Sim) ;; *) falha "cancelado por você" ;; esac; }
rede() { docker inspect mktos_api -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1; }
dburl() { docker exec mktos_api printenv DATABASE_URL; }
psql_prod() { docker exec mktos_db psql -U mkt -d marketing_os -At -c "$1"; }
papeis() { psql_prod 'select r.key, p.key from "_RolePermissions" rp join "Role" r on r.id = rp."B" join "Permission" p on p.id = rp."A" order by 1, 2'; }
vars_de() { grep -oE '\$\{[A-Z0-9_]+' | tr -d '${' | sort -u; }
# Só as variáveis que ESTA atualização trouxe e o compose do painel ainda não declara.
# As que já faltavam antes (portas, por exemplo) não são desta frente.
faltam_no_painel() {
  local antes
  antes=$(cat "$DIR/sha-antes" 2>/dev/null || true)
  [ -n "$antes" ] || { echo "(rode 'codigo' antes: sem o commit anterior não sei o que é novo)" >&2; return 0; }
  comm -23 <(vars_de < "$FONTE/docker-compose.yml") <(git -C "$FONTE" show "$antes:docker-compose.yml" | vars_de) \
    | comm -23 - <(vars_de < "$PAINEL/docker-compose.yml")
}

mkdir -p "$DIR"
case "${1:-}" in

diagnostico)
  echo "== máquina";            hostname; df -h / | tail -1
  echo "== containers";         docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'mktos|marketing' || true
  echo "== imagens";            docker image ls "$IMG" --format '{{.Tag}}  {{.ID}}  {{.CreatedSince}}'
  echo "== rede do api";        rede
  echo "== código-fonte";       git -C "$FONTE" log --oneline -1; git -C "$FONTE" status --porcelain
  echo "== compose do painel";  ls "$PAINEL"
  echo "== últimas migrations"; psql_prod 'select migration_name from "_prisma_migrations" order by finished_at desc nulls first limit 6'
  echo "== política na boot";   docker logs mktos_api 2>&1 | grep -E 'capacidades' | tail -1 || true
  echo "== variáveis que o repo usa e o painel não (só nomes)"; faltam_no_painel || true
  echo "== permissões por papel"; papeis | cut -d'|' -f1 | sort | uniq -c
  echo "== backups";            ls -t "$BACKUPS"/diario 2>/dev/null | head -3 || echo "nenhum em $BACKUPS/diario"
  ;;

backup)
  confirma "Backup do banco agora e cópia da imagem que está no ar."
  (cd "$FONTE" && BACKUP_DB_CONTAINER=mktos_db PGUSER=mkt PGDATABASE=marketing_os bash deploy/backup-db.sh)
  docker tag "$IMG:latest" "$IMG:$VOLTA"
  docker save "$IMG:$VOLTA" | gzip > "$DIR/$IMG-$VOLTA.tar.gz"
  papeis > "$DIR/papeis-antes.tsv"
  ls -lht "$BACKUPS"/diario | head -2; ls -lh "$DIR/$IMG-$VOLTA.tar.gz"
  echo "OK: backup, imagem de volta ($IMG:$VOLTA, salva em disco) e foto dos papéis."
  ;;

codigo)
  [ -f "$BUNDLE" ] || falha "o bundle não chegou. No Mac: bash deploy/mc/mac.sh enviar"
  git -C "$FONTE" bundle verify "$BUNDLE" >/dev/null || falha "bundle inválido"
  echo "Hoje: $(git -C "$FONTE" log --oneline -1)"
  git -C "$FONTE" rev-parse HEAD > "$DIR/sha-antes"
  confirma "Atualizar o código em $FONTE a partir do bundle (só avança, nunca reescreve)."
  git -C "$FONTE" pull --ff-only "$BUNDLE" main
  echo "Agora: $(git -C "$FONTE" log --oneline -1)"
  ;;

painel)
  echo "Variáveis que esta atualização trouxe e o compose do painel ainda não declara:"
  f=$(faltam_no_painel || true)
  if [ -z "$f" ]; then echo "  nenhuma. Siga para: build"; exit 0; fi
  echo "$f" | sed 's/^/  /'
  echo
  echo "No easyPanel, serviço marketing-os:"
  echo "  1. Compose: no bloco environment: de api (e de web, se ele já repete as da api),"
  echo "     acrescente uma linha por nome acima, no formato  NOME: \${NOME:-}"
  echo "  2. Ambiente: preencha as que têm valor (as de segredo saem da etapa 'segredos')."
  echo "Depois rode esta etapa de novo; ela tem de dizer 'nenhuma'."
  ;;

build)
  docker image inspect "$IMG:$VOLTA" >/dev/null 2>&1 || falha "sem imagem de volta: rode 'backup' antes"
  confirma "Construir a imagem nova (uns 10 min). O que está no ar não muda."
  (cd "$FONTE" && docker compose build api)
  docker image ls "$IMG" --format '{{.Tag}}  {{.ID}}  {{.CreatedSince}}'
  ;;

ensaio)
  NET=$(rede); DB=$(dburl); BASE=${DB%%\?*}; URL="${BASE%/*}/$SMOKE_DB"
  ULT=$(ls -t "$BACKUPS"/diario/*.sql.gz 2>/dev/null | head -1)
  [ -n "$ULT" ] || falha "sem backup em $BACKUPS/diario: rode 'backup' antes"
  echo "Ensaio com o dump $ULT num banco descartável ($SMOKE_DB)."
  docker exec mktos_db psql -U mkt -d marketing_os -q -c "drop database if exists $SMOKE_DB" -c "create database $SMOKE_DB"
  gunzip -c "$ULT" | docker exec -i mktos_db psql -U mkt -d "$SMOKE_DB" -q -v ON_ERROR_STOP=0 >/dev/null 2>"$DIR/ensaio-restore.log" || true
  echo "== migrations novas no banco descartável"
  docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$URL" "$IMG:latest" pnpm exec prisma migrate deploy
  echo "== smoke da imagem nova contra o banco descartável"
  docker run --rm --network "$NET" -w /app/apps/api \
    -e DATABASE_URL="$URL" -e JWT_SECRET="smoke-descartavel-$(openssl rand -hex 16)" -e ROTINAS_CRON=off \
    -e ASAAS_SYNC_INTERVAL_MIN=0 -e BIO_BRIDGE_INTERVAL_MIN=0 -e BIO_SYNC_INTERVAL_MIN=0 \
    -e CLICKUP_SYNC_INTERVAL_MIN=0 -e PLUGGY_SYNC_INTERVAL_MIN=0 \
    -e SMOKE_ROTAS=/api/pauta/episodios,/api/pauta/voz,/api/pauta/agenda,/api/pauta/rodadas,/api/pauta/comentarios \
    "$IMG:latest" pnpm smoke
  docker exec mktos_db psql -U mkt -d marketing_os -q -c "drop database $SMOKE_DB"
  echo "OK: migrations e smoke passaram no descartável, que já foi apagado."
  ;;

segredos)
  if [ -f "$SEGREDOS" ]; then
    echo "Já existem em $SEGREDOS; não gero de novo."
  else
    ( umask 077
      printf 'PAUTA_MIDIA_PUBLICA_SEGREDO=%s\n' "$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)"
      printf 'META_WEBHOOK_PESSOA_HMAC_KEY=%s\n' "$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)"
    ) > "$SEGREDOS"
    echo "Gerados em $SEGREDOS (só o root lê)."
  fi
  echo "Para copiar para a aba Ambiente do easyPanel:  cat $SEGREDOS"
  ;;

seed)
  AUTOR="${2:?uso: bash /root/mc/vps.sh seed \"Seu Nome\"}"
  NET=$(rede); DB=$(dburl)
  echo "Assinatura: $AUTOR. Acrescenta as capacidades da frente e a invariante 4 com uso contado."
  confirma "Gravar a política nova no banco de produção."
  docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" \
    -e POLITICA_CAPACIDADE_NOVA_AUTOR="$AUTOR" \
    -e POLITICA_CAPACIDADE_NOVA_MOTIVO="Frente MC: publicação, lote da semana, comentários, DM e YouTube entram no catálogo" \
    -e POLITICA_REBAIXAMENTO_AUTOR="$AUTOR" \
    -e POLITICA_REBAIXAMENTO_MOTIVO="Frente MC (MD7): invariante 4 com uso contado; o post sai por item de lote assinado por segunda pessoa" \
    "$IMG:latest" pnpm db:seed:politica
  ;;

permissoes)
  NET=$(rede); DB=$(dburl)
  [ -f "$DIR/papeis-antes.tsv" ] || papeis > "$DIR/papeis-antes.tsv"
  echo "O sync REALINHA papel→permissão com o catálogo do código: vínculo dado à mão e fora do catálogo sai."
  confirma "Rodar db:sync-permissions em produção (acaba com o 403 da fila)."
  docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" "$IMG:latest" pnpm db:sync-permissions
  papeis > "$DIR/papeis-depois.tsv"
  echo "== saiu (<) e entrou (>):"
  diff "$DIR/papeis-antes.tsv" "$DIR/papeis-depois.tsv" || true
  echo "Depois do 'subir': todo mundo sai do OS e entra de novo (a permissão viaja no login)."
  ;;

subir)
  f=$(faltam_no_painel || true)
  if [ -n "$f" ]; then
    echo "Aviso: o painel ainda não declara $(echo $f | tr '\n' ' ')."
    echo "O código sobe com o padrão de cada uma (recurso desligado) até elas entrarem no easyPanel."
  fi
  confirma "Trocar api e web pela imagem nova."
  (cd "$PAINEL" && docker compose -p "$PROJETO" up -d --no-build api web)
  echo "Subiu. Em 1 minuto rode: bash /root/mc/vps.sh conferir"
  ;;

conferir)
  docker ps --format '{{.Names}}  {{.Status}}' | grep -E 'mktos_(api|web)'
  docker logs --since 15m mktos_api 2>&1 | grep -E 'capacidades|storage pronto|mídia das peças|entrada do grupo|ERROR|Error:' | tail -15
  echo "Esperado: 'política base vN carregada DO BANCO (71 capacidades)' e nenhum ERROR."
  ;;

voltar)
  confirma "Voltar api e web para a imagem de antes ($IMG:$VOLTA)."
  docker image inspect "$IMG:$VOLTA" >/dev/null 2>&1 || gunzip -c "$DIR/$IMG-$VOLTA.tar.gz" | docker load
  docker tag "$IMG:$VOLTA" "$IMG:latest"
  (cd "$PAINEL" && docker compose -p "$PROJETO" up -d --no-build api web)
  echo "Voltou. Se já existir linha com 'gmail' ou 'aguardando_curadoria', a imagem antiga não lê:"
  echo "aplique a receita A1-volta de docs/ESTADO-DA-EXECUCAO.md."
  ;;

*)
  sed -n '2,10p' "$0"; exit 1 ;;
esac
