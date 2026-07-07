# Marketing OS — imagem ÚNICA do monorepo (api + web + telegram + mcp).
# Build da RAIZ:  docker build -t mktos-app .
# O docker-compose roda 3 serviços a partir desta mesma imagem, cada um com seu
# `command` (api / web / telegram). Um só `pnpm install` + build para todos.
# Isolamento: nada aqui compartilha rede/volume/porta com o escritório C&S.
FROM node:22-slim

# openssl é exigido pelo Prisma; corepack ativa o pnpm fixado no packageManager.
RUN corepack enable \
 && apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# O proxy /api do Next é resolvido em BUILD time (routes-manifest). No compose, a
# web fala com o serviço `api` pela rede isolada — então bakeamos esse destino.
ARG API_PROXY_TARGET=http://api:4001
ENV API_PROXY_TARGET=${API_PROXY_TARGET}

# Copia o monorepo (o .dockerignore já exclui node_modules/dist/.next/.env).
COPY . .

# Instala tudo (com devDeps: precisa de tsc/next/prisma no build e o CLI do
# Prisma no runtime para `migrate deploy`) e builda os pacotes na ordem certa.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mktos/shared build \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build \
 && pnpm --filter @mktos/mcp build \
 && pnpm --filter @mktos/telegram build \
 && pnpm --filter @mktos/web build

ENV NODE_ENV=production
EXPOSE 4000 4001

# Default (o compose sobrescreve por serviço).
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
