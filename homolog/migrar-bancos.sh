#!/usr/bin/env bash
# Aplica as migrations nos três bancos da homologação (o da homolog, o de teste e o do isolamento)
# e confere o schema contra o banco de teste. Lê os segredos do .env.homolog, sem imprimir nenhum.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . homolog/.env.homolog; set +a
DONO="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT:-5440}"
for banco in "${DB_NAME}" rootos_comercial_test rootos_comercial_test_rls; do
  echo "== $banco"
  DATABASE_URL="$DONO/$banco" pnpm --filter @mktos/api exec prisma migrate deploy 2>&1 | tail -2
done
echo "== diff (schema x rootos_comercial_test)"
DATABASE_URL="$DONO/rootos_comercial_test" pnpm --filter @mktos/api exec prisma migrate diff --from-url "$DONO/rootos_comercial_test" --to-schema-datamodel prisma/schema.prisma 2>&1 | tail -3
