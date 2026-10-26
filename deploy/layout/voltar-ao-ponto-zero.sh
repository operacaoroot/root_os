#!/usr/bin/env bash
# VOLTA o ROOT OS para o PONTO ZERO de 26/10/2026 (a tela como estava antes das mudanças de layout).
# Troca só a imagem do api e do web. NÃO restaura o banco: tudo o que a equipe criou depois fica.
# Uso:  bash voltar-ao-ponto-zero.sh            (volta de verdade)
#       bash voltar-ao-ponto-zero.sh --ensaio   (só confere, não reinicia nada)
set -euo pipefail
Z=/srv/rootos/releases/ponto-zero-20261026
C=/etc/easypanel/projects/root/marketing-os/code
DC="docker compose --project-name root_marketing-os"
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
ALVO=$(cat "$Z/imagem.txt")
docker image inspect "$ALVO" > /dev/null || { echo "a imagem do ponto zero $ALVO não existe mais"; exit 1; }
cd "$C"
$DC $(cat "$Z/cadeia-de-volta.txt") config --format json > /tmp/ponto-zero-config.json
/opt/marketing-os/node/bin/node -e '
const c=require("/tmp/ponto-zero-config.json");const a=c.services.api.image,w=c.services.web.image;
if(a!==process.argv[1]||w!==process.argv[1])throw new Error("a cadeia de volta não aponta para a imagem do ponto zero: "+a+" / "+w);
console.log("conferência ok: api e web -> "+a);' "$ALVO"
rm -f /tmp/ponto-zero-config.json
log "no ar agora: $(docker inspect -f '{{.Image}}' mktos_api)"
if [ "${1:-}" = "--ensaio" ]; then log "ensaio: nada foi reiniciado"; exit 0; fi

log "voltando para o ponto zero"
$DC $(cat "$Z/cadeia-de-volta.txt") up -d --no-deps --no-build api web
s=""
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' mktos_api 2>/dev/null || true); [ "$s" = healthy ] && break; sleep 3; done
a=$(docker exec mktos_api node -e 'fetch("http://127.0.0.1:4001/api/health").then(r=>console.log(r.status)).catch(()=>console.log(0))')
log "api: $s · health $a · imagem $(docker inspect -f '{{.Image}}' mktos_api)"
echo "$(date -u +%FT%TZ) voltou ao ponto zero (api $s, health $a)" >> "$Z/voltas.log"
