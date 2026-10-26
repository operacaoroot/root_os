#!/usr/bin/env bash
# PUBLICA uma leva com MIGRATION ADITIVA na produção, partindo da cadeia que está NO AR (não do ponto zero:
# assim overrides de outras sessões, como AGENTE_TAREFAS_JID, ficam). Troca só a imagem do api e do web.
#  1. backup do banco   2. confere que só a imagem muda   3. migration à parte (a produção não migra na partida)
#  4. sobe api e web; se a API não ficar saudável, volta sozinho para a cadeia de antes
# Voltar depois: o REPORT.txt da release (imagem de antes; as colunas novas ficam, vazias, e o código antigo as ignora).
# Uso: bash publicar-leva-com-migration.sh <imagem> <nome>
set -uo pipefail
IMG="${1:?uso: publicar-leva-com-migration.sh <imagem> <nome>}"; NOME="${2:?nome da leva}"
R=/srv/rootos/releases/$NOME
Z=/srv/rootos/releases/ponto-zero-20261026
C=/etc/easypanel/projects/root/marketing-os/code
DC="docker compose --project-name root_marketing-os"
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
[ -e "$R" ] && { echo "$R já existe"; exit 1; }
NOVA=$(docker image inspect -f '{{.Id}}' "$IMG") || { echo "imagem $IMG não existe"; exit 1; }
mkdir -p "$R" && chmod 700 "$R"

ATUAL=$(docker inspect -f '{{.Image}}' mktos_api); echo "$ATUAL" > "$R/imagem-antes.txt"; echo "$NOVA" > "$R/imagem.txt"
docker inspect mktos_api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  | tr ',' '\n' | sed 's/^/-f /' | tr '\n' ' ' > "$R/cadeia-antes.txt"
printf 'services:\n  api:\n    image: %s\n  web:\n    image: %s\n' "$NOVA" "$NOVA" > "$R/publish-images.yml"
echo "$(cat "$R/cadeia-antes.txt") -f $R/publish-images.yml" > "$R/cadeia-depois.txt"

log "1. backup do banco"
docker exec mktos_db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$R/banco-antes.dump" || { echo "backup falhou: nada mudou"; exit 1; }
sha256sum "$R/banco-antes.dump" > "$R/banco-antes.dump.sha256"; log "backup $(du -h "$R/banco-antes.dump" | cut -f1)"

cd "$C"
$DC $(cat "$R/cadeia-antes.txt") config > "$R/config-antes.yml"
$DC $(cat "$R/cadeia-depois.txt") config > "$R/config-depois.yml"
DIF=$(diff "$R/config-antes.yml" "$R/config-depois.yml" | grep '^[<>]' | grep -v 'image:' || true)
[ -z "$DIF" ] || { echo "a cadeia nova muda mais que a imagem:"; echo "$DIF"; exit 1; }
log "2. conferência ok: só a imagem muda ($ATUAL -> $NOVA)"

log "3. migration"
$DC $(cat "$R/cadeia-depois.txt") run --rm --no-deps -T --entrypoint sh api -c 'pnpm exec prisma migrate deploy' < /dev/null > "$R/migration.log" 2>&1 \
  || { tail -15 "$R/migration.log"; echo "migration falhou: imagem não trocada (o banco de antes está em $R/banco-antes.dump)"; exit 1; }
grep -E "Applying|applied|No pending" "$R/migration.log"

voltar(){ log "VOLTANDO para a imagem de antes"; $DC $(cat "$R/cadeia-antes.txt") up -d --no-deps --no-build api web; exit 1; }
log "4. subindo api e web"
$DC $(cat "$R/cadeia-depois.txt") up -d --no-deps --no-build api web > "$R/compose.log" 2>&1 || { tail -20 "$R/compose.log"; voltar; }
s=""; for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' mktos_api 2>/dev/null || true); [ "$s" = healthy ] && break; sleep 3; done
a=$(docker exec mktos_api node -e 'fetch("http://127.0.0.1:4001/api/health").then(r=>console.log(r.status)).catch(()=>console.log(0))')
log "api: $s · health $a"; [ "$s" = healthy ] && [ "$a" = 200 ] || voltar

cat > "$R/REPORT.txt" <<EOF
LEVA $NOME publicada em $(date -u +%FT%TZ)
Imagem $IMG ($NOVA). Antes: $ATUAL. Migration aditiva: ver migration.log. Backup do banco de antes: $R/banco-antes.dump
VOLTAR PARA ANTES: cd $C && $DC \$(cat $R/cadeia-antes.txt) up -d --no-deps --no-build api web
VOLTAR AO PONTO ZERO: bash $Z/voltar-ao-ponto-zero.sh
EOF
echo "$(date -u +%FT%TZ) | $NOME | $IMG | com migration" >> "$Z/levas.log"
log "no ar: $NOME"
