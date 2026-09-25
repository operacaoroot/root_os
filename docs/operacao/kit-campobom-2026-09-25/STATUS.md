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

Observação: num worktree novo, o typecheck só fica verde depois de 3a, 3b e 3c. Sem eles dá 1.530 erros (Prisma Client ausente) e depois 162 e 47 (pacotes `@mktos/shared` e `@mktos/policy` sem `distribuicao/`). Nenhum código foi alterado para chegar ao verde.

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

**Pré-requisito de worktree novo (vale para toda sessão):** depois de `pnpm install --frozen-lockfile`, rodar `pnpm --filter @mktos/api db:generate`, `pnpm --filter @mktos/shared build` e `pnpm --filter @mktos/policy build` antes de typecheck ou teste. Sem eles, o typecheck da api dá 1.530 erros (Prisma Client ausente) e depois 162 e 47 (`distribuicao/` ausente em `@mktos/shared` e `@mktos/policy`).

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

## 25/09/2026 — bloqueios da revisão da fatia "instalar em Mac limpo"

Commits (locais, sem push): `57633d5` referências versionadas · `5390bba` lsof + ss/netstat · `7715e37` `--modulos` no catálogo.

| # | Bloqueio | Antes (teste novo) | Depois |
|---|---|---|---|
| 1 | `*.docker.log` da regressão caíam no `*.log` do `.gitignore` | `vitest -t 'Regressão VPS'`: exit 1, 1 falha ("referência fora do git", 3 arquivos) | exit 0, 4/4; `git ls-files apps/api/test/fixtures/deploy-referencia` = 9; `git check-ignore` exit 1 (nenhum ignorado) |
| 2 | Linux com `lsof` cego (sem root) devolvia porta livre sem perguntar ao `ss` | `vitest -t 'porta já ouvindo'`: exit 1, 4 falhas | exit 0, 8/8 no bloco |
| 3 | `--modulos` fora do catálogo só falhava no passo 7/10 | `vitest -t '--modulos'`: exit 1, 3 falhas (instalação inteira seguia, exit 0) | exit 0, 5/5 no bloco |

Provas:

| # | Comando | Exit | Contagem |
|---|---|---|---|
| a | procedência dos `.docker.log`: `git archive HEAD` + `deploy/*.sh` de `eba198b` (v0.4.1), sem os `.docker.log`, `vitest -t 'Regressão VPS'`, depois `cmp` do que o teste gravou com os arquivos | 0 (cmp) | 3/3 iguais byte a byte; `.env` e `override.yml` já batiam (só os 3 `.docker.log` acusados como "sem referência") |
| b | checkout limpo (`git clone` do worktree em HEAD `7715e37`) + `vitest run test/deploy-instancia.test.ts` | 0 | 57 passados, 0 falhas, 0 pulados |
| c | checkout limpo em `57633d5` + `deploy/*.sh` de `eba198b` + `vitest -t 'Regressão VPS'` | 0 | 4/4 (a referência versionada é a do v0.4.1) |
| d | `git diff 47d898b HEAD -- fixtures/deploy-referencia/*.env *.override.yml \| wc -l` | 0 | 0 linhas; os 3 `.docker.log` entram como arquivos novos (+44 linhas) |
| e | suíte de deploy no worktree | 0 | 57 passados (eram 50), 0 falhas, 0 pulados, 97,8 s |
| f | `pnpm --filter @mktos/api typecheck` e `typecheck:test` | 0 / 0 | 0 `error TS` / 0 `error TS` |
| g | ferramentas reais deste Mac: `/bin/bash deploy/instalar.sh --ambiente producao --tag v0.4.1 --bind-ip 127.0.0.1 --sem-llm --so-checar` | 1 | recusou as 6 portas (4000/4001 `node`, 5442/6390/9010/9011 `com.docker.backend`), sem linha repetida |
| h | idem, `--ambiente homologacao` | 0 | plano impresso; `~/root-os` não existe depois |

O que mudou:
- `.gitignore`: `!apps/api/test/fixtures/deploy-referencia/*.docker.log`; caso novo confere as 9 referências no git e fora do `.gitignore`.
- `ouvintes_na_porta`: o `lsof` nunca responde sozinho. Em toda porta o complemento (`netstat -an -p tcp` no macOS, `ss` no Linux) é perguntado e entra o endereço que o `lsof` não viu. Com `lsof` presente, complemento ausente ou falhando = falha fechada. Sem `lsof`, o `ss` sozinho, como antes. Stub novo `deploy/test-stubs/sistema/uname` (`STUB_UNAME_S`) e `STUB_LSOF_CEGO=1` no stub de `lsof`; o caso macOS do `netstat` deixou de ser `skipIf` e roda em qualquer sistema.
- `--modulos`: `todos` misturado é recusado (64) na validação de forma; no passo 1, depois das portas e antes de criar qualquer coisa, o catálogo `MODULOS` de `packages/shared/src/nav.ts` da tag é lido de um clone raso temporário (apagado na mesma função) e chave fora dele recusa (64) com a lista das válidas; catálogo ilegível = exit 1, nada criado. Sem `--modulos` ou com `todos`, nenhum clone extra (a referência da VPS não muda). A fixture do teste carrega o `nav.ts` real.

### Não provado nesta etapa
- `ss` real do Linux e `lsof` real sem root numa VPS: o caminho Linux só rodou contra stubs (`uname`, `lsof` cego, `ss`).
- Clone temporário do catálogo contra o GitHub com deploy key: só rodou contra repositório local de fixture. Em rede ruim ele é um ponto a mais de falha (fecha fechado, sem criar nada).
- Instalação real num Colima: segue não provada (este Mac usa Docker Desktop).
- Troca da tag entre o clone temporário e o clone real (segundos de diferença): não coberta; o `provisionar-tenant` continua recusando chave desconhecida no passo 7.

## 25/09/2026 — 2ª revisão da fatia "instalar em Mac limpo": 2 bloqueios + 2 menores

Commits (locais, sem push): `bff3da3` linha do crontab do Mac · `82b00a1` ::1 do lsof × netstat · `3138bf8` `netstat -anl` (menor) · `e8b076e` "nem clone" do `--so-checar` (menor).

| # | Item | Antes (teste novo) | Depois |
|---|---|---|---|
| 1 | Backup no Mac: a linha impressa não tinha PATH; no cron (`PATH=/usr/bin:/bin`) o `backup-db.sh` abortava em "docker não está no PATH" | `vitest -t 'crontab\|linha antiga'`: exit 1, 2 falhas (linha sem agenda nem PATH; erro sem instrução) | exit 0, 2/2. A linha impressa, rodada com `env -i PATH=/usr/bin:/bin HOME=… /bin/sh -c` contra o `deploy/backup-db.sh` real, sai com exit 0 e grava 1 diário + 1 semanal |
| 2 | Porta em `::1` saía duas vezes no macOS (lsof `[::1]`, netstat `::1`), a 2ª com dono falso | `vitest -t 'porta já ouvindo'`: exit 1, 2 falhas (2 linhas para a porta 4000) | exit 0, 9/9 no bloco |
| 3 | (menor) netstat sem `-l` corta IPv6 longo e o cortado não casava com o lsof (bind 0.0.0.0) | `vitest -t 'IPv6 longo'`: exit 1, 1 falha (2 linhas) | exit 0, 1/1 |
| 4 | (menor) `--so-checar` com `--modulos` dizia "nem clone" e depois admitia o clone temporário | `vitest -t 'nem clone'`: exit 1, 1 falha | exit 0, 1/1 |

Provas:

| # | Comando | Exit | Contagem |
|---|---|---|---|
| a | suíte de deploy no worktree (`pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts`) | 0 | 62 passados (eram 57), 0 falhas, 0 pulados |
| b | `pnpm --filter @mktos/api typecheck` e `typecheck:test` | 0 / 0 | 0 `error TS` / 0 `error TS` |
| c | referência da VPS intocada: `git diff 47d898b HEAD -- fixtures/deploy-referencia/*.env *.override.yml \| wc -l` | 0 | 0 linhas; `vitest -t 'Regressão VPS'` verde dentro de (a) |
| d | ferramentas reais: `python3 -m http.server --bind ::1 4100` + `/bin/bash deploy/instalar.sh --ambiente homologacao --tag v0.4.1 --bind-ip 127.0.0.1 --sem-llm --so-checar` | 1 | 1 linha: `porta 4100 (WEB_HOST_PORT) — já ouvindo em [::1]:4100: Python (pid …)`; `~/root-os` não existe depois |
| e | ferramentas reais, IPv6 global de 37 caracteres do en0 na porta 4100, `--bind-ip 0.0.0.0 --dominio x.teste --so-checar`; antes (lib de `82b00a1`) × depois | 1 / 1 | antes 2 linhas (a 2ª com o endereço cortado e "processo de outro usuário"); depois 1 linha, `Python (pid …)` |

O que mudou:
- `instalar.sh`, modo máquina local: o passo 3 imprime uma entrada de crontab inteira numa linha só (`17 3 * * *`), com `PATH='<diretório do docker que o instalador usou>':/usr/bin:/bin`, `DOCKER_HOST` se estava definido, valores entre aspas simples, `%` escapado e saída em `<base>/<amb>/backups/backup.log`; logo abaixo, o comando que roda a linha do `crontab -l` no ambiente do cron e o `tail` do log. A saída da VPS é o texto de antes.
- `backup-db.sh`: o erro de docker fora do PATH mostra o PATH e diz o que pôr na linha do crontab.
- Stub de `docker`: o `pg_dump -w --no-owner` do backup devolve um dump que passa na verificação do `backup-db.sh` (semente fixa). Stub de `netstat`: IPv6 sem colchetes, `tcp6`, e corte a 22 colunas sem `-l`, como o de verdade.
- `lib-instancia.sh`: endereço sem colchetes nas três ferramentas; recusa escreve `[::1]:porta`; `netstat -anl -p tcp`.
- `docs/INSTALACAO.md`: o parágrafo do backup deixou de dizer que a única ressalva é o Mac dormindo; explica o PATH do cron, o log e a prova com `env -i`, e diz que falha de backup não avisa ninguém.

### Não provado nesta etapa
- `crontab` de verdade disparando no horário: a linha foi rodada no ambiente que o cron monta (`env -i`, PATH curto, `/bin/sh`), não pelo `cron` do macOS. Permissão do `cron` em pasta protegida pelo TCC (Documentos, Mesa) não foi medida; a base padrão `~/root-os` fica fora delas.
- `docker exec` real do Colima a partir do cron: o `docker` da prova é o stub. Com Colima por `docker context`, o cron lê o mesmo `~/.docker/config.json` pelo `HOME`; isso não foi exercido (este Mac usa Docker Desktop).
- Saída da VPS no fim da instalação: o texto do passo 3 foi mantido igual por construção, mas não houve diff byte a byte do stdout (a regressão byte a byte cobre `.env`, `override.yml` e as chamadas ao docker).
- `netstat -l` em macOS antigo: medido só neste Mac (Darwin 25.6.0).
- Fora do escopo e não mexido: a linha da VPS usa `\` de continuação, que o crontab não junta; quem cola precisa juntar à mão.
- Pasta do kit no Drive (`kit-rootos-v0.4.2`): não tocada nesta etapa (não existe ainda).

## 25/09/2026 — prova completa, tag v0.4.2, bundle e ensaio no Docker deste Mac

Commits (locais, sem push): `0cb8ced` `--portas` · `77a7f7b` Q-004. Tag anotada `v0.4.2` → `77a7f7b` (objeto `43d234d`).

### 1. Suítes — linha de base (`98d8ed4`, clone limpo) × kit (`77a7f7b`)
Um Postgres `pgvector/pgvector:pg16` descartável por suíte, em `127.0.0.1:5543x`, banco `ckit_<rótulo>_<suíte>_test`; `db:deploy` + `db:seed:politica` antes; forma da CI (`pnpm --filter @mktos/<pacote> test -- --reporter=json`) e a trava `conferir-suite.mjs` extraída do `ci.yml`.

| Suíte | Base: casos/arquivos · falhas · pulados | Kit: casos/arquivos · falhas · pulados | Exit kit |
|---|---|---|---|
| `pnpm typecheck` | 0 `error TS` | 0 `error TS` | 0 |
| `pnpm typecheck:test` | 0 `error TS` | 0 `error TS` | 0 |
| policy | 74/2 · 1 · 0 | 74/2 · 1 · 0 | 1 (Q-004, item 1, herdado) |
| web | 412/31 · 0 · 0 | 412/31 · 0 · 0 | 0 |
| api | 1.809/47 · 0 casos, 1 arquivo (`afterAll`) · 0 | 1.921/52 · 0 casos, 1 arquivo (`afterAll`) · 0 | 1 (Q-004, item 2, herdado) |
| `pnpm test:isolamento` (papel `mktos_app` com senha, `TENANT_DATABASE_URL`) | 319/1 · 0 · 0 | 319/1 · 0 · 0 | 0 |
| `python3 -m unittest discover -s tools/conector-local` | não existe na base | 14 · 0 · 0 | 0 |
| `node tools/ferramentas/test-cli.mjs` | não existe | **não existe** no kit: só nos commits `70ee6b9`/`70c1059` da integra, fora por Q-001 | 1 (arquivo ausente) |

Por arquivo: nenhum arquivo com menos casos que a base; 5 arquivos novos na api (`deploy-instancia` 67, `escritas-internas-pela-porta` 19, `banco-descartavel` 12, `seed-sem-destruicao` 11, `health-version` 3). `rotas-publicas-tenant.test.ts` sozinho: 38/38, exit 0. `pnpm test` literal (turbo): ver Q-004, fato 3.

### `--portas` (`0cb8ced`)
- Por quê: as seis portas de produção deste Mac são da instância local (`--so-checar` sem `--portas`: exit 1, 6 portas recusadas — 4000/4001 `node`, 5442/6390/9010/9011 `com.docker.backend`) e o instalador não tinha como escolher outras.
- `vitest run test/deploy-instancia.test.ts`: exit 0, **67/67** (eram 62), 0 pulados. Os 5 casos novos com o `deploy/` antigo: 5/5 vermelhos. Referência da VPS: `git diff --quiet -- apps/api/test/fixtures` exit 0; `git diff 47d898b -- '*.env' '*.override.yml'` 0 linhas.

### 2. Tag e bundle
- `git bundle create …/bundles/rootos-v0.4.2.bundle root-os/kit-instalacao-mac v0.4.2` → `git bundle verify`: exit 0, 2 refs, "complete history". Recriado depois deste registro (a branch anda com os commits de documentação; a tag não muda).
- Varredura de padrão de segredo na árvore da tag (`git grep` de chaves Anthropic/OpenAI/AWS/GitHub/Google/Slack e chave privada): 0 linhas; nenhum `.env` versionado.

### 3. Ensaio (Docker Desktop deste Mac, clone do bundle na tag, base no scratchpad)
Comando: `/bin/bash deploy/instalar.sh --ambiente producao --base <scratch>/ensaio --repo …/rootos-v0.4.2.bundle --tag v0.4.2 --bind-ip 127.0.0.1 --cliente campo-bom --modulos todos --admin-email ensaio@exemplo.com --sem-llm --portas web=4200,api=4201,db=5452,redis=6392,minio=9020,minio-console=9021`, com `ROOTOS_GOOGLE_CLIENT_ID`/`ROOTOS_GOOGLE_CLIENT_SECRET` sintéticos (obrigatórios com `--cliente`; não são credencial de verdade).

| # | Conferência | Exit | Contagem |
|---|---|---|---|
| a | instalação | 0 | 10/10 passos; imagem `rootos-app:v0.4.2-77a7f7b91bb5`; 0 valores de segredo do `.env` no log |
| b | `curl http://127.0.0.1:4201/api/health` | 0 | HTTP 200 |
| c | `/api/health/versao` | 0 | `v0.4.2` + `77a7f7b91bb566ae74a5388d9917aceb82651d7f` = `git rev-parse v0.4.2^{commit}` |
| d | `SELECT … FROM "Org" WHERE slug='campo-bom'` no banco do ensaio | 0 | 1 org, **11/11** módulos, iguais ao `MODULOS` de `nav.ts`; usuário `ensaio@exemplo.com` criado |
| e | linha do crontab impressa, rodada com `env -i PATH=/usr/bin:/bin` | 0 | 1 diário + 1 semanal, 59.709 bytes, 93 tabelas, 93 blocos de dados, 484 linhas |
| e2 | `gunzip -t` do dump | 0 | íntegro; 93 `CREATE TABLE`, 93 `COPY` |
| e3 | `pg_restore --list` do dump | **1** | "input file appears to be a text format dump": o `backup-db.sh` grava SQL puro (`pg_dump \| gzip`) de propósito; `pg_restore` só lê o formato custom |
| e4 | `backup-db.sh --restore-test` | 0 | restaurado num banco novo `rootos_rt_*`: 93 tabelas; Org 2, User 4, Capability 64, PolicyVersion 1; banco de teste derrubado |
| f | `atualizar.sh --tag v0.4.2` (mesma tag) | 1 | recusa "a instância já está em v0.4.2"; foto antes × depois (hash de `.env`, `override.yml`, `versoes.log`, refs do repo, arquivos da instância, id/início dos 5 containers, imagem): `cmp` exit 0, 12 linhas iguais |
| g | `lsof` + `netstat -anl` nas 6 portas | 0 | 6/6 em `127.0.0.1`; 0 fora dele; `docker inspect` idem |
| h | `http://localhost:4200/login` no navegador | 0 | "ROOT OS · A CENTRAL DE CONTEXTO", botão "Entrar com o Google" e "Entrar com e-mail e senha"; `/`, `/login`, `/entrar` HTTP 200 |

### 4. Colisão
- Outra base, mesmas `--portas`: exit 1, "porta já em uso NO HOST (bind 127.0.0.1)", as 6 portas com variável e dono (`com.docker.backend`), "Nada foi criado."; a base nova não existe depois.
- Mesma base: exit 1, "`<base>/producao` já existe. Instalar é criar; para trocar de versão use deploy/atualizar.sh"; `.env` do ensaio com o mesmo hash.

### 5. Derrubada
`docker compose -p rootos-producao down -v`: exit 0; 0 containers `rootos_prod_*`, 0 volumes `rootos-producao_*`, 0 rede. Containers e volumes que não são do ensaio (22 linhas, inclusive `rootos_local_*` "Up 25 hours"): `cmp` antes × depois exit 0. Os 5 Postgres descartáveis das suítes (`ckit_*`) removidos. A base do ensaio (com `.env` e `segredos-iniciais.txt` de uma instância que não existe mais) foi apagada do scratchpad.

### Não provado nesta etapa
- `pnpm test` exit 0: vermelho herdado da produção `98d8ed4` (Q-004); nenhum teste de produto mudou.
- `node tools/ferramentas/test-cli.mjs`: o arquivo não existe nesta base (Q-001 deixa a integra de fora).
- `pg_restore --list` no dump do `backup-db.sh`: não se aplica ao formato SQL puro; a legibilidade foi provada pelo `--restore-test`.
- Colima: o ensaio rodou no Docker Desktop (`desktop-linux`), não no Colima do Mac da Campo Bom. Encaminhamento de porta do Colima e montagem do `$HOME` na VM não exercidos.
- Login humano (Google ou e-mail e senha): a tela abriu, ninguém entrou.
- LLM: instalado com `--sem-llm`.
- Pasta do kit no Drive (`kit-rootos-v0.4.2`): não tocada nesta etapa.
- A imagem `rootos-app:v0.4.2-77a7f7b91bb5` (2,35 GB) ficou no Docker deste Mac (o `down -v` não apaga imagem); o disco de dados está em 98%.

## 25/09/2026 — Q-004 fechada (decisão do Pedro registrada em DUVIDAS.md)

Commits locais, sem push: `a3739f9` (cherry-pick `-x` de `c9f5784`) · `7f8a762` (resposta da Q-004). Tag anotada `v0.4.2` refeita com `git tag -f -a` → `7f8a762` (objeto `1fe5fcb`; era `43d234d` → `77a7f7b`). `git ls-remote --tags origin v0.4.2`: vazio, a tag nunca foi publicada.

### Suítes (um Postgres `pgvector/pgvector:pg16` por rodada, banco `ckit_<rótulo>_test` em `127.0.0.1:554xx`, `db:deploy` + `db:seed:politica` antes, `conferir-suite.mjs` da CI)
| Rodada | Repo | Exit | Contagem |
|---|---|---|---|
| `pnpm --filter @mktos/policy test` | kit `a3739f9` | 0 | 74/74, 2 arquivos, 0 pulados; `conferir` exit 0 |
| api inteira ×4 | base `98d8ed4` | 0 ×4 | 1.809/47, 0 falha, 0 pulado; 0 `AuditLog_orgId_fkey` |
| api inteira ×4 | kit | 0 ×4 | 1.921/52, 0 falha, 0 pulado; 0 `AuditLog_orgId_fkey` |
| web e depois api, mesmo banco (a ordem do `suite-padrao.sh` da manhã) | base | api 1 | 1.808/1.809: `onboarding.test.ts:1456` "expected null not to be null" |
| idem | kit | api 0 | 1.921/1.921 |
| `rotas-publicas-tenant.test.ts` sozinho | base · kit | 0 · 0 | 38/38 · 38/38 |

- **Q-004 (b) herdado:** `git diff --stat 98d8ed4 HEAD -- apps/api/test/rotas-publicas-tenant.test.ts` → 0 linhas. A falha do `afterAll` apareceu nas duas rodadas da manhã (base e kit, log da base em `…/scratchpad/prova/base/test_api.log:878`) e em nenhuma das 10 de agora. É intermitente: corrida entre arquivos da api em paralelo no mesmo banco. A base mostrou a mesma família de falha em outro arquivo (`onboarding`). Nenhum teste de produto mexido, nenhum timeout aumentado.
- **Q-004 (c) herdado:** `pnpm test` literal (turbo, modo estrito) não foi rodado de novo; segue como no fato 3.

### Diff desde o ensaio
`git diff 77a7f7b HEAD --stat`: 4 arquivos, 90+/2− antes deste registro. Fora de `docs/` e de `*.test.ts`: 0 arquivos (`grep -vE` exit 1). O ensaio não foi repetido: a imagem e o código de runtime são os de `77a7f7b`.

### Bundle
`git bundle create …/root_os/bundles/rootos-v0.4.2.bundle root-os/kit-instalacao-mac v0.4.2` → `git bundle verify` exit 0, 2 refs (`7f8a762` branch, `1fe5fcb` tag), "complete history". Recriado depois deste registro, porque a branch anda com este commit de documentação (a tag não muda). Varredura de padrão de segredo na árvore da tag: 0 arquivos; 0 `.env` versionado.

### Disco do Docker deste Mac (`docker system df`)
| | Imagens | Volumes locais | Build cache | `df -h` livre |
|---|---|---|---|---|
| antes | 51 · 77,74 GB | 285 · 13,59 GB | 30,17 GB | 10 GiB (98%) |
| depois | 50 · 75,66 GB | 272 · 12,65 GB | 30,17 GB | 12 GiB (98%) |

- `docker image rm rootos-app:v0.4.2-77a7f7b91bb5` → exit 0 (`sha256:cb354cda…`, 0 containers a usavam). Nada de prune.
- **Fora do pedido, declarado:** o `docker rm -f` das 13 rodadas acima deixou 13 volumes anônimos (o `pgvector` declara `VOLUME`). Antes de remover, cada um foi conferido: rótulo `com.docker.volume.anonymous`, sem container, criado entre 14:46 e 14:59 de hoje, e o catálogo `global/` de cada um contém o nome `ckit_<rótulo>_test` de uma destas rodadas (13/13). `docker volume rm` dos 13 → exit 0; os volumes voltaram a 272, a contagem de antes desta etapa. O pedido dizia "só a imagem"; estes eram os bancos descartáveis desta própria etapa.
- `rootos_local_*`: 3 containers "Up", intocados.

### Não provado nesta etapa
- `pnpm test` literal exit 0 (Q-004 c, herdado).
- A causa exata da corrida da api (qual arquivo grava `AuditLog` na org padrão durante o `afterAll`) não foi isolada; a correção é tarefa da main, fora do kit.
- `/api/health/versao` com o commit novo `7f8a762`: o ensaio rodou em `77a7f7b` e não foi repetido.
- Pasta do kit no Drive (`kit-rootos-v0.4.2`): continua sem existir; não tocada nesta etapa.

## 25/09/2026 — kit por pasta no Drive montado (`kit-rootos-v0.4.2`)

Pasta (Q-002 autorizada): `Meu Drive/OPERACAO ROOT/clientes/campo-bom/kit-rootos-v0.4.2/`. Escrita só dentro dela. Q-001 a Q-003 já estavam respondidas em DUVIDAS.md; nada reaberto. Q-005 aberta (credenciais do Google; não bloqueia o kit).

Arquivos (7): `rootos-v0.4.2.bundle` · `CLAUDE.md` · `PLANO.md` · `LEIA-ME.md` · `.claude/workflows/campobom-os-instalar.js` · `retorno/LEIA.txt` · `SHA256SUMS` (gerado por último, 6 linhas).

| # | Conferência | Exit | Contagem |
|---|---|---|---|
| a | `shasum -a 256` do bundle copiado × original em `…/root_os/bundles/` | 0 | `9f11dd44…c5188` nos dois |
| b | `git bundle list-heads` | 0 | 2 refs: branch `ba17a81`, tag `v0.4.2` → objeto `1fe5fcb`, `^{commit}` = `7f8a762cda94…` |
| c | `git clone` do bundle da pasta + `checkout --detach v0.4.2` | 0 · 0 | HEAD `7f8a762cda94cb4fa1e299bfab506a6b217469e9`; `status --porcelain` 0 linhas; aviso "remote HEAD refers to nonexistent ref" esperado e documentado no PLANO |
| d | varredura de segredo na árvore da tag (`git grep` chaves Anthropic/AWS/GitHub/Google/Slack/OAuth Google, chave privada) | 1 | 0 linhas; 0 `.env` versionado |
| e | varredura do kit (sem o bundle): nome/e-mail do Pedro, `gmail`, `fullbpo.com`, CNPJ, `R$ <número>`, padrões de chave | 1 | 0 linhas |
| f | workflow: `Date.now`/`Math.random`/`new Date` | 1 | 0 linhas; `meta` avaliado como literal puro (`new Function` sem escopo) |
| g | workflow: harness com `agent()` simulado (`scratchpad/wf/harness.mjs`) | 0 | **19/19 cenários**: verde → 5 agentes; vermelho do portão no código mesmo com agente dizendo "verde" (memória 4 GiB, contexto `desktop-linux`, commit no ar errado, porta fora de 127.0.0.1, 10 módulos, segredo no log); `aguardando_operador` sem pedido vira vermelho; sem `adminEmail` / e-mail inválido / `args` ausente → Instalação para sem chamar agente; agente morto → vermelho; `modo: 'verificar'` pula a Instalação; Relatório roda em todos os 19 |
| h | `shasum -a 256 -c SHA256SUMS` | 0 | 6/6 `OK` |

Decisões de desenho (registradas no PLANO/CLAUDE do kit):
- Instância em `~/RootOS/instancia` (base explícita, dentro do `$HOME`, fora do Drive); código em `~/RootOS/codigo`; logs em `~/RootOS/logs`. O ensaio da tarde usou `--base` explícita também.
- Comando com senha: a pessoa roda na janela dela do Terminal; o Claude mostra, espera e confere por leitura.
- Instalação em segundo plano (`nohup`, exit em arquivo), porque o terminal do Claude corta em 10 min.
- Conta de vazamento: 8 segredos (6 do `.env` + `ADMIN_PASSWORD` e `MCP_SERVICE_PASSWORD`) contra os logs, só contagem.
- Backup provado no ambiente do cron (`env -i`) antes de gravar crontab; crontab, `brew services` e `pmset` com OK.

### Não provado nesta etapa
- O workflow rodando de verdade pela ferramenta Workflow: só o fluxo de controle foi exercido, com `agent()` simulado. Os comandos do PLANO foram conferidos contra `deploy/instalar.sh` e `backup-db.sh` da tag (formato das linhas `portas em`, `[instalar] N/10`, `pronto:`, nome dos containers, `DB_USER`/`DB_NAME`, conteúdo de `segredos-iniciais.txt`), mas não executados em sequência num Mac com Colima.
- `node --check` do workflow como módulo: acusa `return` no topo, que é o formato dos scripts de workflow; o parse foi provado dentro de função assíncrona no harness.
- Que o Google Drive sincroniza a pasta oculta `.claude/` até o Mac da Campo Bom. Sem ela, o LEIA-ME manda seguir o `PLANO.md`.
- Credenciais do Google e URI de redirect (Q-005).
- Tempo de instalação ("1 a 2 horas" no LEIA-ME é estimativa, marcada como tal).
- Colima real, login humano, reinício do Mac: continuam como no ensaio.

## 25/09/2026 — furos do ensaio a frio corrigidos no kit (`kit-rootos-v0.4.2`)

Q-001 a Q-003 já estavam respondidas em DUVIDAS.md (seção "Respostas", 25/09); nada reaberto. Abertas: **Q-006** (contato da FullBPO; bloqueia a entrega à Campo Bom) e **Q-007** (resíduos do produto no bundle; não bloqueia). Escrita só no worktree e na pasta do kit.

### O que mudou, por furo
| # | Furo | Correção |
|---|---|---|
| 1 | rodar de novo depois da Fase 3 dava beco sem saída | a Fase 1 mede o estado da instalação (`nenhuma`, `em_andamento`, `concluida_ok`, `concluida_falha`, `interrompida`, item 10) e o workflow retoma: em andamento só espera, terminada só relê as evidências (exit, 10/10, commit da instância, conta de vazamento), nunca instala por cima. O `modo: 'verificar'` também relê as evidências da Fase 3. Os três OKs são pedidos antes da primeira rodada (CLAUDE.md, PLANO e LEIA-ME) |
| 2 | espera de 1 a 2 h sem mecanismo nem teto; Mac dormindo | cada rodada de espera é um agente que roda `caffeinate -i -t 540 -w <pid>` (volta em até 9 min, sem `sleep`); o laço é do script, teto de 180 min e 60 rodadas, depois `aguardando_operador` retomável; processo morto sem `.exit` = vermelho. A instalação roda dentro de `caffeinate -ims`; a Fase 3 não dispara na bateria (`pmset -g batt`), e o LEIA-ME pede tomada e tampa aberta |
| 3 | rede testava 2 endereços; falha no passo 5 deixava a instância pela metade | 17 endereços (Homebrew, VM do Colima, Docker Hub e CDN, deb.debian.org, npm, binaries.prisma.sh, fontes do Google, login do Google) com `--cacert /etc/ssl/cert.pem` (inspeção de SSL = exit 60 = vermelho) e detecção de proxy. Instalação que não fechou: item 0 da Fase 3, com `okRecomecar`, uma vez, só com 0 containers e 0 volumes, move a tentativa para `~/RootOS/falhas/` (fora da base, para não virar "irmã"); nada é apagado. Corrigido também "etapa 7" → 5 (o build é o passo 5/10 do `instalar.sh`) |
| 4 | PATH do brew fora dos blocos | `export PATH=…` na primeira linha de 11 blocos; guarda no item 4 da Fase 2 (`test -x "$P/docker-compose"` antes de gravar) e no item 8 da Fase 4 (`test -x "$D/docker"`); `lsof`, `netstat`, `sysctl` e `scutil` por caminho completo (fora do PATH davam 0 linhas = verde falso) |
| 5 | sem contato na FullBPO; retorno pelo Drive não conferido | seção "Contato na FullBPO" no LEIA-ME com a marca `PENDENTE (Q-006)` e a Fase 1 reprovando enquanto ela existir; teste de escrita em `retorno/` (vermelho se falhar) e detecção de pasta fora do Drive (relatório à mão ao contato) |
| 6 | o bundle levava o CLAUDE.md interno | o `CLAUDE.md` da raiz do bundle é o contrato da máquina (`distribuicao/CLAUDE.md`); a Fase 2 grava o mesmo em `~/RootOS/CLAUDE.md`, que cobre `~/RootOS/codigo` e `~/RootOS/instancia/producao/repo` |
| 7 | evidências internas, caminhos e histórico no bundle | bundle de distribuição montado por `distribuicao/montar-bundle.sh`: um commit sem pai, só a tag `v0.4.2`, identidade `ROOT OS <release@rootos.invalid>`, árvore de `7f8a762` menos 33 arquivos internos (28 de `docs/operacao/`, `tools/clickup-inventario.py`, 4 docs com caminho do Mac ou de operação) e com `CLAUDE.md` trocado e `.claude/settings.json` novo |
| 8 | docker de leitura liberava segredo; sem trava técnica | CLAUDE.md proíbe `docker inspect`, `docker compose config`, `docker exec … env/printenv/sh/bash/cat`, `docker exec` em api/web/minio/redis, `ps`, e a ferramenta Read/Grep nos arquivos de segredo. `.claude/settings.json` (kit, `~/RootOS/.claude/` e raiz do bundle): 17 `allow` de leitura, 130 `deny` (Read/Edit dos segredos, as formas de docker/ps/env, `cat/head/tail/less/more/open/strings/xxd/base64/cp` nos 3 arquivos em 3 grafias, destrutivos, git remoto, `sudo`) e `disableBypassPermissionsMode: disable`. O LEIA-ME manda aprovar comando um a um, sem "don't ask again" |

### Evidência
| # | Conferência | Exit | Contagem |
|---|---|---|---|
| a | `distribuicao/montar-bundle.sh` duas vezes, áreas novas | 0 · 0 | mesmo sha256 `6ae67cc0…7c31` nas duas; commit `fff7fb9e1da12c382d0b847fce46d12972a37d87`, tag `ad9bbe0` |
| b | `git clone` do bundle do kit + `checkout --detach v0.4.2` + `git -C <clone> bundle verify` | 0 · 0 · 0 | HEAD = `v0.4.2^{commit}` = `fff7fb9…`; `rev-list --all` 1; refs 1; `list-heads` 1 (só a tag); `status --porcelain` 0 |
| c | `git clone --branch v0.4.2 --depth 1` (o que o `instalar.sh` faz) | 0 | HEAD `fff7fb9…` (antes, com o bundle antigo: mesmo aviso "is not a commit", mesmo exit) |
| d | identidades no histórico do bundle | — | 1: `release@rootos.invalid` (autor, committer e tagger) |
| e | `git diff --name-status` árvore `7f8a762` × distribuição | 0 | 33 D, 1 M (`CLAUDE.md`), 1 A (`.claude/settings.json`); nada fora de `docs/`, `tools/clickup-inventario.py`, `CLAUDE.md` e `.claude/` |
| f | varredura da árvore do bundle: `/Users/pedro`, `GoogleDrive-pedro`, IPs das duas VPS, `srv1983380`, `vps-root`, space do ClickUp, `marketin-os-mcp` | 1 | 0 arquivos (o 1 acerto do padrão largo é o nome do grupo de WhatsApp num doc do produto: Q-007) |
| g | varredura de chaves no bundle (sk-ant, AKIA, ghp_, GOCSPX, chave privada, JWT) e `.env` versionado | 1 | 0 · 0 |
| h | varredura do kit sem o bundle: e-mails da equipe, `fullbpo.com`, CNPJ, caminhos, IPs, chaves | 1 | 0 · 0 |
| i | referência a arquivo removido em código que o build lê | — | 0 leituras; 12 linhas citam `docs/PAUTA.md` em comentário ou texto de tela; nenhuma lê o arquivo |
| j | harness do workflow com `agent()` simulado (`distribuicao/harness-workflow.mjs`) | 0 | **32/32 cenários**, entre eles: retomada em andamento sem disparar; concluída sem espera; falha sem OK → aguardando; recomeço com containers antigos → vermelho; segunda falha → vermelho; bateria → aguardando antes de disparar; processo morto → vermelho; 180 min → aguardando; 60 rodadas → aguardando (64 agentes); rede 12/17 com agente dizendo verde → vermelho; proxy; contato pendente; retorno sem escrita; commit antigo `7f8a762` no ar → vermelho |
| k | workflow: `Date.now`/`Math.random`/`new Date` | 1 | 0 |
| l | ensaio do padrão disparar/esperar num `$HOME` falso (`env -i`, PATH curto) | 0 | estado `nenhuma` → `em_andamento` → `concluida_ok`; `caffeinate -t -w` voltou ao fim do processo; `terminou=1 vivo=0` |
| m | guardas do PATH com `env -i PATH=/usr/bin:/bin` | 0 | sem o export: `PARE … /lib/docker/cli-plugins` e `PARE … D=.` (o defeito reproduzido e barrado); com o export: `docker em /usr/local/bin` |
| n | laço de rede do item 11 neste Mac | 0 | 17/17 com curl exit 0 e código ≠ 000; proxy 0 · 0 |
| o | comandos do PLANO × `deny` (casamento por prefixo, aproximação) | 0 | 559 subcomandos, 1 negado: `sudo pmset …`, que a pessoa roda no Terminal dela, de propósito |
| p | exemplos de vazamento do ensaio × `deny` (mesma aproximação) | 0 | 14/14 negados |
| q | `grep -c 'PENDENTE (Q-006)' LEIA-ME.md` | 0 | 1: o kit reprova na Fase 1 até a Q-006 ser respondida |
| r | `shasum -a 256 -c SHA256SUMS` (gerado por último) | 0 | 9/9 `OK` |

### Não provado nesta etapa
- As regras de `.claude/settings.json` numa sessão real do Claude Code: a conferência (o, p) é por prefixo, feita por script; o casamento de verdade do Claude Code (comando composto, aspas, caminho absoluto do binário) não foi exercido. A trava cobre as grafias comuns, não todas; a regra do CLAUDE.md segue sendo a proteção principal.
- Quantos pedidos de permissão a espera gera por rodada (as atribuições `L=…` e o bloco composto podem pedir OK mesmo com os `allow`).
- O workflow rodando de verdade pela ferramenta Workflow, a espera de 1 a 2 h e o `caffeinate` mantendo um MacBook acordado com a tampa aberta: só o fluxo de controle (j) e o padrão num `$HOME` falso (l).
- O processo em segundo plano sobrevivendo ao fim do comando da ferramenta de terminal do Claude.
- Build da imagem a partir da árvore de distribuição `fff7fb9`: não rodado (o disco deste Mac está em 98%); a árvore só difere de `7f8a762` em docs, `tools/` e `.claude/`, que o Dockerfile copia mas o build não lê.
- O item 0 (recomeço) contra uma instância pela metade de verdade.
- Inspeção de SSL e proxy numa rede corporativa: só a lógica, numa rede sem proxy.
- Drive compartilhado só para leitura: a escrita local passa e o envio falha depois; o kit declara, não detecta.
- Contato da FullBPO (Q-006) e o enxugamento do bundle (Q-007).

## 25/09/2026 — Q-007 (b): bundle sem `docs/` e sem as pastas de teste, build provado

Decisões do Pedro de hoje (Q-005 a, Q-006 contato, Q-007 b, marca ROOT) registradas em DUVIDAS.md; aberta **Q-008** (resíduo "FullBPO" no código do produto, com um texto de tela no Financeiro). Escrita só no worktree, no scratchpad e na pasta do kit.

### O que mudou (`c253740`)
- `distribuicao/montar-bundle.sh`, lista `REMOVER`: `docs` (inteira, 89 arquivos), `apps/api/test` (66), `apps/web/tests` (32), `packages/policy/test` (2), `deploy/test-stubs` (8; só serve a `apps/api/test/deploy-instancia.test.ts`, que saiu junto) e, como antes, `CLAUDE.md` e `tools/clickup-inventario.py`. `apps/mcp`/`packages/shared`/`packages/mcp` não têm pasta de teste. Guarda nova: sobrou arquivo `*.test.*`/`*.spec.*` ou pasta `test/`, `tests/`, `__tests__/` na árvore → a montagem para com exit 1.
- `distribuicao/CLAUDE.md` (o contrato que vai na raiz do bundle): 3 menções a FullBPO → Root. A cópia do kit (`rootos-home/CLAUDE.md`) recebeu o mesmo arquivo, para as duas continuarem iguais.
- Build × removidos: o `Dockerfile` faz `COPY . .` e só builda `src/` (api: `tsconfig.build.json` → `include: [src, prisma]`; mcp e shared: `src`; policy: `tsup src/index.ts`; web: `next build`). `vitest.config.ts` e `tsconfig.test.json` citam as pastas só por texto e só servem ao `test`. `deploy/*.sh` não lê `docs/` nem `test-stubs` (0 referências fora de comentário). O kit (PLANO, LEIA-ME, workflow) não cita `docs/` nem teste do repo (grep 0). Nenhum ajuste de build foi preciso.

### Evidência
| # | Conferência | Exit | Contagem |
|---|---|---|---|
| a | `montar-bundle.sh` duas vezes, áreas novas | 0 · 0 | mesmo sha256 `6d7f76bf…cb2f` (2.144.314 bytes; o antigo `6ae67cc0…7c31` tinha 4.118.890); commit `3397140941264725e906334348fe6abe2f6d90ad`, árvore `1101a7f`, tag `3ed4add` |
| b | `git clone` do bundle + `checkout --detach v0.4.2` + `git -C <clone> bundle verify` | 0 · 0 · 0 | HEAD = tag = `3397140…`; `rev-list --all` 1; `list-heads` 1; `status --porcelain` 0; autor, committer e tagger `ROOT OS <release@rootos.invalid>` |
| c | `git diff --name-status` tag `7f8a762` × distribuição | 0 | 198 D (89 `docs/`, 66 + 32 + 2 de teste, 8 `test-stubs`, 1 `tools/`), 1 M (`CLAUDE.md`), 1 A (`.claude/settings.json`); 584 arquivos na árvore |
| d | varredura `grep -riF` na árvore (8 padrões) | 0 | `120363` 0 · `vps-root` 0 · `2.25.223.180` 0 · `31.97.21.167` 0 · `pedro.magnago` 1 arquivo · `fullbpo` 5 · `Cardozo` 4 · `Saggioro` 4 (os mesmos 4). Detalhe abaixo |
| e | espaço antes do build: `df -k /System/Volumes/Data` (o `Docker.raw` do Docker Desktop mora nele) | 0 | 11.736.864 KiB livres (≈ 12,0 GB, acima dos 8 GB); dentro da VM, `/` com 343 GB livres (arquivo esparso: o limite real é o disco do Mac). `docker system df`: imagens 75,66 GB, cache de build 30,17 GB |
| f | `/bin/bash deploy/instalar.sh --ambiente producao --base <scratch>/ensaio --repo <scratch>/rootos-v0.4.2.bundle --tag v0.4.2 --bind-ip 127.0.0.1 --portas web=4200,api=4201,db=5452,redis=6392,minio=9020,minio-console=9021 --cliente campo-bom --modulos todos --admin-email ensaio@exemplo.com --sem-llm`, do clone do bundle novo, em segundo plano, com `ROOTOS_GOOGLE_CLIENT_ID`/`SECRET` sintéticos (valores `ensaio-sintetico…`, não são credencial) | **0** | 10/10 passos; imagem `rootos-app:v0.4.2-339714094126` (2,34 GB) construída da árvore sem `docs/` nem testes; menor espaço livre no build 7.590.288 KiB |
| g | `curl 127.0.0.1:4201/api/health` · `curl 127.0.0.1:4200/` | 0 · 0 | 200 · 200 |
| h | `curl 127.0.0.1:4201/api/health/versao` | 0 | `{"version":"v0.4.2","commit":"3397140941264725e906334348fe6abe2f6d90ad"}` = commit da tag do bundle |
| i | `psql … SELECT slug, cardinality(modulos) FROM "Org" WHERE slug='campo-bom'` · usuário `ensaio@exemplo.com` | 0 · 0 | `campo-bom\|11` (trabalho, relatorios, leads, campanhas, pixels, conteudo, pauta, instagram, bio, metas, financeiro) · 1 |
| j | valores de segredo do `.env` do ensaio (PASSWORD/SECRET/KEY/TOKEN, ≥ 8 caracteres) no log da instalação | 0 | 6 conferidos, 0 no log (só contagem) |
| k | `docker compose -p rootos-producao down -v` | 0 | 5 containers, 3 volumes e a rede `rootos-producao-net` removidos; depois 0 · 0 · 0 |
| l | `docker rmi rootos-app:v0.4.2-339714094126` · `docker rmi node:22-slim` | 0 · 0 | a imagem do ensaio e a base `node:22-slim`, que não existia no Docker antes desta etapa e foi baixada por ela (349 MB) |
| m | foto antes × depois (containers, volumes, redes: `cmp`) | 0 · 0 · 0 | 21 · 274 · 9 linhas iguais; imagens 50 → 50 no `docker system df`, lista igual à de antes do `pull` |
| n | `cp` do bundle para `kit-rootos-v0.4.2/rootos-v0.4.2.bundle` + clone e `bundle verify` do arquivo do kit | 0 · 0 | sha256 do kit = `6d7f76bf…cb2f`; tag → `3397140…`; `CLAUDE.md` do bundle = `rootos-home/CLAUDE.md` (`cmp` 0) |
| o | `shasum -a 256 -c SHA256SUMS` no kit | 1 | 2 FAILED esperados (`rootos-v0.4.2.bundle`, `rootos-home/CLAUDE.md`); **o SHA256SUMS é regerado na fase seguinte** |

### O que sobrou na varredura (d), arquivo e motivo — tudo código do produto, nada removido
| Padrão | Arquivo | Motivo |
|---|---|---|
| `pedro.magnago`, `fullbpo` | `apps/api/prisma/seed-politica.ts:59,64` | comentário: exemplo de autor da política no uso do seed |
| `fullbpo` | `apps/web/src/app/financeiro/page.tsx:443` | **texto de tela** do Financeiro ("plano de contas gerencial FullBPO"); vai à Q-008 por causa da decisão de marca |
| `fullbpo` | `apps/api/prisma/data/plano-contas-fullbpo.ts`, `apps/api/prisma/seed-finops.ts` | nome do template do plano de contas (`TEMPLATE_FULLBPO`) e comentários |
| `fullbpo` | `apps/api/src/events/pixel-tenant.service.ts:27` | comentário que cita o slug de uma empresa |
| `Cardozo`, `Saggioro` | `docker-compose.yml:201`, `.env.example:291`, `apps/api/src/integrations/clickup.service.ts:396` | default de `CLICKUP_IGNORE_TEAMS` (isolamento do ClickUp); é configuração, trocar é mudar o produto |
| `Cardozo`, `Saggioro` | `README.md:8` | frase de isolamento do README |

Os padrões de antes que não estavam nesta lista (`operacao.root@gmail.com`, nomes da equipe) não foram recontados; os testes e os docs que os levavam saíram.

### Não provado nesta etapa
- Build no Colima do Mac da Campo Bom: o ensaio rodou no Docker Desktop deste Mac, como o anterior.
- O `README.md` da raiz ficou com 20 links para `docs/` que não existem mais no bundle; os scripts `test` dos `package.json` rodam o `vitest` sem arquivo. Nenhum dos dois é usado pelo kit nem pelo build.
- O cache de build do Docker cresceu 30,17 → 32,15 GB e o disco do Mac fechou com 9.866.556 KiB livres (tinha 11.736.864): sem prune, por regra. As imagens somam 77,23 GB contra 75,66 GB antes, com a mesma lista; a diferença não foi atribuída a um objeto.
- `SHA256SUMS` do kit: desatualizado de propósito até a fase seguinte (o).
- As menções a FullBPO no LEIA-ME, PLANO, CLAUDE.md do kit, `retorno/LEIA.txt` e no workflow (decisão de marca) e a troca do contato (Q-006): fase seguinte.

## 25/09/2026 — Marca Root, contato (Q-006), credenciais do Google (Q-005 a) e commit novo no kit

Escrita só na pasta do kit (8 arquivos de texto + `SHA256SUMS`) e, no worktree, em `distribuicao/harness-workflow.mjs`, DUVIDAS.md e este arquivo. Cópia dos arquivos antes da mudança no scratchpad da sessão (`kit-antes/`). Bundle, `rootos-home/` e os dois `settings.json` não mudaram.

### O que mudou no kit
- **Marca:** toda menção à FullBPO como empresa responsável virou Root, com a frase ajustada ("a decisão é da Root", "volta para a Root", "contato da Root"). Antes, linhas com "fullbpo" (`grep -ric`): CLAUDE.md 4, LEIA-ME.md 6, PLANO.md 8, `retorno/LEIA.txt` 2, workflow 7. `rootos-home/CLAUDE.md` já não tinha nenhuma e continua igual ao `CLAUDE.md` da raiz do bundle.
- **Contato (Q-006):** `LEIA-ME.md`, seção "Contato na Root" = `Pedro Magnago · pedro.magnago@fullbpo.com`, sem a marca `PENDENTE (Q-006)`. A pasta segue compartilhada com permissão de editar (dito no "Antes de começar").
- **Item 1b do PLANO e `contatoPreenchido`:** a checagem virou `grep -c 'PENDENTE' LEIA-ME.md` → 0 **e** `sed -n '/^## Contato na Root/,/^## /p' LEIA-ME.md | grep -cE '<e-mail>'` → 1 ou mais. O prompt do Inventário diz ao agente como preencher `contatoPreenchido` a partir dessas duas contagens. A mensagem do portão deixou de citar "Q-006" (o kit que vai ao cliente não cita dúvida interna: `grep -c 'Q-00'` → 0 nos 5 arquivos).
- **Credenciais do Google (Q-005 a):** LEIA-ME ("Antes de começar" e "Crie o arquivo google.env") e PLANO (parágrafo novo "Credenciais do Google", Fase 2 item 7, Fase 5 item 5 "Pendências da Root") dizem: a Root cria o cliente OAuth num projeto Google Cloud dela, um só para a Campo Bom e revogável, cadastra a URI de redirect e manda as duas credenciais pelo gerenciador de senhas; a pessoa grava em `~/RootOS/google.env` (0600); o Claude só confere existência, permissão e nomes de variável. O prompt da Fase 2 do workflow manda nunca pedir, aceitar ou repetir os valores no chat.
- **Enxugamento (Q-007 b) × kit:** o bundle novo aponta para `3397140941264725e906334348fe6abe2f6d90ad`, e o kit ainda esperava `fff7fb9…` (PLANO 4 lugares, constante `COMMIT` do workflow): o portão da Fase 3 e o da Fase 4 reprovariam uma instalação certa. Trocado. O parágrafo da distribuição diz que saíram `docs/` e as pastas de teste. A nota do Colima citava "a documentação do instalador" (`docs/INSTALACAO.md`, que não vai mais no bundle) e agora diz "números que a Root usa como ponto de partida". Os scripts que o PLANO roda continuam no bundle: `deploy/instalar.sh`, `deploy/backup-db.sh` (`--restore-test` 4 ocorrências).
- **Harness** (`distribuicao/harness-workflow.mjs`): `COMMIT` novo; guarda de marca (FullBPO no workflow fora do e-mail → exit 3); cenário do contato confere que o prompt do Inventário cita "Contato na Root" e o do Relatório "contato da Root"; cenário novo do prompt do google.env; cenário novo "distribuição anterior `fff7fb9` no ar → vermelho". 32 → 34 cenários.

### Evidência
| # | Conferência | Exit | Contagem |
|---|---|---|---|
| a | `git clone` do bundle do kit + `rev-parse 'v0.4.2^{commit}'` · `rev-list --all \| wc -l` · `git bundle list-heads` | 0 | `3397140941264725e906334348fe6abe2f6d90ad` · 1 · 1 (tag `3ed4add`) |
| b | `grep -ric fullbpo .` na pasta do kit | 0 | 1 linha em 1 arquivo (`LEIA-ME.md:8`, o e-mail do contato); 0 nos outros 8; tirando o e-mail, 0 linhas |
| c | `grep -c fff7fb9` · `grep -c 3397140941264725e906334348fe6abe2f6d90ad` em PLANO e workflow | — | 0 · 0 e 4 · 1 |
| d | item 1b no kit · na cópia de antes · num LEIA-ME sem o e-mail (scratch) | 0 | PENDENTE 0 e e-mail 1 (passa) · 1 e 0 (reprova) · 0 e 0 (reprova) |
| e | `node distribuicao/harness-workflow.mjs <workflow do kit>` | 0 | **34/34** cenários |
| f | mordida: harness no workflow de antes · workflow com `COMMIT` antigo · workflow sem a frase do chat no prompt do google.env | 3 · 1 · 1 | "marca: FullBPO no workflow" · 23/34 · 1 FALHA |
| g | workflow: `Date.now`/`Math.random`/`new Date` · `meta` avaliado como literal | 1 · 0 | 0 · `campobom-os-instalar`, 5 fases |
| h | varredura do kit sem o bundle: chaves (sk-ant, GOCSPX, AKIA, ghp_, chave privada, JWT) · caminhos do Mac e IPs das VPS · e-mails | 1 · 1 · 0 | 0 · 0 · `nome@example.com` ×3 (exemplo) e `pedro.magnago@fullbpo.com` ×1 |
| i | `cmp` `rootos-home/CLAUDE.md` e `rootos-home/settings.json` × `CLAUDE.md` e `.claude/settings.json` da raiz do bundle | 0 · 0 | iguais |
| j | `SHA256SUMS` regerado por último (`find . -type f ! -path ./SHA256SUMS`, `LC_ALL=C sort`, `shasum -a 256`) + `shasum -a 256 -c SHA256SUMS` | 0 · 0 | 9 linhas, **9/9 `OK`**; bundle `6d7f76bf…cb2f` |

### Não provado nesta etapa
- O `grep -ric` não enxerga dentro do bundle (o pack do git é comprimido): o código do produto ainda leva "FullBPO" em 5 arquivos, entre eles o texto de tela do Financeiro. Continua na **Q-008**, aberta.
- A checagem do item 1b só foi exercida por script neste Mac (d); o agente preenchendo `contatoPreenchido` numa sessão real do Claude Code não foi exercido, como o resto do workflow (só o fluxo de controle no harness).
- O cliente OAuth da Root (projeto, URI de redirect cadastrada, revogação) não existe neste kit nem foi conferido: é trabalho da Root fora do kit, e o relatório da Campo Bom lista como "Pendências da Root".
- A pasta compartilhada com a Campo Bom com permissão de editar: decisão registrada, compartilhamento não feito nem conferido nesta etapa.
