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
