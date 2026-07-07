# Marketing OS — API (NestJS). Build a partir da RAIZ do monorepo:
#   docker build -f apps/api/Dockerfile -t mktos-api .
# NOTA: rascunho de deploy — ainda não construído/testado nesta fase.
FROM node:22-slim AS build
RUN corepack enable && apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mktos/shared build \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build

FROM node:22-slim AS run
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/apps/api
EXPOSE 4001
CMD ["node", "dist/main.js"]
