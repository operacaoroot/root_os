# Deploy do ROOT OS na VPS

> Como o código chega no servidor, como se sobe uma versão sem derrubar o que está no ar, e as
> armadilhas que já custaram produção. Para a virada específica do módulo Link na bio (domínio,
> Traefik, migração de dados), o histórico está em [DEPLOY_BIO.md](DEPLOY_BIO.md).
>
> Onde roda: VPS, stack compose `marketing-os` em `/srv/marketing-os/`, containers `mktos_api` e
> `mktos_web`, atrás do Traefik do easyPanel.

---

## 1. Como o código chega na VPS hoje

**Por Syncthing, sincronizando o repositório inteiro entre o Mac e `/srv/marketing-os` — inclusive
o diretório `.git`.** Não existe `git pull` no servidor, nem rsync, nem pipeline. O que existe é
uma pasta espelhada.

Três consequências que não são teóricas:

1. **Trocar de branch no Mac altera o working tree da VPS.** O `git checkout` reescreve os arquivos
   de trabalho; o Syncthing replica a reescrita. O servidor não "muda de branch" — ele recebe os
   arquivos do branch que você abriu, sem que nada no servidor registre isso.
2. **O `.env` viajava nos dois sentidos.** O `.stignore` só ignorava `.env.bak.*`. O `.env` de
   produção era copiado para o Mac (proibição 10 das constraints), e o `.env` do Mac podia
   sobrescrever o do servidor — que é o caminho mais curto para derrubar a API. **Isso foi
   fechado:** o `.stignore` agora ignora `.env` e `.env.*`, com exceção do `.env.example`.
3. **O `.git` continua sincronizado, de propósito.** Ignorá-lo conserta o item 1 e quebra o único
   caminho pelo qual o código chega no servidor. A substituição é decisão humana em aberto — **N-9**
   em [PLANO-CONTINUIDADE.md](PLANO-CONTINUIDADE.md), fatia 0.0.

Enquanto a N-9 não for decidida: **nenhum `git checkout` de branch no Mac com o Syncthing ligado.**

### As duas opções em aberto para substituir o Syncthing

| | (a) `git pull` de `origin/main` na VPS | (b) rsync explícito dentro do `deploy/up.sh` |
|---|---|---|
| Como funciona | `/srv/marketing-os` vira um clone de verdade; o deploy começa por `git fetch && git checkout <tag>` | O `up.sh` roda no Mac e empurra os arquivos para o servidor antes de chamar o compose |
| A favor | O servidor passa a ter versão identificável (`git rev-parse HEAD`); rollback de código é `checkout` da tag anterior; auditável | Não exige chave de deploy nem acesso do servidor ao GitHub; o repositório continua fechado (ADR-006) |
| Contra | Exige credencial de leitura do repositório na VPS, e o núcleo é fechado no V1 | Continua dependendo da máquina de quem faz o deploy; sem versão registrada no servidor |
| O que muda no repo | `deploy/up.sh` ganha o passo de `fetch/checkout`; `.stignore` ganha `.git` | `deploy/up.sh` ganha o `rsync -a --delete --exclude` correto; `.stignore` ganha `.git` |

Em qualquer das duas, o `.stignore` passa a ignorar `.git` — não antes, ou o servidor congela na
última versão que recebeu.

---

## 2. O deploy correto, passo a passo

Tudo abaixo roda **na VPS**, em `/srv/marketing-os`.

### 2.0 Antes de começar

- [ ] O que vai subir passou pela CI (`.github/workflows/ci.yml`) — typecheck, testes e a prova de
      que o histórico de migrations aplica do zero.
- [ ] Se há migration nova, ela já aplicou num Postgres descartável. `prisma migrate deploy` roda no
      `command` do container da api: **migration que falha derruba a API** (§3).
- [ ] Variável nova? Ela está em **dois** lugares: o bloco `environment:` do serviço em
      `docker-compose.yml` **e** o `.env`. Só o primeiro chega no container.
- [ ] Backup do banco do dia existe (§4).

### 2.1 Marcar a imagem atual como rollback

```bash
docker tag mktos-app:latest mktos-app:rollback
```

Este é o passo que mais dói ter pulado. A imagem anterior é o rollback; sem a tag, ela vira lixo na
próxima poda.

### 2.2 Construir a imagem nova

```bash
cd /srv/marketing-os
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api
```

A imagem é **única** para api, web, telegram e mcp (ver `Dockerfile`): construir `api` já produz a
imagem que a `web` vai usar. O build falha de propósito se `apps/api/dist/main.js` não existir.

### 2.3 Smoke na imagem, antes de trocar o que está no ar

```bash
docker run --rm --network marketing-os-net \
  -e DATABASE_URL='postgresql://<user>:<senha>@db:5432/<banco_descartavel>' \
  -e PAUTA_CRON=off \
  -e BIO_SYNC_INTERVAL_MIN=0 -e BIO_BRIDGE_INTERVAL_MIN=0 \
  -e CLICKUP_SYNC_INTERVAL_MIN=0 -e ASAAS_SYNC_INTERVAL_MIN=0 \
  -e PLUGGY_SYNC_INTERVAL_MIN=0 -e OBSIDIAN_REINDEX_MIN=0 \
  -w /app/apps/api mktos-app pnpm smoke
```

O smoke (`apps/api/scripts/smoke-boot.mjs`) sobe o `dist/main.js` compilado e espera o Nest
anunciar que iniciou. Ele existe porque em 29/08/2026 a produção caiu por dois minutos com
`tsc --noEmit` limpo e 130 testes verdes: o grafo de injeção do Nest não é visível para o
TypeScript, e o vitest não o cobre (o esbuild não emite `emitDecoratorMetadata`).

**Aponte para um banco descartável, nunca para o de produção.** O boot liga os cronômetros de
sincronização; uma segunda instância contra o banco vivo dispara coleta, espelho e escrita em
conector. Daí o `PAUTA_CRON=off` e os intervalos em zero acima.

Na VPS o descartável é um banco criado ao lado, no mesmo Postgres — o padrão já usado na virada da
bio:

```bash
docker exec mktos_db psql -U mkt -d postgres -c 'CREATE DATABASE smoke_test;'

# 1) ensaio da migration: prova que o histórico aplica do zero, longe da produção
docker run --rm --network marketing-os-net -w /app/apps/api \
  -e DATABASE_URL='postgresql://<user>:<senha>@db:5432/smoke_test' \
  mktos-app pnpm exec prisma migrate deploy

# 2) o smoke, apontando para o mesmo banco (com os crons desligados, como acima)

docker exec mktos_db psql -U mkt -d postgres -c 'DROP DATABASE smoke_test;'
```

Os dois passos juntos cobrem as duas formas de a subida morrer: a migration que não aplica e o
grafo de injeção do Nest que não resolve. Nenhum dos dois encosta no banco vivo.

### 2.4 Subir

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-build api web
```

O `--no-build` é o que garante que sobe **a imagem que passou no smoke**, e não uma reconstruída na
hora. O `command` do serviço `api` roda `prisma migrate deploy` antes do `node dist/main.js`.

Equivalente pelo script: **`deploy/up.sh --vps --no-build api web`**. Sem `--no-build` o script
constrói (é o padrão dele), e aí sobe uma imagem reconstruída na hora — não a que passou no smoke.
As flags vêm antes dos nomes de serviço; flag depois de nome de serviço o script recusa, de
propósito, para que um `--vps` fora de lugar não vire "nome de serviço" e publique o banco em
`0.0.0.0`.

### 2.5 Conferir

```bash
docker compose ps                                   # api e web em healthy
docker compose logs --tail=80 api                   # migrate deploy + "porta em modo OBSERVAR"
curl -s -o /dev/null -w '%{http_code}\n' https://os.operacaoroot.com/painel
curl -s -o /dev/null -w '%{http_code}\n' https://os.operacaoroot.com/central
curl -s -o /dev/null -w '%{http_code}\n' https://bio.operacaoroot.com/@pedromagnago
```

As três superfícies públicas — painel, `/central` e a bio — saem do mesmo `mktos_web`. Uma quebra na
web derruba as três.

### 2.6 Rollback

```bash
docker tag mktos-app:rollback mktos-app:latest
cd /srv/marketing-os
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-build api web
```

Rollback de imagem **não desfaz migration**. Se a versão nova migrou o banco, a anterior precisa
conviver com o esquema novo — é por isso que toda migration é aditiva primeiro (coluna nullable →
backfill → NOT NULL na migration seguinte).

---

## 3. Armadilhas

**`--vps` não é opcional.** Ele soma o `docker-compose.vps.yml`, que binda as portas em
`172.17.0.1` — só o Traefik alcança. Sem ele, o compose base publica em `0.0.0.0` e **expõe banco,
Redis e MinIO na internet**: o ufw não governa porta publicada pelo Docker, e a regra `DOCKER-USER`
não cobre a faixa 4000–9011. O arquivo não é override automático de propósito: se fosse, o Mac o
carregaria sozinho e o painel sumiria do localhost.

**`docker restart` não troca variável de ambiente.** O ambiente é fixado na criação do container.
Trocar `GATEWAY_MODO` (ou qualquer outra) exige recriar:
`up -d --no-build api`. E `GATEWAY_MODO` é lido no **construtor** do `ToolGateway` — o valor vale
para o processo inteiro, não por requisição. Isso vale nos dois sentidos: é assim que se liga o
`impor`, e é assim que se volta para `observar` num incidente.

**O container não lê arquivo `.env`.** Só chega o que está listado no bloco `environment:` do
serviço no `docker-compose.yml`. Preencher no `.env` uma variável ausente daquele bloco não faz
nada — foi o que segurou a `ANTHROPIC_API_KEY` por semanas. O `.env` da raiz serve ao compose para
interpolar `${VAR}`; é o arquivo que o `merge-env.sh` edita (caminho fixo `/srv/marketing-os/.env`,
só roda na VPS).

**`prisma migrate deploy` roda no `command` do container da api.** Migration que falha não deixa
uma API degradada: deixa a API **fora do ar**, em loop de restart. Toda migration passa antes por um
Postgres descartável e pela CI.

**Na VPS, o `deploy/up.sh --vps` não injeta `~/.config/root/*.env` — e isso é proposital.** Variável
de ambiente vence o `.env`: o `bio-secrets.env` do servidor guarda a `ENCRYPTION_KEY` **antiga** do
root-bio (tokens cifrados parariam de abrir) e o default do vault aponta para um caminho que não
existe no servidor (o bind mount falha e a API não sobe).

**O compose exige `MCP_SERVICE_PASSWORD` e `MCP_ACTION_PASSWORD` (`:?`) mesmo sem o telegram.** A
interpolação é do arquivo inteiro: sem elas, **nenhum** comando compose funciona no servidor. Já
estão no `.env` da VPS; se sumirem, todo comando volta a falhar de saída.

**Dump de banco fora de `/srv/marketing-os`.** O repositório inteiro é sincronizado; um dump lá
dentro vira uma cópia do banco de produção viajando para todo mundo que sincroniza.

---

## 4. Backup do banco

**Backup do banco.** `deploy/backup-db.sh` tira o dump diário, promove o primeiro bom de cada
semana ISO e mantém 7 diários mais 4 semanais em `BACKUP_DIR` (default `/root/backups/root-os`,
fora de `/srv/marketing-os` porque o repositório é sincronizado por Syncthing). Senha nunca no
arquivo: vem de `DATABASE_URL` ou das variáveis do libpq; na VPS use `BACKUP_DB_CONTAINER=mktos_db`
com `PGUSER` e `PGDATABASE`, que conecta pelo socket de dentro do container e não expõe nada na
lista de processos do host. Duas entradas no crontab do root: backup às 3h17 diário e
`--restore-test` às 4h40 de segunda.

O `--restore-test` restaura o dump mais novo num banco **criado por ele** (nome gerado, marcado com
um comentário no próprio banco), confere que as tabelas de `BACKUP_TABELAS_CHAVE` têm linha e
derruba o banco no fim. **Ele só derruba banco que ele mesmo criou e marcou**, e recusa rodar
contra host não-local ou sem espaço em disco medido com folga. Se sobrar banco de teste (falha com
`BACKUP_MANTER_RESTORE=1`), toda execução seguinte avisa, e `--limpar-restos` derruba.

O backup diário sai **vermelho** quando o dump não tem linha de dado ou encolheu mais de 50% contra
o anterior — nesse caso o arquivo é mantido para inspeção, porque descartar transformaria um alarme
em perda de backup. Monitore o código de saída: verde significa "restaurou e tinha dado dentro",
não "o arquivo existe".

**O cron da VPS não deve mais definir `BACKUP_RESTORE_DB`** — a variável virou motivo de erro
explicativo, porque escolher o nome do banco de destino era a porta para apagar o banco errado.

**O que ainda falta:** cópia off-site. Backup no mesmo disco do banco não sobrevive a perder a VPS.

---

## 5. Checklist de uma subida

1. [ ] CI verde na revisão que vai subir
2. [ ] Migration nova aplicada antes num Postgres descartável
3. [ ] Variável nova no `environment:` do compose **e** no `.env`
4. [ ] Backup do dia existe
5. [ ] `docker tag mktos-app:latest mktos-app:rollback`
6. [ ] `docker compose -f docker-compose.yml -f docker-compose.vps.yml build api`
7. [ ] Smoke na imagem, contra banco descartável, com os crons desligados
8. [ ] `up -d --no-build api web`
9. [ ] `docker compose ps` + logs + as três superfícies públicas respondendo
10. [ ] Registrar o que subiu (commit/tag) — enquanto o Syncthing for o transporte, isso não fica
    registrado sozinho no servidor
