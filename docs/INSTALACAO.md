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

**O painel guarda cópia própria do `.env`.** Depois de cada `deploy/atualizar.sh` (ou `--voltar`), o
script regenera `painel/docker-compose.yml`, diz se ele mudou e lembra de atualizar `ROOTOS_IMAGE`,
`ROOTOS_VERSION` e `ROOTOS_COMMIT` no painel — sem isso, um "Deploy" pelo painel re-sobe a imagem anterior.
A rota (domínio → `bind-ip:porta do web`) continua sendo configurada no Traefik/easyPanel à mão.

## Testes

`apps/api/test/deploy-instancia.test.ts` — hermético: `docker` e `curl` são stubs
(`deploy/test-stubs/bin`), o git é real contra um repositório de fixture com quatro tags. Mede a
ordem das chamadas, o que fica em disco, o que nunca aparece (segredo em stdout/argv), falha fechada
de saúde/identidade/migrations, compatibilidade da imagem anterior com o schema novo e cenários de
interrupção. O último caso valida o override gerado com `docker compose config` real, se houver docker.
