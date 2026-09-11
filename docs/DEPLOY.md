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

### 2.0 A ORDEM COMPLETA — e o que acontece se pular cada passo

A ordem importa e **não é a mesma de sempre**: as ondas 6 e 7 acrescentaram passos, e dois deles são
**anteriores** ao que antes era o começo. Pular não dá erro na hora — dá comportamento errado
depois, que é a razão de a coluna da direita existir.

| # | Passo | Quando | Se pular |
|---|---|---|---|
| 1 | `deploy/janela-horaria-ilegivel.sql` no banco de **produção** | **antes do merge** | A fatia 2.3 fez o sinal `fora_da_janela` **acender** quando a janela horária de uma política está ilegível, onde antes ele ficava calado. Acender sobe um degrau na régua em **toda** ação daquela empresa. Zero linha = mudança inócua; linha com `orgId` nulo = a política BASE, e afeta todas as empresas. Sem rodar, você descobre no dia seguinte, com a operação inteira um degrau acima. |
| 2 | CI verde na revisão que vai subir | antes do merge | Typecheck, as suítes e a prova de que o histórico de migrations aplica do zero. Sem isso o ensaio do passo 6 vira a primeira execução de tudo. |
| 3 | Backup do banco do dia (§4) | antes de tocar no servidor | Migration aditiva não desfaz. Sem backup, o rollback de estrutura não existe. |
| 4 | Variável nova nos **dois** lugares: bloco `environment:` do serviço em `docker-compose.yml` **e** `.env` | antes de construir | O container **não lê arquivo `.env`**: só chega o que está no bloco. Preencher só o `.env` não faz nada — foi o que segurou a `ANTHROPIC_API_KEY` por semanas. **Nesta onda são duas: `COFRE_CHAVES` e `COFRE_CHAVE_ATUAL`** (§2.3c). |
| 5 | `docker tag mktos-app:latest mktos-app:rollback` | antes de construir | A imagem anterior vira lixo na próxima poda, e o rollback deixa de existir. É o passo que mais dói ter pulado. |
| 6 | `build` + ensaio da migration num banco descartável + **smoke** da imagem (§2.2, §2.3) | antes de subir | As duas formas de a subida morrer: migration que não aplica (e `migrate deploy` roda no `command` do container — falhar é a API não subir) e grafo de injeção do Nest que não resolve. O smoke pega o segundo, que o typecheck **não** enxerga. |
| 7 | **`db:seed:politica` — E É ANTES DE SUBIR** (§2.3b) | depois do build, **antes** do `up` | Mudou nesta onda: na onda 6 o seed era cosmético (duas capacidades novas que só apareciam na tela da Régua) e podia vir depois. Agora **não pode**. A fatia 3.3 acrescentou **descrição de argumento** a capacidades que o código novo já usa (`cc` no e-mail, `local` e `convidados` no evento) e esquema a outras. O esquema do banco tem `additionalProperties: false`: **campo que o esquema antigo não conhece é recusado pela porta**. Subir a API antes de semear faz toda chamada com campo novo falhar com erro de argumento inválido — numa ação que o catálogo do repositório diz que é válida. |
| 8 | `up -d --no-build api web` (§2.4) | — | Sem `--no-build` sobe uma imagem reconstruída na hora, não a que passou no smoke. Sem `--vps` o compose base publica em `0.0.0.0` e expõe banco, redis e MinIO na internet (§3). |
| 9 | Conferir: `docker compose ps`, logs, as três superfícies públicas (§2.5) | depois | A linha de boot `política base vN carregada DO BANCO (62 capacidades)` é a prova de que o passo 7 pegou. |
| 10 | Registrar o que subiu (commit/tag) | depois | Enquanto o Syncthing for o transporte, nada no servidor registra isso sozinho (§1). |

Os passos 1 e 7 são os que mudaram de lugar. Os outros são os de sempre.

### 2.0b Antes de começar (o mesmo, em caixinhas)

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

**O smoke desta onda cobre duas travas de arranque novas**, as duas propositais, as duas fatais:

- o `ConectoresConfiguradosRegistry` **recusa subir** se um conector dono de credencial (ClickUp,
  Pluggy, Asaas, Evolution) não se inscrever nele. Sem a trava, o conector voltaria a aparecer como
  DESCONECTADO na tela de Conexões — com a credencial no lugar, funcionando — e sem nada no log;
- a porta **recusa subir sem o `EfeitosRegistry`**, e o registro **recusa duas inscrições para a
  mesma capacidade**. A segunda inscrição executaria código de um módulo com a classificação de
  risco do outro, sem nada no RASTRO denunciando a troca.

Medido em 11/09/2026, com o `dist/` de verdade: a aplicação sobe, e cada uma das três derruba o boot
quando deve.

### 2.3b Semear a política — ANTES de subir, não depois

```bash
docker run --rm --network marketing-os-net -w /app/apps/api \
  -e DATABASE_URL='postgresql://<user>:<senha>@db:5432/<banco de produção>' \
  -e POLITICA_REBAIXAMENTO_AUTOR='<quem responde>' \
  -e POLITICA_REBAIXAMENTO_MOTIVO='<a decisão escrita, 10+ caracteres>' \
  mktos-app pnpm db:seed:politica
```

Roda da **imagem nova** (o catálogo que ele semeia é o do repositório, que só existe lá dentro) e
contra o banco **de produção**, antes do `up`. A ordem é essa por um motivo concreto e não por zelo
— está na tabela do §2.0, passo 7.

**O seed vai RECUSAR rodar sem assinatura, e isso está certo.** A fatia 3.3 acrescentou propriedade
nova ao esquema de argumentos de duas capacidades, e aceitar mais entrada é **afrouxar** (RF-P-06):

```
  AFROUXA a política em vigor (nível, limite ou seção do documento) — 2 item(ns):
    agenda.evento.criar: argsSchema — declara propriedade nova: local, convidados (nível segue R3)
    email.enviar: argsSchema — declara propriedade nova: cc (nível segue R3)
```

A categoria é **`POLITICA_REBAIXAMENTO_*`**, não a `POLITICA_CAPACIDADE_NOVA_*` da onda 6: aqui
nenhuma capacidade é nova, o que mudou foi o esquema. As duas variáveis ficam **gravadas na versão**.

Ensaiado em 11/09/2026 contra o Postgres descartável: num banco novo, `62 criadas, 62 no total`; num
banco já semeado com o catálogo da onda 6, `0 criadas, 62 atualizadas, 62 no total`, com o
afrouxamento assinado impresso na saída. O total continua **62** — a capacidade `clickup.tarefa.criar`
que a fatia declarou já existia na base ROOT; o delta passou a sobrescrevê-la.

Como conferir depois do `up`: a linha de boot
`política base vN carregada DO BANCO (N capacidades)` precisa dizer **62**.

### 2.3c As duas variáveis do COFRE

`COFRE_CHAVES` e `COFRE_CHAVE_ATUAL`, **as duas nos dois lugares** (bloco `environment:` do serviço
`api` no `docker-compose.yml` **e** `.env`). Elas nascem **vazias**, e vazio é um estado válido: sem
elas o chaveiro tem uma chave só — a `ENCRYPTION_KEY`, que entra com o id `env` — e o cofre funciona
como antes. **O que não funciona é rotacionar**, porque rotacionar exige ter para onde ir.

Se elas não entrarem no bloco `environment:`, preenchê-las no `.env` não faz nada: o container não
lê arquivo `.env`. O sintoma é o pior possível — a rotação parece configurada e continua cifrando
tudo com a chave velha.

O roteiro completo de uma rotação está no cabeçalho de `apps/api/src/cofre/cofre.cli.ts`, e o passo
zero dele é uma **trava nova**: `rotacionar` **recusa sair da chave de ambiente enquanto restar
credencial herdada cifrada com ela** (as colunas de origem da bio e das contas do Google, que o
inventário antigo não enxergava). A recusa existe porque a versão anterior do roteiro destruía toda
credencial viva da bio de quem o seguisse até o fim: o inventário dizia zero, e tirar a chave tornava
tudo ilegível, sem volta. O comando `cofre:inventario` tem hoje **duas** colunas de contagem — a do
cofre e a de **herdadas** — e a coluna que responde "posso aposentar esta chave?" é o TOTAL.

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

**Rode `db:seed:politica` em produção — e desde a onda 7 ele é ANTERIOR à subida, não posterior.**
A receita, a assinatura que ele pede e o porquê da ordem estão em **§2.3b**. O resumo: na onda 6 o
seed era cosmético (duas capacidades novas, `conector.desligar` e `conector.religar`, que só
apareciam na tela da Régua — as rotas de desligamento são guardadas por permissão, não pela porta);
na onda 7 ele passou a ser pré-requisito, porque o catálogo ganhou **descrição de argumento** que o
código novo já usa e o esquema antigo recusa. O que segue valendo dos dois lados: **a política que
vale em runtime é a do BANCO**, e trocar o JSON do repositório sem semear não muda nada.

**O seed recusa rodar sozinho sempre que a mudança AFROUXA**, e está certo: afrouxar exige decisão
de gente (RF-P-06). O que ele considera afrouxamento depende do que mudou, e **a categoria da
assinatura muda junto** — é o detalhe que faz alguém copiar o comando errado do histórico:

| O que mudou no catálogo | Categoria | Variáveis a assinar |
|---|---|---|
| Capacidade **nova** (não declarada valia R5) | `ACRESCENTA` | `POLITICA_CAPACIDADE_NOVA_AUTOR` / `_MOTIVO` |
| Nível, limite, seção ou **esquema de argumentos** que aceita mais | `AFROUXA` | `POLITICA_REBAIXAMENTO_AUTOR` / `_MOTIVO` |

A onda 6 caiu na primeira linha (`conector.desligar` e `conector.religar`, capacidades novas). **A
onda 7 cai na segunda** — nenhuma capacidade é nova, o que mudou foi o esquema. A recusa sai assim:

```
  AFROUXA a política em vigor (nível, limite ou seção do documento) — 2 item(ns):
    agenda.evento.criar: argsSchema — declara propriedade nova: local, convidados (nível segue R3)
    email.enviar: argsSchema — declara propriedade nova: cc (nível segue R3)
Nada foi semeado.
```

Quem assina põe o próprio nome e o motivo (10+ caracteres), que ficam **gravados na versão**. O
comando completo está em **§2.3b**, com a ordem certa — o seed vem **antes** do `up`, não depois.

Como conferir depois: a linha de boot `política base vN carregada DO BANCO (N capacidades)` precisa
dizer **62**. Ensaiado em 11/09/2026 nos bancos descartáveis — banco novo: `62 criadas, 62 no
total`; banco já semeado com o catálogo da onda 6: `0 criadas, 62 atualizadas, 62 no total`.

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

A ordem completa, com a consequência de pular cada passo, está em **§2.0**. Aqui é só a lista.

1. [ ] `deploy/janela-horaria-ilegivel.sql` rodado em **produção**, com o resultado lido — **antes
   do merge** (onda 6)
2. [ ] CI verde na revisão que vai subir
3. [ ] Migration nova aplicada antes num Postgres descartável — **do zero e sobre banco povoado**
4. [ ] Variável nova no `environment:` do compose **e** no `.env` — nesta onda, `COFRE_CHAVES` e
   `COFRE_CHAVE_ATUAL` (§2.3c), as duas podendo ficar vazias
5. [ ] Backup do dia existe
6. [ ] `docker tag mktos-app:latest mktos-app:rollback`
7. [ ] `docker compose -f docker-compose.yml -f docker-compose.vps.yml build api`
8. [ ] Smoke na imagem, contra banco descartável, com os crons desligados
9. [ ] **`db:seed:politica` rodado da imagem nova contra o banco de produção, ANTES do `up`** — com
   `POLITICA_REBAIXAMENTO_AUTOR`/`_MOTIVO`, que o seed vai exigir (§2.3b)
10. [ ] `up -d --no-build api web`
11. [ ] `docker compose ps` + logs + as três superfícies públicas respondendo, e a linha de boot
    dizendo **62 capacidades DO BANCO**
12. [ ] Registrar o que subiu (commit/tag) — enquanto o Syncthing for o transporte, isso não fica
    registrado sozinho no servidor
