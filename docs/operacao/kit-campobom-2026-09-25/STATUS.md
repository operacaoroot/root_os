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
