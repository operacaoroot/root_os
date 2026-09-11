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

**Duas travas de arranque novas (onda 6) derrubam a API se um módulo sumir do `AppModule`.** As duas
são deliberadas, e as duas foram provadas em 11/09/2026 patchando o `dist` e rodando o smoke:

- `ToolGateway.onModuleInit` **recusa subir sem o `TetoDeCustoIaService`**, que vem do `LlmModule`
  (global). Sem ele, o teto de custo de IA por empresa (RF-G-05) simplesmente não seria imposto —
  e em silêncio, que é o problema. Mensagem: `ToolGateway subiu sem TetoDeCustoIaService`.
- `InterruptoresRegistry.onApplicationBootstrap` **recusa subir se ninguém se inscreveu** no
  registro de interruptores. Quem se inscreve é `ConectoresService.onModuleInit`, do
  `IntegrationsModule`. Sem a inscrição, desligar um conector voltaria a apenas REGISTRAR a
  decisão, sem barrar chamada nenhuma — com a tela de Conexões dizendo que recusa. Mensagem:
  `A aplicação subiu sem ninguém inscrito no InterruptoresRegistry`. A conferência é em
  `onApplicationBootstrap` e não em `onModuleInit` porque o módulo da porta é `@Global` e
  inicializa antes do de integrações.

Nos dois casos o conserto é o mesmo: o módulo dono voltou a ser importado no `AppModule`? O smoke
compilado (`pnpm --filter @mktos/api smoke`) pega as duas antes do deploy — o typecheck não, porque
TypeScript não enxerga o grafo de injeção do Nest.

**Desligar um conector passou a BARRAR de verdade (RF-G-06, onda 6).** Até esta onda, desligar
gravava a decisão e só o ClickUp era efetivamente recusado. Agora a porta pergunta ao interruptor
logo depois de conferir o escopo do agente, e `AcoesService.executarAprovada` pergunta de novo antes
de soltar uma ação já aprovada — sem o segundo, uma aprovação criada **antes** do desligamento ainda
sairia depois dele. A recusa é 403 com frase em português e código `conector_desligado`, e a tela da
pauta oferece o caminho para `/conexoes`. **O que continua aberto**: o caminho HTTP direto (pessoa
clicando na tela, fora do laço do agente) para Google, Meta e WhatsApp — o ClickUp já pergunta. É
fatia própria, e a tela não promete o que não cumpre.

**O teto de custo recusa modelo fora da tabela de preço — mudança de comportamento visível.** Com
`TetoDeCustoIa.ativo` ligado para uma empresa, uma chamada cujo modelo não esteja em
`apps/api/src/llm/preco.ts` é **recusada**, não estimada em zero. Isso atinge em cheio o provider
`openrouter`, cujo modelo padrão (`anthropic/claude-sonnet-4.5`) não casa com a tabela. Empresa
**sem** linha de teto e empresa com o teto **desligado** seguem passando: o regime novo é o preço de
ter ligado o teto, não um padrão imposto a todo mundo. Conserto: cadastre o preço do modelo, ou
desligue o teto daquela empresa.

**A retenção do RASTRO passou a ser por empresa.** `RASTRO_RETENCAO_DIAS` deixou de ser a palavra
final e virou **o chão**: vale quando a política não disser nada e a empresa não tiver linha em
`RastroRetencao`. A ordem é `RastroRetencao.dias` → `politica.retencao.rastroDias` →
`RASTRO_RETENCAO_DIAS` → 1825. O expurgo é um comando próprio
(`pnpm --filter @mktos/api expurgo:rastro`, que roda **compilado**), varre empresa por empresa
abrindo o contexto de cada uma — para não precisar de exceção na lista de chamadores de plataforma
— e **grava o evento `rastro.expurgo` dentro da mesma transação que apaga**, em SQL. Apagar por
retenção também é evento.

**Depois desta onda, rode `db:seed:politica` em produção — e ele vai PEDIR ASSINATURA.** O delta do
catálogo subiu para `1.2.0` com **62 capacidades** (as duas novas são `conector.desligar` e
`conector.religar`). A política que vale em runtime é a do BANCO: sem o seed, a `PolicyVersion` ativa
continua no documento de 60 e as duas capacidades novas não aparecem na tela da Régua. As rotas de
desligamento **não** param por isso — elas são guardadas por permissão (`admin.usuarios`), não pela
porta —, mas o catálogo fica mentindo sobre o que o OS sabe fazer.

O seed **recusa rodar sozinho** aqui, e está certo: capacidade não declarada valia R5, então
acrescentá-la em R3/R4 é **afrouxar**, e afrouxar exige decisão de gente (RF-P-06). A recusa sai
assim:

```
ACRESCENTA capacidade que a base do banco ainda não classifica — 2 item(ns):
  conector.desligar: capacidade nova em R3 (não declarada valia R5)
  conector.religar:  capacidade nova em R4 (não declarada valia R5)
Nada foi semeado.
```

Quem assina põe o próprio nome e o motivo, que ficam **gravados na versão**:

```bash
POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>' \
POLITICA_CAPACIDADE_NOVA_MOTIVO='<a decisão escrita>' \
  pnpm --filter @mktos/api db:seed:politica
```

Como conferir depois: a linha de boot `política base vN carregada DO BANCO (N capacidades)` precisa
dizer **62**. Ensaiado em 11/09/2026 nos três bancos descartáveis — `2 criadas, 60 atualizadas, 62
no total`.

**Antes do merge desta onda, rode `deploy/janela-horaria-ilegivel.sql` no banco de produção.**
A fatia 2.3 mudou, de propósito, o que acontece quando `limitesPadrao.janelaHoraria` de uma política
está ilegível: antes o sinal `fora_da_janela` ficava calado, agora ele **acende**. Acender sobe um
degrau na régua e nunca bloqueia sozinho — mas sobe em **toda ação** daquela empresa. A consulta
lista as políticas ativas com janela ilegível. Zero linha significa que a mudança é inócua; uma
linha com `orgId` nulo é a política BASE, e afeta todas as empresas. Se aparecer alguma, a escolha é
humana: consertar o documento ou segurar a mudança.

**Tabela criada à mão no servidor faz a migration do isolamento abortar — e a API não sobe.**
A `20260911050000_isolamento_por_linha` termina com uma conferência que percorre o catálogo do banco
e **recusa aplicar** se achar qualquer tabela de `public` sem `ROW LEVEL SECURITY`, sem `FORCE` ou
sem policy. A conferência não distingue "tabela de empresa esquecida numa migration nova" (onde
abortar é o comportamento certo, porque é vazamento) de "tabela auxiliar que alguém criou à mão para
um conserto pontual" — uma `backup_leads_2026`, um `temp_conciliacao`. **Esta é a única falha desta
migration que pode aparecer num banco de verdade sem ser vazamento.** A mensagem nomeia a tabela:

```
ERROR: isolamento por linha incompleto: 1 tabela(s) ficaram sem RLS/FORCE/policy (backup_leads_2026).
```

Conserto no calor do momento, nesta ordem:

```sql
-- se a tabela é lixo:
DROP TABLE "backup_leads_2026";

-- se ela precisa ficar e não tem orgId: negue tudo para a aplicação
ALTER TABLE "backup_leads_2026" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_leads_2026" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_leitura ON "backup_leads_2026" FOR SELECT USING (false);
```

Depois suba de novo. Se a tabela ficou, acrescente-a a `SEM_ISOLAMENTO` em
`apps/api/test/tenant-isolation.test.ts` **com o motivo escrito**, senão a suíte de isolamento
reprova na CI. As duas receitas foram medidas em 11/09/2026 no Postgres descartável: a primeira
libera a migration, a segunda também.

**Preencher `DB_APP_USER`/`DB_APP_PASSWORD` hoje faz a API RECUSAR SUBIR — de propósito.**
Existem sete caminhos que consultam o banco **antes** de haver empresa (login por senha, login com
Google, provisionamento, ClickUp, financeiro, carga da política e a sonda de saúde) e que ainda não
declaram o contexto de plataforma. Sob o papel restrito, cada um deles passa a devolver **zero
linha, em silêncio** — o login inclusive, que vira "credenciais inválidas" para a empresa inteira
sem nada no log. Por isso o arranque compara a lista e lança
`CoberturaDePlataformaIncompletaError` quando a conexão é restrita e a cobertura está incompleta.

Com a conexão **dona** (o estado de produção hoje) a API sobe normalmente e só grita: procure no log
do boot a linha `[tenant] ATENÇÃO: N caminho(s) de plataforma ainda NÃO declaram contexto`. Enquanto
ela existir, **não vire a chave**. Para voltar atrás depois de ter virado: tire as duas variáveis do
`.env` e recrie o container (`up -d --no-build api`). Detalhes em `deploy/papel-app.sh` e em
`apps/api/src/prisma/contexto-de-plataforma.ts`.

**Rollback do isolamento é um comando, e não perde as policies.** Se algo der errado no dia da
virada: `SELECT app_rls_desligar();` tira `ENABLE` e `FORCE` de todas as tabelas e deixa as policies
paradas no catálogo; `SELECT app_rls_ligar();` religa. `SELECT * FROM app_rls_estado();` mostra
tabela, `rls`, `force` e número de policies. Nenhuma das três pode ser chamada pelo papel restrito —
ele recebe `permission denied`, e é assim que ele não desliga o próprio isolamento.

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
2. [ ] Migration nova aplicada antes num Postgres descartável — **do zero e sobre banco povoado**
3. [ ] Variável nova no `environment:` do compose **e** no `.env`
4. [ ] Backup do dia existe
4b. [ ] `deploy/janela-horaria-ilegivel.sql` rodado em produção, com o resultado lido (onda 6)
4c. [ ] `db:seed:politica` planejado para depois da subida, e a linha de boot conferida em 62
5. [ ] `docker tag mktos-app:latest mktos-app:rollback`
6. [ ] `docker compose -f docker-compose.yml -f docker-compose.vps.yml build api`
7. [ ] Smoke na imagem, contra banco descartável, com os crons desligados
8. [ ] `up -d --no-build api web`
9. [ ] `docker compose ps` + logs + as três superfícies públicas respondendo
10. [ ] Registrar o que subiu (commit/tag) — enquanto o Syncthing for o transporte, isso não fica
    registrado sozinho no servidor
