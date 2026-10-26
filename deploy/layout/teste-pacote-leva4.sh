#!/usr/bin/env bash
# AMBIENTE DE TESTE: sobe o pacote (leva 4 + integração) sobre a cópia do banco da produção,
# roda os dados com diário e ENSAIA A VOLTA (imagem do ponto zero com as colunas novas no banco,
# depois o desfazer dos dados) antes de deixar o pacote no ar para o Lucas ver.
# Uso: bash teste-pacote-leva4.sh <imagem-do-pacote>
set -euo pipefail
T=/srv/rootos/teste-layout
Z=/srv/rootos/releases/ponto-zero-20261026
B=/srv/rootos/bundles
IMG="${1:?uso: teste-pacote-leva4.sh <imagem>}"
ZERO=$(cat "$Z/imagem.txt")
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
cd "$T/repo"
DC=(docker compose -p rootos-teste-layout --env-file "$T/.env" -f docker-compose.yml -f "$T/override.yml")
psql_teste(){ docker exec -i rootos_teste_db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q "$@"' sh "$@"; }
contar(){ psql_teste -Atc 'select (select count(*) from "WorkTask"),(select count(*) from "Lead"),(select count(*) from "Partner"),(select count(*) from "AcordoComercial")'; }

subir(){ # $1 = imagem
  sed -i "s|^    image: .*|    image: $1|" "$T/override.yml"
  "${DC[@]}" up -d --no-deps --no-build api web > /dev/null 2>&1
  local s=""
  for i in $(seq 1 60); do s=$(docker inspect -f '{{.State.Health.Status}}' rootos_teste_api 2>/dev/null || true); [ "$s" = healthy ] && break; sleep 3; done
  local a; a=$(docker exec rootos_teste_api node -e 'fetch("http://127.0.0.1:4001/api/health").then(r=>console.log(r.status)).catch(()=>console.log(0))')
  log "imagem $1 · api $s · health $a"
  [ "$a" = 200 ] || { docker logs --tail 30 rootos_teste_api; return 1; }
}

log "cópia do banco de teste antes de tudo"
docker exec rootos_teste_db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$T/antes-leva4.dump"
log "contagens antes (tarefas|leads|parceiros|acordos): $(contar)"

log "1. pacote no ar (a migration roda na partida da api)"
subir "$IMG"
psql_teste -Atc "select migration_name from _prisma_migrations where migration_name like '%integracao_cliente%' and finished_at is not null"

log "2. dados da integração, com diário"
psql_teste -1 < "$B/integracao-dados.sql"
log "contagens depois: $(contar)"

log "3. ENSAIO DA VOLTA: imagem do ponto zero com o banco já migrado"
subir "$ZERO"
log "4. ENSAIO DA VOLTA: desfazer os dados (o diário volta linha por linha)"
psql_teste -1 < "$B/desfazer-integracao-dados.sql"
log "contagens depois de desfazer: $(contar)"

log "5. pacote de novo no ar, dados de novo (para o Lucas ver)"
subir "$IMG"
psql_teste -1 < "$B/integracao-dados.sql" > /dev/null
log "contagens finais: $(contar)"
log "pronto"
