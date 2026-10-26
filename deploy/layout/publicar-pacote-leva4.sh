#!/usr/bin/env bash
# PUBLICA O PACOTE leva 4 + integração do cliente (26/10/2026) na PRODUÇÃO, com volta garantida.
#  1. backup completo do banco (antes de tudo)
#  2. troca a imagem pelo publicar-layout.sh (confere que só a imagem muda; volta sozinho se a API cair).
#     A API roda `prisma migrate deploy` na partida: entram só colunas novas e nulas.
#  3. dados da integração com diário (integracao-dados.sql)
#  4. grava o VOLTAR.sh deste pacote (desfaz os dados pelo diário e devolve a imagem anterior)
# Uso: bash publicar-pacote-leva4.sh <imagem>
set -uo pipefail
IMG="${1:?uso: publicar-pacote-leva4.sh <imagem>}"
NOME=pacote-leva4-$(date -u +%Y%m%d-%H%M)
R=/srv/rootos/releases/$NOME
Z=/srv/rootos/releases/ponto-zero-20261026
B=/srv/rootos/bundles
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
psql_prod(){ docker exec -i mktos_db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q "$@"' sh "$@"; }
contar(){ psql_prod -Atc 'select (select count(*) from "WorkTask"),(select count(*) from "Lead"),(select count(*) from "Partner"),(select count(*) from "AcordoComercial")'; }

mkdir -p "$R" && chmod 700 "$R"
ANTES=$(docker inspect -f '{{.Image}}' mktos_api); echo "$ANTES" > "$R/imagem-antes.txt"

log "1. backup do banco"
docker exec mktos_db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$R/banco-antes.dump" || { echo "backup falhou: nada foi mudado"; exit 1; }
sha256sum "$R/banco-antes.dump" > "$R/banco-antes.dump.sha256"
log "backup $(du -h "$R/banco-antes.dump" | cut -f1) · contagens (tarefas|leads|parceiros|acordos): $(contar | tee "$R/contagens-antes.txt")"

log "2. imagem nova"
bash "$Z/publicar-layout.sh" "$IMG" "$NOME-imagem" || { echo "a imagem não ficou de pé e já voltou sozinha; dados não foram tocados"; exit 1; }
M=$(psql_prod -Atc "select count(*) from _prisma_migrations where migration_name like '%integracao_cliente' and finished_at is not null")
log "migration integracao_cliente aplicada: $M"
[ "$M" = 1 ] || { echo "migration não aplicada: confira antes dos dados"; exit 1; }

log "3. dados da integração (com diário)"
cp "$B/integracao-dados.sql" "$B/desfazer-integracao-dados.sql" "$R/"
psql_prod -1 < "$R/integracao-dados.sql" > "$R/dados.log" 2>&1 || { cat "$R/dados.log"; echo "dados recusados: a transação não gravou nada; imagem nova segue no ar (as telas funcionam sem os dados)"; exit 1; }
cat "$R/dados.log"
log "contagens depois: $(contar | tee "$R/contagens-depois.txt")"

cat > "$R/VOLTAR.sh" <<EOF
#!/usr/bin/env bash
# VOLTA o pacote $NOME: desfaz os dados pelo diário (só o que ninguém mexeu depois) e devolve a imagem de antes.
# As colunas novas ficam no banco, vazias e sem uso: o código antigo não as lê. Nada que a equipe criou depois se perde.
set -euo pipefail
docker exec -i mktos_db sh -c 'exec psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q -1' < $R/desfazer-integracao-dados.sql
C=/etc/easypanel/projects/root/marketing-os/code
cd "\$C" && docker compose --project-name root_marketing-os \$(cat /srv/rootos/releases/$NOME-imagem/cadeia-antes.txt) up -d --no-deps --no-build api web
echo "voltou: imagem $ANTES; para o ponto zero de 26/10: bash $Z/voltar-ao-ponto-zero.sh"
EOF
chmod 700 "$R/VOLTAR.sh"
cat > "$R/REPORT.txt" <<EOF
PACOTE leva 4 + integração publicado em $(date -u +%FT%TZ)
Imagem $IMG. Antes: $ANTES. Migration aditiva 20261026200000_integracao_cliente (colunas nulas).
Dados: diário na tabela _diario_integracao_20261026 (antes/depois, linha por linha).
Backup do banco de antes: $R/banco-antes.dump
VOLTAR ESTE PACOTE: bash $R/VOLTAR.sh
VOLTAR AO PONTO ZERO (depois do VOLTAR.sh): bash $Z/voltar-ao-ponto-zero.sh
EOF
echo "$(date -u +%FT%TZ) | $NOME | $IMG | pacote com dados" >> "$Z/levas.log"
log "no ar: $NOME · voltar: bash $R/VOLTAR.sh"
