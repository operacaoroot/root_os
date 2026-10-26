#!/usr/bin/env bash
# Publica uma leva de LAYOUT do ROOT OS (só tela: sem migration, sem variável nova, sem carga).
# Troca só a imagem do api e do web. Se a API não ficar saudável, volta sozinho para o que estava no ar.
# Uso: bash publicar-layout.sh <imagem> <nome-da-leva>
#   ex.: bash publicar-layout.sh rootos-official:layout-dia-a-dia-8dbd72c layout-dia-a-dia-8dbd72c-20261026
set -uo pipefail
IMG="$1"; NOME="$2"
R=/srv/rootos/releases/$NOME
Z=/srv/rootos/releases/ponto-zero-20261026
C=/etc/easypanel/projects/root/marketing-os/code
DC="docker compose --project-name root_marketing-os"
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
[ -e "$R" ] && { echo "$R já existe"; exit 1; }
[ -f "$Z/imagem.txt" ] || { echo "sem ponto zero em $Z: não publico"; exit 1; }
NOVA=$(docker image inspect -f '{{.Id}}' "$IMG") || { echo "imagem $IMG não existe"; exit 1; }
mkdir -p "$R" && chmod 700 "$R"

# o que está no ar agora (pode ser o ponto zero ou uma leva anterior)
ATUAL=$(docker inspect -f '{{.Image}}' mktos_api)
docker inspect mktos_api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  | tr ',' '\n' | sed 's/^/-f /' | tr '\n' ' ' > "$R/cadeia-antes.txt"
# a cadeia nova = a do ponto zero + a imagem desta leva (as levas não se empilham umas nas outras)
printf 'services:\n  api:\n    image: %s\n  web:\n    image: %s\n' "$NOVA" "$NOVA" > "$R/publish-images.yml"
echo "$(cat "$Z/cadeia.txt") -f $R/publish-images.yml" > "$R/cadeia-depois.txt"
echo "$ATUAL" > "$R/imagem-antes.txt"; echo "$NOVA" > "$R/imagem.txt"

cd "$C"
# conferência: a cadeia nova só muda a imagem do api e do web
$DC $(cat "$R/cadeia-antes.txt") config > "$R/config-antes.yml"
$DC $(cat "$R/cadeia-depois.txt") config > "$R/config-depois.yml"
DIF=$(diff "$R/config-antes.yml" "$R/config-depois.yml" | grep '^[<>]' | grep -v 'image:' || true)
[ -z "$DIF" ] || { echo "a cadeia nova muda mais que a imagem:"; echo "$DIF"; exit 1; }
log "conferência ok: só a imagem muda ($ATUAL -> $NOVA)"

voltar(){ log "VOLTANDO para a imagem anterior"; $DC $(cat "$R/cadeia-antes.txt") up -d --no-deps --no-build api web; exit 1; }
log "subindo api e web"
$DC $(cat "$R/cadeia-depois.txt") up -d --no-deps --no-build api web > "$R/compose.log" 2>&1 || { tail -20 "$R/compose.log"; voltar; }
s=""
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' mktos_api 2>/dev/null || true); [ "$s" = healthy ] && break; sleep 3; done
log "api: $s"; [ "$s" = healthy ] || voltar
a=$(docker exec mktos_api node -e 'fetch("http://127.0.0.1:4001/api/health").then(r=>console.log(r.status)).catch(()=>console.log(0))')
w=$(docker exec mktos_web node -e 'fetch("http://127.0.0.1:4000/login").then(r=>console.log(r.status)).catch(()=>console.log(0))' 2>/dev/null || echo "?")
log "health da api $a · tela de login $w"
[ "$a" = 200 ] || voltar
cat > "$R/REPORT.txt" <<EOF
LEVA DE LAYOUT $NOME publicada em $(date -u +%FT%TZ)
Imagem $IMG ($NOVA). Antes: $ATUAL. Só tela: sem migration, sem variável, sem carga.
VOLTAR PARA A LEVA ANTERIOR: cd $C && $DC \$(cat $R/cadeia-antes.txt) up -d --no-deps --no-build api web
VOLTAR AO PONTO ZERO: bash $Z/voltar-ao-ponto-zero.sh
EOF
echo "$(date -u +%FT%TZ) | $NOME | $IMG" >> "$Z/levas.log"
log "no ar: $NOME"
