# Marketing OS — imagem ÚNICA do monorepo (api + web + mcp).
# Build da RAIZ:  docker build -t mktos-app .
# O docker-compose roda 2 serviços a partir desta mesma imagem, cada um com seu
# `command` (api / web). Um só `pnpm install` + build para todos.
# `packages/mcp` é construído aqui mas não vira serviço: o servidor MCP roda por
# fora (Claude Desktop, `docker run`). O terceiro serviço era o `telegram`, e ele
# foi aposentado na fatia 5.8 — ver a lápide no docker-compose.yml.
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

# Identidade imutável do artefato. O instalador/atualizador injeta a versão e o
# commit no build; a API os publica em GET /api/health/versao. Defaults explícitos
# mantêm o desenvolvimento local funcional sem fingir que ele é uma release.
ARG ROOTOS_VERSION=development
ARG ROOTOS_COMMIT=unknown
ENV ROOTOS_VERSION=${ROOTOS_VERSION}
ENV ROOTOS_COMMIT=${ROOTOS_COMMIT}

# De quem são os eventos de BROWSER da Root Central (RF-T-04) — o `id` da Org
# dona da Central, uuid.
#
# PRECISA SER BUILD ARG, e não só uma linha no bloco `environment:` do compose:
# o Next troca toda `NEXT_PUBLIC_*` pelo VALOR durante o `next build`, e o que
# vai para o navegador é o pacote já compilado. Variável de ambiente do
# container chega tarde demais — o browser nunca a vê. Foi exatamente o que
# deixou o rastreio de browser da Central caindo na empresa PADRÃO depois da
# fatia 1.4, com a variável declarada no compose e sem efeito nenhum.
#
# A irmã dela, `CENTRAL_PIXEL_KEY` (sem `NEXT_PUBLIC_`), é lida NO SERVIDOR pelo
# Route Handler do resgate e por isso vive só no `environment:` do serviço `web`.
# São dois momentos diferentes; confundi-los custa uma tarde.
#
# Vazia é o padrão de propósito: sem chave, o evento cai na empresa padrão, que
# é o comportamento de antes desta fatia. A chave é pública por natureza (quem
# abrir o pacote do browser a lê) — ver `apps/web/src/central/lib/analytics.ts`.
ARG NEXT_PUBLIC_CENTRAL_PIXEL_KEY=
ENV NEXT_PUBLIC_CENTRAL_PIXEL_KEY=${NEXT_PUBLIC_CENTRAL_PIXEL_KEY}

# A marca da instância (apps/web/src/lib/marca.ts). Vazia é a ROOT; `sragranel`
# troca login, casca, título e favicon pela identidade do Sr. aGranel. Mesmo
# motivo da chave acima: só funciona como build arg.
ARG NEXT_PUBLIC_MARCA=
ENV NEXT_PUBLIC_MARCA=${NEXT_PUBLIC_MARCA}

# Copia o monorepo (o .dockerignore já exclui node_modules/dist/.next/.env).
COPY . .

# Instala tudo (com devDeps: precisa de tsc/next/prisma no build e o CLI do
# Prisma no runtime para `migrate deploy`) e builda os pacotes na ordem certa.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mktos/shared build \
 && pnpm --filter @mktos/policy build \
 && pnpm --filter @mktos/api db:generate \
 && pnpm --filter @mktos/api build \
 && pnpm --filter @mktos/mcp build \
 && pnpm --filter @mktos/web build \
 # falha aqui em vez de gerar imagem que sobe e morre: um .ts fora de src/ no
 # build da api desloca a saída para dist/src/ e o CMD abaixo não acha o entry.
 && test -f apps/api/dist/main.js

ENV NODE_ENV=production
EXPOSE 4000 4001

# Default (o compose sobrescreve por serviço).
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
