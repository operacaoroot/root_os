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

## 25/09/2026 — fatia "instalar em Mac limpo" (base de frota)

Commits (locais, sem push): `47d898b` regressão VPS · `51ecda8` bash 3.2 · `63fe594` modo local · `eacfc2a` porta no host · `14c551d` `--modulos` · `34ad9eb` netstat · `e47376b` tipo no teste · `cc1107c` docs.

| # | Passo | Comando | Exit | Contagem |
|---|---|---|---|---|
| 1 | referência da VPS gravada ANTES do código | `vitest run test/deploy-instancia.test.ts -t 'Regressão VPS'` | 0 | 3 cenários (produção+painel+cliente, homologação+painel, produção no bind padrão) × 3 arquivos (`.env`, `override.yml`, chamadas ao docker) = 9 referências em `apps/api/test/fixtures/deploy-referencia/`; 2 rodadas seguidas iguais |
| 2 | referência intocada depois das mudanças | `git diff 47d898b HEAD -- apps/api/test/fixtures/deploy-referencia \| wc -l` | 0 | 0 linhas |
| 3 | suíte de deploy completa | `pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts` | 0 | 50 passados, 0 falhas, 0 pulados (eram 34), 93,6 s |
| 4 | typecheck da api | `pnpm --filter @mktos/api typecheck` | 0 | 0 `error TS` |
| 5 | typecheck dos testes | `pnpm --filter @mktos/api typecheck:test` | 0 | 0 `error TS` |
| 6 | porta no host, ferramentas reais deste Mac | `/bin/bash deploy/instalar.sh --ambiente producao --tag v0.4.1 --bind-ip 127.0.0.1 --sem-llm --so-checar` | 1 | recusou as 6 portas (4000/4001 `node`, 5442/6390/9010/9011 `com.docker.backend` da instância local `rootos_local_*`); base não criada |
| 7 | idem, homologação | mesmo comando com `--ambiente homologacao` | 0 | plano impresso: portas 4100–9013 em 127.0.0.1, endereço `http://localhost:4100`; nada criado |

O que entrou:
- Scripts rodam no `/bin/bash` explícito (3.2 neste Mac); checagem estática de recurso de bash 4+ e de ferramenta só do GNU em instalar, atualizar, lib, backup-db e stubs.
- `--bind-ip 127.x` = máquina local: `--dominio` opcional (sem ele, `WEB_ORIGIN`/`PUBLIC_BASE_URL`/`PUBLIC_BIO_ORIGIN` = `http://localhost:<web>` e callback do Google em `http://localhost:<web>/api/google/callback`), `--painel` recusado, base padrão `~/root-os`; o `atualizar.sh` acha `~/root-os` quando `/srv/root-os` não existe.
- Porta ouvindo no host recusa antes de criar qualquer coisa: `lsof` (macOS) → complemento `netstat` só no Darwin (o `lsof` sem sudo não vê outro usuário: medido neste Mac, 1 ouvinte em 127.0.0.1 só apareceu no `netstat`) → `ss` (Linux). `LSOF`, `SS` e `NETSTAT` stubáveis. Sem ferramenta, falha fechada.
- `--modulos <lista|todos>` repassado ao `provisionar-tenant`; sem a flag, `--modulos todos` (na referência byte a byte).
- `docs/INSTALACAO.md`: seção "Instalar num Mac (Colima)".

Incidentes desta fatia, corrigidos:
- A suíte passou de 60 s e o vitest saiu com exit 1 e `Timeout calling "onTaskUpdate"` com os 47 casos verdes (todo caso é `spawnSync`, o worker não atendia o RPC). Correção: `setImmediate` num `beforeEach`; nenhum timeout aumentado. O commit `eacfc2a` foi refeito (`--amend`, local) para não registrar passo vermelho.
- `eacfc2a` entrou sem rodar `typecheck:test` (TS2345 no array de cenários); corrigido em `e47376b`.

### Não provado nesta fatia
- Instalação real num Colima: este Mac usa Docker Desktop (`docker context` = `desktop-linux`), não Colima. O encaminhamento de porta do Colima, o bind mount de `~/root-os/<amb>/vault` e o build da imagem na VM não foram exercidos.
- Login com Google em `http://localhost:<web>` (cookie de sessão em http no Safari, URI de redirect aceita pelo console) não foi testado.
- `ss` e `netstat` reais do Linux: o caminho `ss` só rodou contra stub (não há `ss` neste Mac).
- `--modulos` com chave fora do catálogo: a recusa depende do provisionamento (`provisionar-tenant.ts`), não rodado aqui.
- Pasta do kit no Drive (`kit-rootos-v0.4.2`): não tocada nesta fatia.
- Recusa por irmã em conflito continua deixando `<base>/<amb>/.env` para trás (comportamento anterior, fora do escopo).
