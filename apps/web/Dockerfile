# Marketing OS — Web (Next.js). Build a partir da RAIZ do monorepo:
#   docker build -f apps/web/Dockerfile -t mktos-web .
# NOTA: rascunho de deploy — ainda não construído/testado nesta fase.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mktos/shared build \
 && pnpm --filter @mktos/web build

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/apps/web
EXPOSE 4000
CMD ["node", "node_modules/.bin/next", "start", "-p", "4000"]
