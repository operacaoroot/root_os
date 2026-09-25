#!/usr/bin/env bash
# STUB do deploy/backup-db.sh que entra no repositório de FIXTURE dos testes:
# só deixa um dump com o nome que o script real deixaria.
set -euo pipefail
: "${BACKUP_DIR:?}" "${BACKUP_DB_CONTAINER:?}"
mkdir -p "$BACKUP_DIR/diario"
printf 'dump sintético\n' | gzip > "$BACKUP_DIR/diario/rootos-$(date +%Y%m%d-%H%M%S)-$$.sql.gz"
echo "[backup-stub] dump em $BACKUP_DIR/diario"
