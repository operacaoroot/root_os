# ROOT OS — Quickstart (dev)

> Stack isolado do escritório (ver `docs/ISOLATION.md`). Requer **Node ≥ 22**, pnpm 9, Docker.
> O caminho oficial de desenvolvimento é **dados em container, código no host**: Postgres, Redis e
> MinIO pelo compose; API e web com `pnpm dev`. (O README descreve o caminho de container, que é o de
> produção — não misture os dois: as `DATABASE_URL` são diferentes.)

## 1. Subir o stack de dados isolado
```bash
docker compose up -d db redis minio     # Postgres+pgvector(5442) · Redis(6390) · MinIO(9010/9011)
```
Se a 5442 estiver ocupada (um Postgres de teste avulso, por exemplo), mude `DB_PORT` no `.env` da
raiz **e** a `DATABASE_URL` do passo 2.

## 2. Instalar deps + preparar o banco
```bash
pnpm install
cp apps/api/.env.example apps/api/.env    # a única obrigatória é DATABASE_URL; leia os comentários
pnpm bootstrap                            # idempotente: NÃO apaga nada, pode rodar de novo
```
O `bootstrap` faz, na ordem certa: build dos pacotes internos → cliente do Prisma → migrations
(`migrate deploy`) → empresa, papéis, permissões e contas (`db:seed`) → política versionada
(`db:seed:politica`) → permissões dos papéis (`db:sync-permissions`).

Dados de **exemplo** (leads, campanhas, tarefas) são outro comando, porque ele **apaga e recria** —
e por isso só roda em banco cujo nome se anuncia como descartável e com a flag explícita:
```bash
pnpm --filter @mktos/api db:seed:demo -- --sim-apagar
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
  (`openssl rand -base64 24`), ponha em `ADMIN_PASSWORD` no `apps/api/.env` **antes** do primeiro
  `bootstrap` e o seed usa essa ao **criar** a conta. Sem a variável, o seed gera uma senha forte e a
  imprime **uma única vez** — copie dali. Conta que já existe **nunca** muda de senha por causa da
  variável: rotacionar é explícito, `pnpm --filter @mktos/api db:seed -- --rotacionar-senhas`.
- `db:seed` (e o `bootstrap` que o chama) é **idempotente e de preservação exata**: cria só o que
  falta e **não toca** em empresa, papel, permissão, nome ou senha que já existem — nem módulo
  desligado, nem lista vazia, nem permissão tirada de propósito, nem senha, mesmo com
  `ADMIN_PASSWORD` no ambiente. E-mail de conta que pertence a outra empresa faz o seed **parar**.
  Pode rodar em qualquer ambiente. Operações explícitas, fora do bootstrap: rotacionar senhas
  (`db:seed -- --rotacionar-senhas`), realinhar papéis com o catálogo (`db:sync-permissions`, que
  revoga vínculo feito à mão) e dados de exemplo (`db:seed:demo -- --sim-apagar`, que apaga).

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
