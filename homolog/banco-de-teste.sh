#!/usr/bin/env bash
# Cria (se faltar) um banco de teste descartável no Postgres da homologação (5440),
# aplica as migrations e semeia a política. Uso: homolog/banco-de-teste.sh rootos_interface_u4_test
# O nome precisa conter "test" (a trava de apps/api/test/banco-de-teste.ts). Não imprime segredo.
set -euo pipefail
cd "$(dirname "$0")/.."
banco="${1:?nome do banco}"
case "$banco" in *test*) ;; *) echo "o nome precisa conter test" >&2; exit 1;; esac
set -a; . homolog/.env.homolog; set +a
DONO="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT:-5440}"
docker exec rootos_comercial_db psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$banco'" | grep -q 1 \
  || docker exec rootos_comercial_db psql -U "$DB_USER" -d postgres -qc "CREATE DATABASE \"$banco\""
DATABASE_URL="$DONO/$banco" pnpm --filter @mktos/api exec prisma migrate deploy 2>&1 | tail -1
DATABASE_URL="$DONO/$banco" pnpm --filter @mktos/api db:seed:politica 2>&1 | tail -1
echo "TEST_DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@127.0.0.1:${DB_PORT:-5440}/$banco"
