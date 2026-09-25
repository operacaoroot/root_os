# Instalar e atualizar uma instância do ROOT OS

> Etapa P1 do `docs/PLANO-PRODUTO.md`. Uma instância por cliente, na VPS dele (ADR-013: o código
> chega por `git clone`/`checkout` de **tag**). Produção e homologação são **duas instâncias
> inteiras** — banco, credenciais, containers, rede e portas próprios. Nada é compartilhado.

## Instalar

```sh
# numa VPS com docker, git e openssl; NUNCA passe segredo em argumento — só no ambiente
export ROOTOS_ANTHROPIC_API_KEY='…'            # ou ROOTOS_OPENAI_API_KEY; ou --sem-llm
export ROOTOS_GOOGLE_CLIENT_ID='…' ROOTOS_GOOGLE_CLIENT_SECRET='…'   # obrigatórias com --cliente
deploy/instalar.sh --ambiente producao   --tag v0.3.0 --dominio os.cliente.com.br \
    --bind-ip 172.16.0.1 --cliente acme --admin-email dono@cliente.com.br
deploy/instalar.sh --ambiente homologacao --tag v0.3.0 --dominio homolog.cliente.com.br --bind-ip 172.16.0.1
```

O que fica em `/srv/root-os/<ambiente>/`: `repo/` (checkout destacado na tag), `.env` (0600, gerado),
`override.yml` (nomes, rede, `image:<tag>-<commit>`, portas **só** no IP interno), `versoes.log`,
`segredos-iniciais.txt` (0600 — a senha de `admin@marketing-os.local`; guarde e apague), `backups/`,
`vault/`.

- **Segredos gerados** (`DB_PASSWORD`, `JWT_SECRET`, `AUTH_SECRET`, `ENCRYPTION_KEY`, S3) vão direto
  ao `.env`; nada é impresso. `COFRE_*` nascem vazias (válido; rotação é operação posterior).
- **O que não se gera** é pedido e validado: domínio, chave de LLM, credenciais do Google. O admin do
  cliente (`--admin-email`) **entra pelo Google** e não tem senha; sem `ROOTOS_GOOGLE_*` a instalação
  com `--cliente` é recusada, porque o dono não conseguiria entrar.
- **Isolamento**: nomes e portas distintos entre irmãs no mesmo diretório-base são exigidos e
  recusados em conflito. `--bind-ip` é o `docker0` desta VPS (`ip -4 addr show docker0`) — na VPS
  ROOT é `172.16.0.1`, não o `172.17.0.1` de outras.
- **Manual, e o script diz no fim**: a rota do Traefik/easyPanel (`domínio → bind-ip:porta-web`), a
  URI de redirect no console do Google, o crontab do backup.

## Instalar num Mac (Colima)

Alvo: o Mac do cliente, com o Docker rodando dentro do Colima e as portas **só no loopback**
(`127.0.0.1`). Ninguém fora da máquina alcança a instância; não há domínio, Traefik nem easyPanel.

**Pré-requisitos no Mac** (uma vez): Colima, o cliente `docker` com o plugin `compose` (v2), `git`
e `openssl`. `lsof` e o `/bin/bash` 3.2 já vêm no macOS — os scripts foram escritos para esse bash
e a suíte os roda por ele.

```sh
brew install colima docker docker-compose   # o brew imprime como registrar o plugin compose (cliPluginsExtraDirs)
colima start --cpu 2 --memory 4 --disk 40   # números sugeridos, não medidos: o build da imagem é o pico
docker compose version                      # tem de responder; é a primeira coisa que o instalador confere
```

**Instalar** (de um clone do repositório; o instalador clona a tag de novo dentro da base):

```sh
export ROOTOS_GOOGLE_CLIENT_ID='…' ROOTOS_GOOGLE_CLIENT_SECRET='…'   # obrigatórias com --cliente
export ROOTOS_ANTHROPIC_API_KEY='…'                                 # ou --sem-llm
deploy/instalar.sh --ambiente producao --tag <tag> --bind-ip 127.0.0.1 \
    --cliente campobom --admin-email dono@cliente.com.br --modulos financeiro,relatorios
deploy/instalar.sh --ambiente producao --tag <tag> --bind-ip 127.0.0.1 --sem-llm --so-checar   # só o plano
```

O que muda com `--bind-ip 127.0.0.1` (qualquer `127.x` conta como máquina local):

- **`--dominio` é opcional.** Sem ele, `WEB_ORIGIN`, `PUBLIC_BASE_URL` e `PUBLIC_BIO_ORIGIN` são
  `http://localhost:<porta do web>` (4000 em produção, 4100 em homologação) e o callback do Google é
  `http://localhost:<porta do web>/api/google/callback` — é essa a URI que se autoriza no console do
  Google. Com `--dominio`, vale `https://<domínio>` como na VPS.
- **`--painel` é recusado** (exit 64): easyPanel é da VPS.
- **A base padrão é `~/root-os`**, não `/srv/root-os`: no macOS a raiz do disco é só leitura e o
  Colima só monta o `$HOME` dentro da VM (é lá que o `vault/` da instância é lido). Não aponte
  `ROOTOS_BASE` para dentro do Google Drive nem do iCloud: o `.env` e os segredos iniciais iriam
  junto na sincronização. O `atualizar.sh` acha `~/root-os` sozinho quando `/srv/root-os` não existe.
- Nada da VPS entra: nem `docker-compose.vps.yml`, nem `IP_DOCKER_HOST`; o override gerado binda as
  seis portas em `127.0.0.1` e a saúde é conferida em `http://127.0.0.1:<porta da api>`.
- `--modulos <a,b,c|todos>` vai ao `provisionar-tenant` da empresa do cliente; sem a flag, `todos`
  (o comportamento de sempre). Exige `--cliente`; lista vazia é recusada, e `todos` não se mistura
  com outras chaves. A lista é conferida no passo 1, antes de criar qualquer coisa, contra o
  catálogo da própria tag (`MODULOS` em `packages/shared/src/nav.ts`, lido de um clone raso
  temporário que é apagado em seguida): chave fora dele recusa com a lista das válidas. Sem
  conseguir ler o catálogo, a instalação não segue.

**Porta ocupada no Mac.** Antes de criar qualquer coisa, o instalador pergunta ao host quem ouve
cada uma das seis portas, e recusa dizendo porta, variável e processo. No Colima isso importa mais que na VPS: o container sobe dentro da VM e o encaminhamento
para o Mac falha **calado** se a porta do Mac já estiver tomada. Com bind no loopback, um programa
ouvindo em `::1` também conta, porque o navegador tenta `::1` primeiro em `localhost`. Sem root,
o `lsof` só enxerga processos do próprio usuário (no Linux, o `docker-proxy` do root some). Por isso
ele nunca responde sozinho: em toda porta o instalador pergunta também ao `netstat` (macOS) ou ao
`ss` (Linux), que veem todos os ouvintes, e junta as duas respostas. Sem esse complemento
respondendo, a instalação para — não saber se a porta está livre não conta como livre.

**Backup:** o fim da instalação imprime a linha inteira para o `crontab -e` do usuário (uma linha
só: o crontab não junta linhas terminadas em `\`). O cron do macOS roda com `PATH=/usr/bin:/bin` e
sem nada do perfil do shell, e o `docker` do brew (`/opt/homebrew/bin`) ou do Docker Desktop
(`/usr/local/bin`) fica de fora. Sem ajuste, o `backup-db.sh` aborta todo dia com "docker não está no
PATH", e o erro vai para o mail local, que ninguém lê. Por isso a linha impressa já vem com:

- `PATH=<diretório do docker que o instalador usou>:/usr/bin:/bin`;
- `DOCKER_HOST=…`, se ele estava definido na instalação (Colima configurado pelo perfil do shell, e
  não por `docker context`);
- a saída em `<base>/<ambiente>/backups/backup.log`, ao lado dos dumps.

Depois de colar a linha, prove no ambiente do cron com o comando que o instalador imprime logo
abaixo dela (`env -i PATH=/usr/bin:/bin HOME="$HOME" /bin/sh -c "…"`, que roda a própria linha do
`crontab -l`) e confira `tail -3 <base>/<ambiente>/backups/backup.log`: tem de terminar em
`[backup] pronto:`. Duas ressalvas continuam valendo. O cron não roda com o Mac dormindo, então o
dump do dia depende de o Mac estar acordado no horário. E ninguém é avisado quando o backup falha:
alguém precisa olhar o `backup.log` (ou `deploy/backup-db.sh --listar`) de tempos em tempos.

## Atualizar

```sh
deploy/atualizar.sh --ambiente producao --tag v0.4.0 --so-checar   # o que faria
deploy/atualizar.sh --ambiente producao --tag v0.4.0
deploy/atualizar.sh --ambiente producao --voltar                    # runtime na versão anterior
```

Ordem, e o que cada passo protege: **compatibilidade** (tag existe; toda migration aplicada existe
na tag — senão é downgrade; todo `${VAR}` sem default do compose novo está no `.env`) → **backup**
(`deploy/backup-db.sh`) → checkout destacado com `ferramentas/` conferida por checksum (ADR-014) →
build com tag **imutável** `rootos-app:<tag>-<commit>` usando um override temporário (a instância não
é tocada) → **ensaio**: `pg_dump | psql` para `rootos_ensaio_*`, `migrate deploy` e smoke nele com a
imagem nova, seguido de smoke da **imagem anterior sobre o schema novo** (sem essa compatibilidade a
volta automática seria falsa e a atualização para antes de tocar no banco real) → `migrate deploy`
no banco real (**ponto sem volta do schema**; o dump é a volta do dado)
→ `db:seed:politica` → **o corte**, transacional: backup do `.env` e do `override.yml`, `trap`
armado, três chaves de versão gravadas, `up -d --no-build api web`, saúde, versão no ar; qualquer
falha ou sinal antes da saúde **restaura os dois arquivos e re-sobe a imagem anterior**.

O aceite de saúde é fechado: HTTP 200 com `status=degraded` não serve. O endpoint
`/api/health/versao` precisa responder exatamente a `version` **e** o `commit` esperados; ausência ou
divergência dispara a recuperação, em vez de deixar uma versão apenas “registrada” como se estivesse
comprovadamente no ar.

**O que a atualização nunca toca:** vault, backups, `ferramentas/`, e qualquer chave do `.env` além de
`ROOTOS_VERSION`, `ROOTOS_COMMIT` e `ROOTOS_IMAGE`.

**O que não existe e está dito por extenso:** rollback de schema. `--voltar` e a volta automática
trocam o **runtime**; o banco fica com as migrations da versão nova. Se a versão antiga não conviver
com o schema novo, restaure o dump que o script indica (`deploy/backup-db.sh --restore-test` ensaia
num banco descartável antes).

## easyPanel (VPS ROOT: "nada fora do painel")

Na VPS ROOT a regra é que todo serviço nasça como serviço Compose do easyPanel. O painel roda cada
serviço com `-p <projeto>_<serviço>`, a partir de um `docker-compose.yml` **próprio** (o dele, não o do
repo) e de um `.env` que ele escreve do campo de ambiente — medido na produção em 17/09/2026:
projeto `root_marketing-os`, arquivos em `/etc/easypanel/projects/root/marketing-os/code/`.

`--painel <projeto>/<serviço>` faz a instância nascer com esse nome de projeto (é dele que saem os
nomes dos volumes) e gera `<instância>/painel/docker-compose.yml`: o compose da tag fundido com o
override de isolamento por `docker compose config --no-interpolate` — **sem `build:`** (o painel não tem
o código) e com `image: ${ROOTOS_IMAGE}` **por variável** (senão cada atualização exigiria recolar o
arquivo, e um "Deploy" esquecido subiria a versão anterior). O script recusa gravar o arquivo se sair
`build:`, se a imagem não vier por variável ou se algum valor do `.env` tiver sido interpolado.

```bash
ROOTOS_BASE=/srv/rootos deploy/instalar.sh --ambiente homologacao --tag v0.4.0 --dominio homolog.cliente.com.br \
  --bind-ip 172.16.0.1 --painel root/rootos-homologacao --sem-llm
```

Depois, no painel: projeto `root` → serviço Compose `rootos-homologacao` → colar `painel/docker-compose.yml`
e, no campo de ambiente, o conteúdo do `.env` da instância → Deploy. Como o projeto é o mesmo
(`root_rootos-homologacao`), o painel **adota** containers, rede e volumes já existentes.
O `web` entra também na rede externa `easypanel` com o alias `<projeto>_web` — é por esse nome que o
Traefik do painel roteia os domínios (`http://root_rootos-homologacao_web:4000/`); a aba Domains do
serviço passa a funcionar sem rota à mão. A rede `easypanel` precisa existir no host (existe onde há painel).

**O painel guarda cópia própria do `.env`.** Depois de cada `deploy/atualizar.sh` (ou `--voltar`), o
script regenera `painel/docker-compose.yml`, diz se ele mudou e lembra de atualizar `ROOTOS_IMAGE`,
`ROOTOS_VERSION` e `ROOTOS_COMMIT` no painel — sem isso, um "Deploy" pelo painel re-sobe a imagem anterior.
A rota (domínio → `bind-ip:porta do web`) continua sendo configurada no Traefik/easyPanel à mão.

## Testes

`apps/api/test/deploy-instancia.test.ts` — hermético: `docker`, `curl`, `lsof`, `ss` e `netstat` são stubs
(`deploy/test-stubs/bin`), o git é real contra um repositório de fixture com quatro tags, e os
scripts rodam pelo `/bin/bash` explícito (no macOS, o 3.2 do cliente). Uma checagem estática recusa
recurso de bash 4+ e ferramenta só do GNU. A **regressão da VPS** compara byte a byte o `.env`, o
`override.yml` e a sequência de chamadas ao docker de três instalações de VPS com a referência do
v0.4.1 em `apps/api/test/fixtures/deploy-referencia/` (com `openssl` determinístico,
`deploy/test-stubs/deterministico/`); divergência grava a saída nova em
`$TMPDIR/deploy-referencia-atual/` para comparar. Mede a
ordem das chamadas, o que fica em disco, o que nunca aparece (segredo em stdout/argv), falha fechada
de saúde/identidade/migrations, compatibilidade da imagem anterior com o schema novo e cenários de
interrupção. O último caso valida o override gerado com `docker compose config` real, se houver docker.
