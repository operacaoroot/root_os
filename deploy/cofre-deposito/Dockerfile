# Patch sobre a imagem publicada; BASE_IMAGE deve corresponder ao commit-base.
ARG BASE_IMAGE=rootos-official:cadastro-1ce14f7
FROM ${BASE_IMAGE}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
WORKDIR /app
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma/migrations/20261104010000_cofre_deposito/ apps/api/prisma/migrations/20261104010000_cofre_deposito/
COPY apps/api/src/cofre-da-empresa/ apps/api/src/cofre-da-empresa/
COPY apps/api/src/scripts/cofre-deposito.ts apps/api/src/scripts/cofre-deposito.ts
COPY apps/api/test/cofre-deposito.test.ts apps/api/test/cofre-deposito-postgres.test.ts apps/api/test/tenant-isolation.test.ts apps/api/test/
COPY apps/web/src/app/cofre/ apps/web/src/app/cofre/
COPY apps/web/src/app/entregar-acessos/ apps/web/src/app/entregar-acessos/
COPY apps/web/src/components/AppShell.tsx apps/web/src/components/AppShell.tsx
COPY apps/web/next.config.mjs apps/web/next.config.mjs
COPY apps/web/tests/component/cofre-deposito.test.tsx apps/web/tests/component/cofre-deposito.test.tsx
RUN export NODE_OPTIONS=--max-old-space-size=4096 \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build \
 && pnpm --filter @mktos/web build
WORKDIR /app/apps/api
