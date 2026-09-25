# STATUS — kit Root OS Campo Bom (append-only)

Worktree: `/Users/pedro/orca/workspaces/root_os/campobom-kit` · branch `root-os/kit-instalacao-mac` · base `98d8ed4` (25/09/2026 00:00, "O link do cliente sem travessão", contida em `origin/main`).

## 25/09/2026 — fase 0 (preparo e linha de base)

| # | Passo | Comando | Exit | Contagem |
|---|---|---|---|---|
| 1 | fetch no canônico | `git -C ~/Library/Projetos/root_os fetch` | 0 | `98d8ed4` existe (tipo commit) |
| 2 | worktree | `git worktree add .../campobom-kit -b root-os/kit-instalacao-mac 98d8ed4` | 0 | caminho não existia antes |
| 3 | dependências | `pnpm install --frozen-lockfile` (pnpm 9.15.9, node 22.15.0) | 0 | 603 pacotes adicionados, 583 reusados, lockfile intacto |
| 3a | pré-requisito do typecheck | `pnpm --filter @mktos/api db:generate` | 0 | Prisma Client gerado (sem banco) |
| 3b | pré-requisito do typecheck | `pnpm --filter @mktos/shared build` | 0 | dist/ ignorado pelo git |
| 3c | pré-requisito do typecheck | `pnpm --filter @mktos/policy build` | 0 | dist/ ignorado pelo git |
| 4a | teste de deploy | `pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts` | 1 | **0 arquivos**: "No test files found" — ver Q-001 |
| 4b | typecheck da api | `pnpm --filter @mktos/api typecheck` | 0 | 0 `error TS` (antes de 3a–3c: exit 2, 1.530 erros) |
| 4c | typecheck dos testes | `pnpm --filter @mktos/api typecheck:test` | 0 | 0 `error TS`; 52 entradas em `apps/api/test/` |

Observação: num worktree novo, o typecheck só fica verde depois de 3a, 3b e 3c. Sem eles dá 1.530 erros (Prisma Client ausente) e depois 162 e 47 (pacotes `@mktos/shared` e `@mktos/policy` sem `dist/`). Nenhum código foi alterado para chegar ao verde.

### Não provado nesta fase
- Teste de deploy de instância: o arquivo não existe na base `98d8ed4` (Q-001). Linha de base de deploy **ausente**.
- Suíte completa da api (`vitest run`): não rodada; exige banco de teste descartável, que ainda não foi criado.
- Build da web e da imagem Docker: não rodados.
- Pasta do kit no Drive: não existe (Q-002).

## 25/09/2026 — fase 0, continuação (base = 98d8ed4 + v0.4.1)

Respostas de Q-001, Q-002 e Q-003 registradas em `DUVIDAS.md` (commit `9c2481a`).

| # | Passo | Comando | Exit | Contagem |
|---|---|---|---|---|
| 5 | checagem do merge | `git merge-tree --write-tree HEAD v0.4.1` | 0 | sem conflito; `70c1059` fora da tag (`merge-base --is-ancestor` → 1) |
| 6 | merge | `git merge --no-ff v0.4.1` | 0 | commit `eba198b`; 15 commits trazidos, 78 arquivos, +6.017 / −246; 8 arquivos com auto-merge, 0 conflitos |
| 6a | dependência nova? | `git diff HEAD^1 HEAD -- package.json apps/api/package.json pnpm-lock.yaml` | 0 | só scripts novos (`bootstrap`, `db:seed:demo`); lockfile sem mudança; nenhuma dependência nova |
| 7 | dependências | `pnpm install --frozen-lockfile` | 0 | lockfile intacto; pnpm removeu 134 pacotes órfãos do node_modules; `git status` limpo |
| 7a | pré-requisito | `pnpm --filter @mktos/api db:generate` | 0 | Prisma Client gerado |
| 7b | pré-requisito | `pnpm --filter @mktos/shared build` | 0 | dist/ (ignorado pelo git) |
| 7c | pré-requisito | `pnpm --filter @mktos/policy build` | 0 | dist/ (ignorado pelo git) |
| 8a | teste de deploy | `pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts` | 0 | 1 arquivo, **34 testes passados**, 0 falhas, 0 pulados, 53,6 s |
| 8b | typecheck da api | `pnpm --filter @mktos/api typecheck` | 0 | 0 `error TS` |
| 8c | typecheck dos testes | `pnpm --filter @mktos/api typecheck:test` | 0 | 0 `error TS`; 57 entradas em `apps/api/test/` (eram 52) |

**Pré-requisito de worktree novo (vale para toda sessão):** depois de `pnpm install --frozen-lockfile`, rodar `pnpm --filter @mktos/api db:generate`, `pnpm --filter @mktos/shared build` e `pnpm --filter @mktos/policy build` antes de typecheck ou teste. Sem eles, o typecheck da api dá 1.530 erros (Prisma Client ausente) e depois 162 e 47 (`dist/` ausente em `@mktos/shared` e `@mktos/policy`).

Nota de procedência: a tag `v0.4.1` aponta para `0b5cf62` (17/09/2026 16:24), um commit depois de `d7ac2f6`; `d7ac2f6` é ancestral da tag.

### Não provado nesta etapa
- Suíte completa da api (`vitest run`): não rodada; exige banco de teste descartável.
- `deploy-instancia.test.ts` roda com stubs de `docker`/`curl` (`deploy/test-stubs/`) e com `docker compose config` real no caso P1; não instala nada num Colima de verdade.
- Build da web e da imagem Docker: não rodados.
- Pasta do kit no Drive: autorizada (Q-002), ainda não criada.
