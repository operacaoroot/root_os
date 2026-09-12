# Marketing OS — Quickstart (dev)

> Stack isolado do escritório (ver `docs/ISOLATION.md`). Requer Node ≥ 20, pnpm 9, Docker.

## 1. Subir o stack de dados isolado
```bash
docker compose up -d db redis minio     # Postgres+pgvector(5442) · Redis(6390) · MinIO(9010/9011)
```

## 2. Instalar deps + preparar o banco
```bash
pnpm install
pnpm --filter @mktos/shared build        # gera dist consumido por api/web
cp apps/api/.env.example apps/api/.env 2>/dev/null || true   # ver DATABASE_URL (porta 5442)
pnpm --filter @mktos/api db:generate
pnpm --filter @mktos/api db:migrate       # aplica a migration init
pnpm --filter @mktos/api db:seed          # cria admin + dados de exemplo
```

## 3. Rodar
```bash
# terminal 1 — API (http://localhost:4001/api)
pnpm --filter @mktos/api dev
# terminal 2 — Web (http://localhost:4000)
pnpm --filter @mktos/web dev
```

## 4. Entrar
- Web: http://localhost:4000
- Usuário dev: **admin@marketing-os.local**
- Senha: **não existe senha padrão, e nenhuma entra em arquivo versionado.** Gere a sua
  (`openssl rand -base64 24`), ponha em `ADMIN_PASSWORD` no `.env` **antes** do `db:seed` do passo 2
  e o seed usa essa. Sem a variável, o seed gera uma senha forte e a imprime **uma única vez** na
  saída — copie dali. Reseed sem `ADMIN_PASSWORD` **não** troca a senha de quem já existe: para
  rotacionar, defina a variável e rode o seed de novo. Ver `.env.example`.
- **Só em desenvolvimento.** `db:seed` não é idempotente e apaga dados da org — nunca em produção.

## O que já funciona (Fase 1)
- Login JWT + RBAC (26 permissões, 6 perfis); sidebar filtra módulos por permissão.
- Dashboard com cards **clicáveis** (dados reais do Postgres) → drill-down em Leads.
- Leads: lista filtrável (period/status) → ficha do lead com UTMs e histórico.
- Ingestão de eventos do pixel: `POST /api/events/track` (dedup por `event_id`).
- Auditoria de login; `/api/health` (checa o banco).

## Notas
- **API dev** usa `ts-node-dev` (o `tsx`/esbuild não emite metadata de decorator → quebra a DI do Nest).
- Produção da API: `pnpm --filter @mktos/api build && node apps/api/dist/main.js`.
- Dockerfiles de api/web existem como **rascunho de deploy** (ainda não construídos/testados).
