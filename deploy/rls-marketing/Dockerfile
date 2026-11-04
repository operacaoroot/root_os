# A imagem base é o digest publicado. Preserva o web de Lucas; esta release altera a API/MCP.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
WORKDIR /app
COPY apps/api/src/ apps/api/src/
COPY apps/api/prisma/ apps/api/prisma/
COPY apps/api/package.json apps/api/tsconfig*.json apps/api/
COPY apps/api/test/ apps/api/test/
COPY apps/api/scripts/ apps/api/scripts/
COPY apps/api/vitest.config.ts apps/api/
COPY packages/mcp/src/ packages/mcp/src/
COPY packages/mcp/test/ packages/mcp/test/
COPY packages/mcp/package.json packages/mcp/
RUN export NODE_OPTIONS=--max-old-space-size=4096 \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build \
 && pnpm --filter @mktos/mcp build
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
