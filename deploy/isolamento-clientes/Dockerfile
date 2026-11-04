ARG BASE_IMAGE=rootos-official:etapa5-7396c26
FROM ${BASE_IMAGE}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
WORKDIR /app
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma/migrations/20261104020000_isolamento_clientes/ apps/api/prisma/migrations/20261104020000_isolamento_clientes/
COPY apps/api/src/clientes-escopo/ apps/api/src/clientes-escopo/
COPY apps/api/src/cofre-da-empresa/ apps/api/src/cofre-da-empresa/
COPY apps/api/src/app.module.ts apps/api/src/app.module.ts
COPY apps/api/src/auth/auth.controller.ts apps/api/src/auth/jwt-auth.guard.ts apps/api/src/auth/
COPY apps/api/src/tenants/modulos.ts apps/api/src/tenants/modulos.ts
COPY apps/api/src/scripts/cofre-deposito.ts apps/api/src/scripts/cofre-classificar-deposito.ts apps/api/src/scripts/
COPY apps/web/src/app/cofre/ apps/web/src/app/cofre/
COPY apps/api/test/ apps/api/test/
RUN export NODE_OPTIONS=--max-old-space-size=4096 \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build \
 && pnpm --filter @mktos/web build
WORKDIR /app/apps/api
