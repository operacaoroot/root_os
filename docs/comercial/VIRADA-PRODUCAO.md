# A virada da versão final para a produção

> Para: Rodrigo e Pedro. Escrito em 19/10/2026 pela rodada "Versão final" (`docs/comercial/RODADA-FINAL-20261019.md`, F6).
> O que sobe: a branch `homolog/final-20261019` (nossa + Pedro de 14/10 + Lucas), validada na stack `rootos-final` do Predator.
> Atualizado em 20/10/2026 pelos ajustes da versão final (`docs/comercial/RODADA-AJUSTES-20261019.md`): sobe a tag `final-ajustes-20261020`, que traz o "Iniciar onboarding" antes do fechamento e os textos do Pedro. Os ajustes não trazem migration, variável, capacidade nem permissão nova: a contagem de migrations, a política e as variáveis deste roteiro continuam as mesmas. O `final.bundle` foi refeito com a tag nova (`main..homolog/final-20261019`).
> Onde: a VPS da ROOT (`ssh vps-root`), produção em `https://os.operacaoroot.com`.
> Este arquivo não tem dado de cliente nem segredo. Onde aparece `<...>`, é um valor que se preenche na hora ou um placeholder que o orquestrador completa antes da virada.

## O que já se sabe da produção (confira no passo 0, não confie nesta lista)

- O compose que roda é o do easyPanel, em `/etc/easypanel/projects/root/marketing-os/code`, projeto `root_marketing-os`. A subida é `docker compose -p root_marketing-os up -d --no-build api web` rodada nesse diretório. Sem o `-p`, a subida falha no meio.
- A imagem é construída à parte, no checkout `/srv/projetos/root_os` (`/srv/marketing-os` é só um link para ele). A VPS não tem credencial do GitHub: o código chega por `git bundle`.
- Containers: `mktos_api`, `mktos_web`, `mktos_db` (Postgres, usuário `mkt`, banco `marketing_os`). Imagem da família `rootos-official` (ou `mktos-app`, conforme o compose do painel).
- A produção roda hoje a imagem do commit `10939e1` da `lucas/tarefas` (vários responsáveis). A última migration aplicada deve ser `20261019220000_tarefas_varios_responsaveis` (85 no total). A política no boot diz `71 capacidades`.
- Variável nova se declara em dois lugares: na aba Ambiente do serviço no easyPanel e no bloco `environment:` do compose do painel. O `.env` do repositório não chega lá.
- As migrations rodam também no `command` do container `api`. Migration que falha derruba a API.

## Os valores que se preenchem na hora

Um arquivo não consegue citar o hash do commit que o contém. Por isso o hash não está escrito aqui: ele é lido da tag, no Predator, e conferido no bundle, na VPS (o `list-heads` do passo "Antes de começar" e o `rev-parse` do passo 2 mostram o mesmo valor). O valor também está no fim do `homolog/RESULTADO-AJUSTES.md`, na linha "A tag".

| Valor | O que é |
|---|---|
| `<hash-final>` | o commit da tag `final-ajustes-20261020`: `git -C /c/Users/User/dev/marketing-os rev-parse final-ajustes-20261020^{commit}` (40 caracteres) |
| `<curto>` | os 7 primeiros caracteres de `<hash-final>` |
| `<quem responde>` | o nome de quem assina a política (Rodrigo ou Pedro): preenchido na hora, por quem executa |

## Tempo total

| Passo | Tempo |
|---|---|
| 0. Quem está na VPS | 5 min |
| 1. Backup | 15 min |
| 2. Código pelo bundle | 10 min |
| 3. Imagem | 15 min |
| 4. Ensaio completo (política, migrations, boot) num banco descartável | 25 min |
| 5. Política e migrations em produção | 10 min |
| 6. Variáveis | 10 min |
| 7. Subir | 5 min |
| 8. Permissões | 0 a 5 min |
| 9. Organizar as tarefas | 30 a 45 min |
| 10. Conferências | 20 min |
| **Total** | **cerca de 2h30** |
| 11. Rollback, se precisar | 30 min |

O OS fica fora do ar, ou instável nas tarefas, do fim do passo 5 ao fim do passo 7 (cerca de 10 minutos). Avise o time antes do passo 5. Faça a virada num horário sem uso (noite ou começo da manhã).

---

## Antes de começar, no Predator

1. Confira que a tag e o bundle existem e batem com `<hash-final>`:

   ```bash
   git -C /c/Users/User/dev/marketing-os rev-parse final-ajustes-20261020^{commit}
   git -C /c/Users/User/dev/marketing-os bundle verify /c/Users/User/dev/final.bundle
   git -C /c/Users/User/dev/marketing-os bundle list-heads /c/Users/User/dev/final.bundle
   ```

   Esperado: o `rev-parse` imprime `<hash-final>`; o `verify` termina com `is okay` e lista `5260924` como pré-requisito; o `list-heads` mostra `<hash-final> refs/heads/homolog/final-20261019`.

2. Gere também o bundle completo, de reserva. O incremental (`main..homolog/final-20261019`) exige que o checkout da VPS já tenha o commit `5260924` da `main`, e a pasta de build da VPS pode estar parada em setembro. O Predator não alcança a VPS, então leve os dois de uma vez:

   ```bash
   git -C /c/Users/User/dev/marketing-os bundle create /c/Users/User/dev/rootos-final-completo.bundle homolog/final-20261019
   git -C /c/Users/User/dev/marketing-os bundle verify /c/Users/User/dev/rootos-final-completo.bundle
   ```

3. Leve os dois arquivos do Predator para o Mac por um caminho da casa (não por e-mail nem serviço de terceiro). Do Mac, mande para a VPS:

   ```bash
   ssh vps-root "mkdir -p /root/virada"
   scp final.bundle rootos-final-completo.bundle vps-root:/root/virada/
   ```

   Use o `ssh` e o `scp` secos, sem flag na linha: as opções estão no `~/.ssh/config`.

## Variáveis da sessão na VPS

Abra uma sessão (`ssh vps-root`) e deixe estas variáveis na mesma janela do começo ao fim. Nenhuma delas imprime segredo.

```bash
export DIA=$(date +%Y%m%d)
export HORA=$(date +%Y%m%d-%H%M)
export FONTE=/srv/projetos/root_os
export PAINEL=/etc/easypanel/projects/root/marketing-os/code
export PROJETO=root_marketing-os
export VIRADA=/root/virada
export BACKUPS=/root/backups/root-os/virada
export FINAL=<hash-final>
export CURTO=<curto>
mkdir -p "$VIRADA" "$BACKUPS"
export NET=$(docker inspect mktos_api -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1)
export DB="$(docker exec mktos_api printenv DATABASE_URL)"   # não dê echo nesta variável
# A imagem que está no ar AGORA. Se a sessão cair depois do passo 7, leia de $VIRADA/imagem-antes.txt.
export IMG_ID=$(cat "$VIRADA/imagem-antes.txt" 2>/dev/null | awk '{print $2}'); [ -n "$IMG_ID" ] || export IMG_ID=$(docker inspect mktos_api -f '{{.Image}}')
psql_prod() { docker exec mktos_db psql -U mkt -d marketing_os -At -c "$1"; }
```

Se a sessão cair, abra outra e rode o bloco de novo. Os backups ficam fora do checkout de propósito: dentro dele, viajariam com o Syncthing.

---

## 0. Quem está na VPS e o que está no ar (5 min)

```bash
who
last -n 10 | head -10
ps aux | grep -E "docker (compose|build)|pnpm|prisma|git (pull|fetch|checkout)" | grep -v grep
docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}  {{.CreatedAt}}' | grep -E 'mktos|marketing'
docker inspect mktos_api -f 'api: {{.Config.Image}} {{.Image}}'
docker inspect mktos_web -f 'web: {{.Config.Image}} {{.Image}}'
docker image inspect "$(docker inspect mktos_api -f '{{.Image}}')" -f '{{.Created}} {{json .Config.Labels}}'
grep -n 'image:' "$PAINEL/docker-compose.yml"
git -C "$FONTE" log --oneline -1
git -C "$FONTE" status --porcelain | head -20
psql_prod 'select migration_name from "_prisma_migrations" order by finished_at desc nulls first limit 3'
psql_prod 'select count(*) from "_prisma_migrations" where finished_at is not null'
docker logs mktos_api 2>&1 | grep -E 'capacidades' | tail -1
docker exec mktos_api printenv | grep -cE '^PROPOSTAS_(URL|API_TOKEN)='   # só a contagem, nunca o valor
df -h / | tail -1
psql_prod "select pg_size_pretty(pg_database_size('marketing_os'))"
```

**Conferir:**
- `who` e `last`: só a sua sessão agora. Nenhum `docker build`, `compose`, `prisma` ou `git` de outra pessoa rodando.
- `api` e `web` com o mesmo ID de imagem. A data de criação da imagem e o rótulo batem com o deploy do Lucas do commit `10939e1` (19/10). Anote o nome da imagem e o ID em `$VIRADA/imagem-antes.txt`:
  `docker inspect mktos_api -f '{{.Config.Image}} {{.Image}}' > "$VIRADA/imagem-antes.txt"`
- A linha `image:` do compose do painel: anote se é tag móvel (`mktos-app` ou `mktos-app:latest`) ou tag fixa (`rootos-official:<algo>`). O passo 7 muda conforme o caso.
- A última migration é `20261019220000_tarefas_varios_responsaveis` e o total é 85.
- O boot diz `(71 capacidades)`.
- A contagem das variáveis `PROPOSTAS_*` dá 2. Se der 0, a tela de Propostas já mostra hoje só o aviso de serviço fora; registre e siga (a versão final mostra as da sala do mesmo jeito).
- Espaço livre em disco maior que três vezes o tamanho do banco mais 5 GB (dump, ensaio e a imagem nova).

**Se falhar:**
- Alguém deployando ou mexendo: pare e combine com a pessoa. Não siga em paralelo.
- A imagem não é a do `10939e1` ou a última migration é outra: a produção mudou depois desta rodada. Pare, registre o que achou e peça ao orquestrador para conferir a branch final contra o estado novo.
- `git status` do checkout com arquivos alterados: não descarte nada. O passo 2 guarda essas alterações num stash com nome.
- Pouco espaço: libere espaço com quem administra a VPS antes de seguir. Não apague imagem nem backup sem conferir de quem é.

## 1. Backup do banco e da imagem (15 min)

```bash
# 1a. O banco inteiro, formato custom, com a data no nome.
docker exec mktos_db pg_dump -U mkt -d marketing_os -Fc > "$BACKUPS/rootos-antes-da-virada-$HORA.dump"
ls -lh "$BACKUPS/rootos-antes-da-virada-$HORA.dump"
docker exec -i mktos_db pg_restore --list < "$BACKUPS/rootos-antes-da-virada-$HORA.dump" | grep -c 'TABLE DATA'
sha256sum "$BACKUPS/rootos-antes-da-virada-$HORA.dump" > "$BACKUPS/rootos-antes-da-virada-$HORA.dump.sha256"

# 1b. Contagens de referência (só números, sem dado).
psql_prod 'select (select count(*) from "WorkTask") tarefas, (select count(*) from "WorkTask" where "clienteId" is not null) tarefas_com_cliente, (select count(*) from "Partner") partners, (select count(*) from "Lead") leads, (select count(*) from "User") usuarios' > "$VIRADA/contagens-antes.txt"
cat "$VIRADA/contagens-antes.txt"

# 1c. A imagem em execução ganha a etiqueta de volta, e uma cópia em disco ($IMG_ID vem do bloco da sessão).
REPO=$(docker inspect mktos_api -f '{{.Config.Image}}'); REPO=${REPO%%:*}
docker tag "$IMG_ID" "$REPO:rollback-$DIA"
docker save "$REPO:rollback-$DIA" | gzip > "$BACKUPS/imagem-rollback-$DIA.tar.gz"
docker image ls "$REPO" --format '{{.Tag}}  {{.ID}}  {{.CreatedSince}}'
echo "$REPO:rollback-$DIA" > "$VIRADA/imagem-de-volta.txt"
```

**Conferir:**
- O dump tem mais de 1 MB e a contagem de `TABLE DATA` passa de 100. O `pg_restore --list` não reclama de arquivo truncado.
- `contagens-antes.txt` com cinco números (guarde: o passo 5 e o passo 10 comparam com eles).
- A lista de imagens mostra `rollback-<data>` com o mesmo ID da imagem que está no ar. O `.tar.gz` existe e tem mais de 300 MB.

**Se falhar:**
- `pg_dump` com erro de permissão ou de conexão: confira usuário e banco com `docker exec mktos_db psql -U mkt -l`. Sem dump válido, a virada não começa.
- Dump pequeno demais: algo cortou o fluxo. Rode de novo para outro arquivo e compare. Nunca siga com um dump que não passou no `--list`.
- `docker save` sem espaço: fique só com a etiqueta (`docker tag`) e registre que a cópia em disco não foi feita.

## 2. O código pelo bundle (10 min)

```bash
cd "$FONTE"
git rev-parse HEAD > "$VIRADA/sha-antes.txt"
git rev-parse --abbrev-ref HEAD > "$VIRADA/branch-antes.txt"
git bundle verify "$VIRADA/final.bundle"
```

- Se o `verify` disser `is okay`: use `BUNDLE=$VIRADA/final.bundle`.
- Se disser que falta o pré-requisito `5260924`: use `BUNDLE=$VIRADA/rootos-final-completo.bundle` e rode o `verify` nele.

```bash
# Alterações locais do checkout não se perdem: vão para um stash com nome.
[ -z "$(git status --porcelain)" ] || git stash push -u -m "virada-$HORA-alteracoes-da-vps"
git stash list | head -3

git fetch "$BUNDLE" homolog/final-20261019:virada/final-20261019
git rev-parse virada/final-20261019
git checkout virada/final-20261019
git log --oneline -1
ls apps/api/prisma/migrations | tail -16
```

**Conferir:**
- `git rev-parse virada/final-20261019` imprime exatamente `<hash-final>`.
- `git log` mostra o commit da entrega final.
- A lista de migrations termina em `20261019230000_conciliacao_cliente_da_tarefa`, logo depois de `20261019220000_tarefas_varios_responsaveis`.

**Se falhar:**
- Hash diferente: o bundle não é o da entrega. Pare. Não construa imagem de um commit que ninguém validou.
- `fetch` recusado porque a branch `virada/final-20261019` já existe: rode `git branch -m virada/final-20261019 virada/final-20261019-antiga-$HORA` e repita.
- `checkout` recusado por arquivo local: o stash não pegou tudo. Mostre `git status` ao Rodrigo e resolva antes de seguir.

## 3. A imagem nova (15 min)

A imagem é uma só para `api` e `web`. Dois valores entram na compilação do web e precisam ser os mesmos da imagem de hoje. Eles não são segredo (um vai para o navegador, o outro é endereço interno):

```bash
docker image inspect "$IMG_ID" -f '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(API_PROXY_TARGET|NEXT_PUBLIC_CENTRAL_PIXEL_KEY|NEXT_PUBLIC_RAIZ)='
```

Monte o build com esses valores. `NEXT_PUBLIC_RAIZ` fica vazio em produção (com `login`, a raiz do site abriria o login; isso é só da homologação).

```bash
cd "$FONTE"
docker build -t "rootos-official:final-$CURTO" \
  --build-arg API_PROXY_TARGET='<o valor de hoje>' \
  --build-arg NEXT_PUBLIC_CENTRAL_PIXEL_KEY='<o valor de hoje, ou vazio>' \
  --build-arg NEXT_PUBLIC_RAIZ= \
  .
docker image ls rootos-official --format '{{.Tag}}  {{.ID}}  {{.CreatedSince}}'
```

**Conferir:** a imagem `rootos-official:final-<curto>` aparece, criada agora. O que está no ar não mudou (`docker ps` igual ao do passo 0).

**Se falhar:**
- Erro de compilação: o commit não é o validado ou falta arquivo. Confira o hash do passo 2. Nada em produção mudou; pode parar aqui sem rollback.
- Falta de espaço: libere espaço com quem administra a VPS e repita.

## 4. Ensaio completo num banco descartável, ANTES de tocar a produção (25 min)

Nada deste passo escreve no banco de produção. A política, as migrations e o boot da imagem nova rodam primeiro numa cópia do dump do passo 1; só com o ensaio verde o passo 5 escreve em produção.

**A política.** A versão final acrescenta **6 capacidades** ao catálogo que a produção usa hoje (delta `politica-marketing-os.json` 1.7.0 para 1.9.0; base `politica-root.json` sem mudança; nenhuma capacidade existente mudou de nível, de esquema ou de ferramenta; invariantes iguais):

| Capacidade | Nível |
|---|---|
| `comercial.whatsapp.enviar` | R3 |
| `comercial.proposta.publicar` | R3 |
| `comercial.sala.publicar` | R3 |
| `comercial.cobranca.criar` | R4 |
| `comercial.contrato.enviar` | R4 |
| `comercial.fechamento.executar` | R4 |

Por isso basta a assinatura de capacidade nova. Sem ela, o seed recusa com "Nada foi semeado", e as seis valem R5 (a porta recusa tudo do cockpit).

**As migrations.** A produção tem 85 migrations. A versão final traz 13 que ela ainda não tem:

| Migration | O que faz |
|---|---|
| `20261013000000_cockpit_comercial` | cria o enum `ComercialEtapa` e as tabelas do cockpit (`ComercialFicha`, `ComercialConfig`, `ComercialDecisao`, `SalaDoCliente`, `ComercialMensagem`, `ComercialReacao` e afins), com RLS |
| `20261013100000_comercial_webhooks_leitura_publica` | a leitura pela sentinela pública para os webhooks do Asaas e da ZapSign acharem a empresa; só policy |
| `20261013200000_comercial_vigia` | duas colunas anuláveis em `ComercialConfig` (números do vigia) |
| `20261013300000_comercial_geladeira_volta` | uma coluna anulável em `ComercialConfig` |
| `20261018100000_caixa_visto` | tabela da marca pessoal de "limpei isto" das Pendências, com RLS |
| `20261018130000_ata_sugestao` | tabela `AtaSugestao` (sugestões de tarefa das atas), com RLS |
| `20261018221000_implantacao_card` | coluna `ComercialFicha.cardId` (o card que nasce do fechamento) |
| `20261018230000_lead_reacao` | tabela `LeadReacao` (leitura e reações da proposta), filha de `Lead`, com RLS |
| `20261018240000_sala_versao` | tabela `SalaVersao` (sala publicada por versão), filha de `Lead`, com RLS |
| `20261019100000_tarefa_do_cliente` | `Partner.interno` e o cliente da tarefa. Na versão final ela só garante `Partner.interno`, idempotente; a coluna do cliente fica com a conciliação |
| `20261019110000_vista_salva` | tabela `VistaSalva` (vistas salvas por pessoa), com RLS |
| `20261019170000_cliente_da_tarefa_preparo` | não faz nada na produção (só age na homologação que rodou a versão antiga da nossa `20261019100000`) |
| `20261019230000_conciliacao_cliente_da_tarefa` | a conciliação do cliente da tarefa (abaixo) |

As doze primeiras têm data anterior à última da produção. O `migrate deploy` aplica toda migration que o banco não tem, na ordem do nome, mesmo as de data anterior. Por isso o ensaio vem antes.

**O que a conciliação faz.** Na produção, `WorkTask.clienteId` aponta para outra `WorkTask` (o cartão da lista `cadastro` do Lucas). Na versão final, aponta para `Partner`. A migration: garante `Partner.interno` (um cliente da casa por empresa); para cada tarefa com cliente, acha o `Partner` pelo CNPJ ou, entre os que já são clientes, pelo nome normalizado do cartão de cadastro, ou cria um (cartão ainda em fase de lead não vira `Partner`: a tarefa fica sem cliente e o passo 9 decide pelos mapas; fornecedor nunca vira cliente pelo nome); confere que a conta fecha antes de trocar a coluna e recusa rodar com um papel que não atravessa o isolamento por linha; troca o `clienteId` para o `Partner`; troca a chave estrangeira e o CHECK pelos da versão final. É idempotente: rodar de novo, ou rodar num banco que já tem o esquema novo, não muda nada. `outrosResponsaveisIds` e `WorkArea` ficam como estão.

### 4a. O ensaio

```bash
docker exec mktos_db psql -U mkt -d postgres -c "create database virada_ensaio"
docker exec -i mktos_db pg_restore -U mkt -d virada_ensaio < "$BACKUPS/rootos-antes-da-virada-$HORA.dump" 2> "$VIRADA/ensaio-restore.log"; tail -5 "$VIRADA/ensaio-restore.log"
ENSAIO="${DB%%\?*}"; ENSAIO="${ENSAIO%/*}/virada_ensaio"
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$ENSAIO" "rootos-official:final-$CURTO" pnpm exec prisma migrate status
```

A política no ensaio, com a mesma assinatura que irá à produção no passo 5a:

```bash
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$ENSAIO" \
  -e POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>' \
  -e POLITICA_CAPACIDADE_NOVA_MOTIVO='Versão final 20/10/2026: o cockpit comercial entra no catálogo (envio de WhatsApp do comercial, proposta e sala publicadas, cobrança, contrato e fechamento), todas R3 ou R4 pela régua' \
  "rootos-official:final-$CURTO" pnpm db:seed:politica
```

E as migrations, duas vezes (a segunda prova a idempotência):

```bash
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$ENSAIO" "rootos-official:final-$CURTO" pnpm exec prisma migrate deploy
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$ENSAIO" "rootos-official:final-$CURTO" pnpm exec prisma migrate deploy
```

Conferências da conciliação no ensaio (só números):

```bash
ens() { docker exec mktos_db psql -U mkt -d virada_ensaio -At -c "$1"; }
ens 'select count(*) from "WorkTask"'
ens 'select count(*) from "WorkTask" where "clienteId" is not null'
ens 'select count(*) from "WorkTask" t left join "Partner" p on p.id = t."clienteId" where t."clienteId" is not null and p.id is null'
ens 'select "orgId", count(*) from "Partner" where interno group by 1 having count(*) > 1'
ens "select conname, confrelid::regclass from pg_constraint where conrelid = '\"WorkTask\"'::regclass and contype = 'f' and conname ilike '%cliente%'"
ens 'select count(*) from "_prisma_migrations" where finished_at is not null'
```

E o boot da imagem nova contra o ensaio, sem rotina e sem sincronização:

```bash
docker run --rm --network "$NET" -w /app/apps/api \
  -e DATABASE_URL="$ENSAIO" -e JWT_SECRET="ensaio-descartavel-$(openssl rand -hex 16)" -e ROTINAS_CRON=off \
  -e ASAAS_SYNC_INTERVAL_MIN=0 -e BIO_BRIDGE_INTERVAL_MIN=0 -e BIO_SYNC_INTERVAL_MIN=0 \
  -e CLICKUP_SYNC_INTERVAL_MIN=0 -e PLUGGY_SYNC_INTERVAL_MIN=0 \
  "rootos-official:final-$CURTO" pnpm smoke
```

**Conferir:**
- O seed da política no ensaio termina como o passo 5a espera (abaixo) e não fala em "Nada foi semeado".
- O primeiro `migrate status` lista 13 migrations pendentes (as da tabela). O primeiro `deploy` aplica as 13; o segundo diz que não há nada a aplicar (idempotência).
- Total de tarefas igual ao de `contagens-antes.txt`. Tarefas com cliente: igual ou menor que antes; a diferença são as tarefas que citavam um cartão ainda em fase de lead, que ficam sem cliente de propósito (o passo 9 as leva ao funil pelos mapas). Na cópia de 19/10 foram 8 antes e 6 depois, com 3 `Partner` criados. Anote os dois números.
- Zero tarefa com cliente que não seja `Partner`. Nenhuma empresa com dois clientes internos.
- A chave estrangeira do cliente aponta para `"Partner"`.
- 98 migrations aplicadas.
- O smoke termina em `SMOKE OK` e cita 77 capacidades (o seed do ensaio já entrou).

Depois de conferir, o banco do ensaio pode sair (é cópia em claro da produção):

```bash
docker exec mktos_db psql -U mkt -d postgres -c "drop database virada_ensaio"
```

**Se falhar no ensaio:** nada de produção mudou (nem a política: ela só vai à produção no passo 5). Pare, guarde `ensaio-restore.log` e a saída do `migrate deploy` (sem `DATABASE_URL`) e mande ao orquestrador. A causa mais provável é a `20261019100000_tarefa_do_cliente` não estar na forma segura para coluna existente, ou a conciliação achar um caso que a homologação não tinha.

## 5. A política e as migrations em produção (10 min)

### 5a. A política, ANTES da subida

A mesma assinatura do ensaio:

```bash
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" \
  -e POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>' \
  -e POLITICA_CAPACIDADE_NOVA_MOTIVO='Versão final 20/10/2026: o cockpit comercial entra no catálogo (envio de WhatsApp do comercial, proposta e sala publicadas, cobrança, contrato e fechamento), todas R3 ou R4 pela régua' \
  "rootos-official:final-$CURTO" pnpm db:seed:politica
```

**Conferir:** a saída termina com `capacidades: 6 criadas, 71 atualizadas, 77 no total` e não fala em "Nada foi semeado".

**Se falhar:**
- "Nada foi semeado" listando REBAIXAMENTO: o arquivo da branch afrouxa algo além das capacidades novas. Isso não era esperado. Pare, copie a lista impressa (não tem dado de cliente) e mande ao orquestrador. Não assine rebaixamento para destravar.
- Lista de capacidades novas com mais de 6 itens: a política do banco estava atrás do que se pensava. Confira a lista contra a tabela acima com o Pedro antes de assinar.
- "catálogo diverge da régua": defeito do arquivo. Pare; a produção segue intacta.
- O seed já gravou e algo deu errado depois: a versão anterior volta com o restore do passo 11 (o dump é anterior ao seed).

### 5b. As migrations

Avise o time: "o OS fica instável por 10 minutos". Daqui até o fim do passo 7 a API antiga roda sobre o esquema novo.

```bash
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" "rootos-official:final-$CURTO" pnpm exec prisma migrate deploy
psql_prod 'select migration_name from "_prisma_migrations" order by finished_at desc nulls first limit 3'
psql_prod 'select count(*) from "WorkTask" t left join "Partner" p on p.id = t."clienteId" where t."clienteId" is not null and p.id is null'
```

**Conferir:** 13 migrations aplicadas, a mais recente é `20261019230000_conciliacao_cliente_da_tarefa`, e a contagem de tarefa com cliente órfão é zero. Siga direto para o passo 6.

**Se falhar em produção:** a API antiga continua de pé, mas o banco ficou no meio do caminho. Vá ao passo 11 (rollback completo). Não tente "consertar à mão" uma migration pela metade.

## 6. As variáveis novas (10 min)

Compare feito entre o `docker-compose.yml` e o `.env.example` da nossa branch e os da `lucas/tarefas`. A versão final pede cinco variáveis que a produção não tem, todas do serviço `api`:

| Variável | Para que serve | Valor na virada |
|---|---|---|
| `ASAAS_WEBHOOK_TOKEN` | segredo do cabeçalho `asaas-access-token` do webhook do Asaas; sem ela o pagamento não volta ao OS (falha fechada) | gerar na VPS, 32+ caracteres |
| `ZAPSIGN_WEBHOOK_TOKEN` | segredo do cabeçalho `x-zapsign-token` do webhook da ZapSign; diferente do anterior | gerar na VPS, 32+ caracteres |
| `ZAPSIGN_API_TOKEN` | token da API da conta ZapSign da Root; sem ele o contrato não é enviado | vazio até a conta existir |
| `ZAPSIGN_BASE_URL` | força a base da ZapSign (sandbox ou produção) | vazio |
| `WHATSAPP_PROVEDOR` | provedor de WhatsApp do comercial: `simulado`, `evolution` ou `meta` | `simulado` (nada sai para o lead) |

Para gerar os dois segredos, no terminal da VPS, cada um com o seu comando (nunca cole o valor em arquivo do repositório, em chat ou em anotação):

```bash
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48; echo
```

No easyPanel, serviço `marketing-os`:
1. Compose: no bloco `environment:` do serviço `api`, uma linha por variável, no formato `NOME: ${NOME:-}` (para `WHATSAPP_PROVEDOR`, `${WHATSAPP_PROVEDOR:-simulado}`).
2. Ambiente: preencha os dois segredos e `WHATSAPP_PROVEDOR=simulado`.
3. Salve. Não clique em Deploy: a subida é o passo 7.

**Não levar para a produção** (são só da homologação): `LLM_PROVIDER=stub` ou `ponte`, `PONTE_MODELO_URL`, `QUADRO_DE_CUSTOS_EXEMPLO`, `NEXT_PUBLIC_RAIZ=login`, e os dublês `ASAAS_BASE_URL`/`ZAPSIGN_BASE_URL` apontando para `asaas-mock`/`zapsign-mock`.

**Continuam como estão** (são do Lucas e do Pedro e a versão final segue lendo): `PROPOSTAS_URL`, `PROPOSTAS_API_TOKEN`, `ROOTOS_LOCAL_MODEL_URL`, `ROOTOS_QA_PREVIEW`, `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `LLM_PROVIDER`.

**Conferir também:** `PUBLIC_BASE_URL` e `WEB_ORIGIN` do `api` valem `https://os.operacaoroot.com`. É deles que sai o link da sala do cliente (`/s/<token>`).

**Se falhar:** variável esquecida não derruba a subida; o recurso dela fica desligado. Os webhooks sem segredo recusam tudo, o que é o comportamento seguro. Complete depois e recrie só o `api` (`docker compose -p root_marketing-os up -d --no-build api`); `docker restart` não relê variável.

## 7. Subir api e web (5 min)

Conforme a linha `image:` anotada no passo 0:

- **Tag móvel** (`mktos-app` ou `mktos-app:latest`): `docker tag "rootos-official:final-$CURTO" mktos-app:latest`.
- **Tag fixa** (`rootos-official:<algo>`): no easyPanel, Compose do serviço `marketing-os`, troque a linha `image:` do `api` e do `web` para `rootos-official:final-<curto>`. Salve sem Deploy.

Depois:

```bash
grep -n 'image:' "$PAINEL/docker-compose.yml"
cd "$PAINEL" && docker compose -p "$PROJETO" up -d --no-build api web
sleep 60
docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'mktos_(api|web)'
docker logs --since 5m mktos_api 2>&1 | grep -E 'capacidades|ERROR|Error:|migrat' | tail -15
curl -fsS https://os.operacaoroot.com/api/health; echo
```

**Conferir:**
- `mktos_api` e `mktos_web` `Up` com a imagem nova, o `api` `(healthy)`.
- O log diz `política base vN carregada DO BANCO (77 capacidades)` e nenhum `ERROR`. O `migrate deploy` do arranque diz que não há migration pendente.
- O `health` responde 200.

**Se falhar:**
- `api` reiniciando em laço ou `unhealthy` depois de 5 minutos: `docker logs --tail 80 mktos_api` (o log não traz senha). Erro de variável obrigatória: corrija no easyPanel e recrie. Qualquer outro erro: passo 11.
- Boot com 71 capacidades: o seed do passo 5a não pegou. Rode de novo e recrie o `api`.

## 8. Permissões (0 a 5 min)

Compare antes de rodar qualquer coisa:

```bash
git -C "$FONTE" diff 10939e1 "$FINAL" -- packages/shared/src/permissions.ts | head -40
```

**Esperado: vazio.** A versão final não acrescenta permissão; as do Lucas (`cofre.ver`, `cofre.editar`) continuam no arquivo. Com o diff vazio, **pule este passo** (o `db:sync-permissions` realinha papel por papel e tira vínculo feito à mão; não rode sem precisar).

Se o `git diff` acusar que o commit `10939e1` não existe no checkout, compare no Predator (`git diff 10939e1 homolog/final-20261019 -- packages/shared/src/permissions.ts`) e traga o resultado.

Se o diff NÃO for vazio:

```bash
psql_prod 'select r.key, p.key from "_RolePermissions" rp join "Role" r on r.id = rp."B" join "Permission" p on p.id = rp."A" order by 1, 2' > "$VIRADA/papeis-antes.tsv"
docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" "rootos-official:final-$CURTO" pnpm db:sync-permissions
psql_prod 'select r.key, p.key from "_RolePermissions" rp join "Role" r on r.id = rp."B" join "Permission" p on p.id = rp."A" order by 1, 2' > "$VIRADA/papeis-depois.tsv"
diff "$VIRADA/papeis-antes.tsv" "$VIRADA/papeis-depois.tsv"
```

Conferir: só entram as permissões do diff; nada sai. Depois, **todo mundo sai do OS e entra de novo** (a permissão viaja no login).

**Se falhar:** saiu permissão que alguém usava: devolva o vínculo pela tela de papéis e registre. Não é motivo de rollback.

## 9. Organizar as tarefas reais (30 a 45 min)

O script `homolog/organizar/organizar.mjs` (lane D) é o mesmo que organizou a cópia na homologação: move listas e tarefas para as pastas da casa (Administrativa, Gestão, Clientes com Esteira, Onboarding de cliente e Execução; Marketing fica onde está), leva os cartões da Gestão de Leads ao funil (o cartão de origem arquivado com o link), os cartões de cadastro viram `Partner`, toda tarefa de comercial e gestão ganha cliente, e os testes são arquivados (nunca apagados). O que não tiver destino claro fica onde está e entra na lista de sobras.

Ele roda **no Predator**, onde estão os mapas (`homolog/copia/mapa-*.json` e os do próprio organizar, com dado real, fora do git), falando com a API de produção pelo endereço público. Precisa de:
- a URL da API: `https://os.operacaoroot.com/api`;
- duas contas de gente da produção, **com senha** (conta que só entra pelo Google não reautentica): quem pede, com `tarefas.editar`, `leads.editar`, `financeiro.ver` e `financeiro.editar`; e quem confere, outra pessoa, com alçada para confirmar o movimento de etapa (a régua não deixa a mesma pessoa propor e assinar);
- os mapas: `homolog/copia/mapa-crm.json`, `homolog/copia/mapa-gestao.json` e `homolog/organizar/mapa-novos.json` (no Predator; fora do git).

As senhas entram só na memória do terminal (Git Bash no Predator), nunca em arquivo:

```bash
cd /c/Users/User/dev/marketing-os
export ORGANIZAR_PEDE_EMAIL='<e-mail de quem pede>'   ; read -rs -p 'senha de quem pede: ' ORGANIZAR_PEDE_SENHA; echo; export ORGANIZAR_PEDE_SENHA
export ORGANIZAR_CONFERE_EMAIL='<e-mail de quem confere>'; read -rs -p 'senha de quem confere: ' ORGANIZAR_CONFERE_SENHA; echo; export ORGANIZAR_CONFERE_SENHA
ARGS="--api https://os.operacaoroot.com/api --web https://os.operacaoroot.com --mapas homolog/copia/mapa-crm.json,homolog/copia/mapa-gestao.json,homolog/organizar/mapa-novos.json --saida homolog/organizar/producao-$(date +%Y%m%d)"

# 9a. Simular: lista o que vai mover, sem gravar nada.
node homolog/organizar/organizar.mjs --simular --detalhe $ARGS
```

Antes de qualquer escrita o script confere três coisas e aborta, sem ter feito nada, se uma falhar: a API é a da versão final, a lista de `Partner` veio inteira, e nenhuma tarefa ainda aponta para cartão (a conciliação do passo 5b passou).

**Conferir com o Rodrigo**, linha a linha do resumo: quantas listas e tarefas vão para cada pasta, quantos leads vão ao funil, quantos `Partner` serão criados ou reaproveitados, quantas tarefas ficam como sobra. Os números devem bater com os da homologação final (`homolog/RESULTADO-FINAL.md`), descontado o que entrou na produção depois da cópia.

```bash
# 9b. Para valer (a flag --producao é obrigatória para escrever).
node homolog/organizar/organizar.mjs --producao $ARGS

# 9c. De novo, para provar que não repete nada.
node homolog/organizar/organizar.mjs --simular $ARGS

# Ao fim, as senhas saem da memória.
unset ORGANIZAR_PEDE_SENHA ORGANIZAR_CONFERE_SENHA
```

**Conferir:** a 9b termina sem erro e com os mesmos números da 9a. A 9c diz que não há nada a mover (zero em tudo, exceto as sobras, que continuam listadas). A lista de sobras fica em `homolog/organizar/sobras.md` no Predator (fora do git) e vai para o Rodrigo.

**Não rode depois da virada** a carga antiga do ClickUp do Lucas (`db:seed:tarefas`, `seed-tarefas-clickup.ts`) numa versão anterior a esta: ela gravava o cartão como cliente da tarefa, o que a chave nova recusa. Na versão final ela já resolve o cliente como `Partner`.

Tarefa criada na produção depois da cópia de 19/10 e que não está nos mapas não recebe o cliente da casa por suposição: ela vai para as sobras com "escolher à mão".

**Se falhar:**
- A simulação mostra algo que o Rodrigo não aprova: não rode a 9b. Ajuste o mapa no Predator, simule de novo.
- A 9b para no meio: rode de novo. O script é idempotente e continua de onde parou. Se o mesmo erro repetir, pare e guarde a saída (ela traz só contagens e ids).
- Algo foi movido errado: mova de volta pela tela, item a item. Só use o rollback do passo 11 se o estrago for grande e ninguém tiver trabalhado no OS desde a virada.

## 10. Conferências depois da virada (20 min)

Com uma conta de gente, no navegador:

| O que | Esperado |
|---|---|
| `https://os.operacaoroot.com/api/health` | 200 |
| Login | entra pelo Google e pela saída de emergência (e-mail e senha) |
| Menu lateral | recolhe e expande; as áreas na ordem do `RESULTADO-FINAL` |
| Motor Comercial | abre no **Painel geral** com números, sem erro; abas Painel geral · Funil vivo · Propostas · Lista de leads · Contratos vivos · Simulador de WhatsApp · Torre das automações · Relatório da semana; sem Clientes e Tarefas |
| Propostas | as antigas do Lucas continuam na lista |
| Dia a dia | abre na **Visão geral** (por pasta e lista), depois Pendências, Aprovações, Agenda, Painel geral da empresa |
| Trabalho › Tarefas | as pastas da casa no topo; "Todas" mostra tarefas de várias pastas; calendário; pop-up com vários responsáveis |
| Financeiro | abre como antes, com os números do mês |
| Cofre | abre e pede a senha do cofre, como antes |
| Configurações › Integrações | o Granola aparece como antes |
| Rotinas | nenhuma rotina nova nasceu ligada |

O roteiro automático faz a mesma volta, só lendo (não grava nada), e tira as fotos para a pasta fora do git:

```bash
BASE_URL=https://os.operacaoroot.com LOGIN_EMAIL='<e-mail>' LOGIN_SENHA='<senha>' node homolog/e2e/final.mjs
# ou, para quem entra só pelo Google: FINAL_TOKEN='<o mktos_token do navegador>'
```

Esperado: placar sem FALHA. Compare também os números de `contagens-antes.txt` com os de agora (`psql_prod` do passo 1b): tarefas iguais ou maiores (o organizar só arquiva), usuários iguais.

Registre ao fim: o commit (`<hash-final>`), a imagem (`rootos-official:final-<curto>`), o dump e a imagem de volta, a hora de cada passo e o que ficou pendente.

**Se falhar:** uma tela fora do foco (financeiro, cofre, Granola, análise, marketing) não abre como antes: é critério de rollback. Uma tela do foco (Motor Comercial, Dia a dia, Trabalho) com defeito pequeno: registre e corrija para frente.

## 11. Rollback (30 min)

**Quando acionar:**
- o `migrate deploy` falhou em produção (passo 5b);
- a API não fica `healthy` em 5 minutos depois do passo 7 e o log não aponta uma variável simples de corrigir;
- login ou menu quebrados para todo mundo;
- financeiro, cofre ou Granola sem abrir como antes;
- o organizar fez estrago grande e ninguém trabalhou no OS desde a virada.

**Quando NÃO acionar:** defeito pequeno numa tela do foco, ou depois que o time já gravou trabalho no OS novo. O restore volta o banco ao minuto do passo 1 e **perde tudo o que foi gravado depois**. Passada uma hora de uso real, prefira corrigir para frente.

Imagem e banco voltam juntos. A imagem antiga não lê o cliente da tarefa convertido pela conciliação, então voltar só a imagem não basta.

```bash
# 11a. Parar quem escreve.
cd "$PAINEL" && docker compose -p "$PROJETO" stop api web

# 11b. Guardar o estado que falhou (para entender depois).
docker exec mktos_db pg_dump -U mkt -d marketing_os -Fc > "$BACKUPS/rootos-falhou-$(date +%Y%m%d-%H%M).dump"

# 11c. Restaurar o dump do passo 1 num banco novo e trocar os nomes (o banco que falhou fica guardado).
docker exec mktos_db psql -U mkt -d postgres -c "create database marketing_os_volta"
docker exec -i mktos_db pg_restore -U mkt -d marketing_os_volta < "$BACKUPS/rootos-antes-da-virada-$HORA.dump" 2> "$VIRADA/rollback-restore.log"; tail -5 "$VIRADA/rollback-restore.log"
docker exec mktos_db psql -U mkt -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('marketing_os', 'marketing_os_volta') and pid <> pg_backend_pid()"
docker exec mktos_db psql -U mkt -d postgres -c "alter database marketing_os rename to marketing_os_falhou_$DIA"
docker exec mktos_db psql -U mkt -d postgres -c "alter database marketing_os_volta rename to marketing_os"

# 11d. A imagem de volta.
cat "$VIRADA/imagem-de-volta.txt" "$VIRADA/imagem-antes.txt"
```

- **Tag móvel:** `docker tag "$(cat "$VIRADA/imagem-de-volta.txt")" mktos-app:latest`.
- **Tag fixa:** no easyPanel, volte a linha `image:` do `api` e do `web` para o nome anotado em `imagem-antes.txt`. Se aquela etiqueta tiver sumido, use a de `imagem-de-volta.txt`. Se nem ela existir, `gunzip -c "$BACKUPS/imagem-rollback-$DIA.tar.gz" | docker load`.

```bash
# 11e. Subir a versão de antes.
cd "$PAINEL" && docker compose -p "$PROJETO" up -d --no-build api web
sleep 60
docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' | grep -E 'mktos_(api|web)'
docker logs --since 5m mktos_api 2>&1 | grep -E 'capacidades|ERROR' | tail -5
psql_prod 'select migration_name from "_prisma_migrations" order by finished_at desc nulls first limit 1'
curl -fsS https://os.operacaoroot.com/api/health; echo

# 11f. O código do checkout de volta ao que era (o stash do passo 2 continua guardado).
git -C "$FONTE" checkout "$(cat "$VIRADA/branch-antes.txt")"
git -C "$FONTE" log --oneline -1; cat "$VIRADA/sha-antes.txt"
```

**Conferir:** a imagem de antes no ar; o boot diz `71 capacidades` (a política volta com o dump, que é anterior ao seed); a última migration é `20261019220000_tarefas_varios_responsaveis`; o health responde 200; login e as telas do Lucas abrem; as contagens batem com `contagens-antes.txt`.

**Se o restore reclamar:** o log de `pg_restore` com erros de `extension` ou de `owner` costuma ser aviso; confira as contagens do passo 1b no banco restaurado antes de trocar os nomes. Se a produção usava o papel restrito (`DB_APP_USER` preenchido no painel), devolva a ele o acesso ao banco novo antes de subir: `docker exec mktos_db psql -U mkt -d postgres -c "grant connect on database marketing_os to mktos_app"`.

O banco `marketing_os_falhou_<data>`, os dumps e a imagem nova ficam onde estão. Quem decide apagar é a pessoa, depois de entender o que falhou.

---

## Depois da virada (não é desta noite)

- Cadastrar o webhook do Asaas (`https://os.operacaoroot.com/api/comercial/webhooks/asaas`) e o da ZapSign (`.../comercial/webhooks/zapsign`) nos painéis dos provedores, com os segredos do passo 6. Até lá, cobrança e assinatura não voltam sozinhas ao OS.
- Conta ZapSign com API e o modelo de contrato da Root redigido pelo Rodrigo.
- `WHATSAPP_PROVEDOR=evolution` só por decisão da mesa (K08).
- Nunca rodar `db:seed:comercial` em produção (ele recusa sozinho, mas não tente).
- Apagar, no Predator, as cópias de produção, as stacks `rootos-copia` e `rootos-final` com volumes, `homolog/copia/` e `homolog/organizar/` (lista exata no `RESULTADO-FINAL`).
