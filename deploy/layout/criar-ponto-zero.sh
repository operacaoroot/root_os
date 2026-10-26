#!/usr/bin/env bash
# PONTO ZERO do ROOT OS (26/10/2026): guarda o estado que está no ar antes das mudanças de layout.
# Só lê e copia: não reinicia nada, não muda imagem, não mexe no banco.
set -euo pipefail
Z=/srv/rootos/releases/ponto-zero-20261026
C=/etc/easypanel/projects/root/marketing-os/code
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
[ -e "$Z" ] && { echo "$Z já existe: o ponto zero não é sobrescrito"; exit 1; }
mkdir -p "$Z" && chmod 700 "$Z"

# 1. imagem: o id exato que roda no api e no web, e uma etiqueta própria para não ser apagada
API=$(docker inspect -f '{{.Image}}' mktos_api)
WEB=$(docker inspect -f '{{.Image}}' mktos_web)
[ "$API" = "$WEB" ] || { echo "api e web com imagens diferentes ($API x $WEB): pare e confira"; exit 1; }
docker tag "$API" rootos-official:ponto-zero-20261026
echo "$API" > "$Z/imagem.txt"
printf 'services:\n  api:\n    image: %s\n  web:\n    image: %s\n' "$API" "$API" > "$Z/ponto-zero-images.yml"
log "imagem $API etiquetada como rootos-official:ponto-zero-20261026"

# 2. configuração: a cadeia de arquivos do compose que está no ar, lida do próprio container
docker inspect mktos_api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  | tr ',' '\n' | sed 's/^/-f /' | tr '\n' ' ' > "$Z/cadeia.txt"
for f in $(tr ' ' '\n' < "$Z/cadeia.txt" | grep -v '^-f$' | grep -v '^$'); do [ -f "$f" ] || { echo "arquivo da cadeia sumiu: $f"; exit 1; }; done
echo "$(cat "$Z/cadeia.txt") -f $Z/ponto-zero-images.yml" > "$Z/cadeia-de-volta.txt"
cd "$C"
docker compose --project-name root_marketing-os $(cat "$Z/cadeia.txt") config > "$Z/compose-no-ar.yml"
log "cadeia com $(grep -o -- '-f ' "$Z/cadeia.txt" | wc -l) arquivos; compose resolvido em compose-no-ar.yml"

# 3. banco: cópia completa, com conferência
docker exec mktos_db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$Z/banco.dump"
sha256sum "$Z/banco.dump" > "$Z/banco.sha256"
docker exec -i mktos_db pg_restore --list < "$Z/banco.dump" > /dev/null && log "banco: $(du -h "$Z/banco.dump" | cut -f1), dump lido de volta sem erro"

# 4. contagens para comparar depois
docker exec mktos_db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from \"WorkTask\"),(select count(*) from \"Lead\"),(select count(*) from \"User\"),(select count(*) from _prisma_migrations)"' > "$Z/contagens.txt"
log "contagens (tarefas|leads|usuários|migrations): $(cat "$Z/contagens.txt")"
date -u +%FT%TZ > "$Z/criado-em.txt"
log "ponto zero pronto em $Z"
