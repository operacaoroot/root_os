# Revisão adversarial · Cópia dos cartões do Lucas (19/10/2026)

Branch `homolog/copia-lucas-20261019`, commits `de805ad..4dfb1f5` (6, autor `Operacao ROOT <operacao.root@gmail.com>`).
Revisão feita às 16:42–16:50. Nenhum código nem dado alterado; a única escrita foi uma passada do
importador (item 6), autorizada pelo roteiro da revisão, e este arquivo. Sem dado de cliente aqui: só
caminhos, linhas e contagens.

## Resumo

| # | Ponto | Veredito |
|---|---|---|
| 1 | Vazamento para o git | CONFIRMADO-OK |
| 2 | Vazamento para log | P3 (dois caminhos de erro) |
| 3 | Staging isolado | **P2** (a API alcança a porta do staging pelo host) + P3 (rede do staging com saída) |
| 4 | Segredos da produção | CONFIRMADO-OK (P3: contas com senha conhecida além do login único) |
| 5 | RLS e regras | CONFIRMADO-OK com ressalvas P3 |
| 6 | Idempotência | CONFIRMADO-OK (rodado); P3 em dois cantos da lógica |
| 7 | rootos-comercial intacta | CONFIRMADO-OK |
| 8 | Contas da importação desativadas | **P2** (ainda ativas, `--desativar` não rodou) |

## 1. Vazamento para o git · CONFIRMADO-OK

- `git diff --stat de805ad..HEAD`: 8 arquivos (compose, `e2e/copia.mjs`, `importar-copia/{EXCECOES.md,MAPA.md,comum.mjs,importar.mjs,preparar-destino.mjs}`, `progresso.md`).
- Varredura das linhas `+` do diff por e-mail, CNPJ, hash bcrypt (`$2a$/$2b$`), hex ≥ 32, token ≥ 40 caracteres, `sk-`, `aact_`: só aparecem os e-mails fictícios `importador@copia.homolog`, `conferente@copia.homolog` e os da semente `*@marketing-os.local`, e o padrão de dublê `aact_hmlg_dublê` (`docker-compose.copia.yml:118`). Nenhum dado de cliente.
- `progresso.md` (diff): só contagens, portas, nomes das NOSSAS listas e um prefixo de 8 caracteres do sha256 do dump (inofensivo).
- `MAPA.md` e `EXCECOES.md`: só formato e regras.
- `.gitignore:38` cobre `homolog/copia/`; `.gitignore:10` (`.env.*`) cobre `homolog/.env.copia` (conferido com `git check-ignore -v`). `git log --all -- homolog/copia homolog/.env.copia`: nunca commitados.
- Arquivos com dado real FORA do git (para o Rodrigo saber onde estão; quem apaga é ele):
  - `C:\Users\User\dev\producao\producao-root-20261019.dump` (≈ 61 MB, o dump inteiro da produção, inclusive cofre e hashes);
  - `C:\Users\User\dev\marketing-os\homolog\copia\` (`mapa-crm.json`, `mapa-gestao.json`, `_lane-d-tarefas.json`, `_lane-d-gerar.py`, `mapa-das-tarefas.md`, `prova-copia.json`, `contagens.json`, `IMPORTADO`, `STAGING-PRONTO`, `restore.log` vazio, `fotos/`);
  - `C:\Users\User\dev\marketing-os\homolog\.tmp\revisao-importar.log` (saída da passada desta revisão: só contagens);
  - volumes Docker `rootos-copia_rootos_copia_staging` (dump restaurado) e `rootos-copia_rootos_copia_db` (destino com os cartões);
  - `C:\Users\User\dev\scratch-e\insp*.mjs`: três scripts de inspeção; leem a senha do `.env`, nada embutido.

## 2. Vazamento para log · P3

O que vai ao console, por arquivo:
- `importar.mjs:504` imprime o objeto `contagem` (números; chaves de `porLista` são `pasta / lista` do NOSSO modelo; chaves de `avisos` são frases fixas + código HTTP). `:510/:512` frases fixas. O detalhe com título e cliente vai a `homolog/copia/mapa-das-tarefas.md` (`:486`), fora do git. OK.
- `preparar-destino.mjs:141,218`: só contagens e o slug `root`. OK.
- `e2e/copia.mjs:95,214,264,520,521`: nome do passo + detalhe; os `conferir(...)` de `:340-475` montam mensagens só com contagens; `:293` e `:308-309` citam nomes de pasta/lista do destino (nossas). Nenhum locator embute título ou nome (todos por `data-testid`/atributo), então erro de timeout do Playwright não carrega dado. OK.

Riscos residuais (P3):
- **P3 · erro não tratado pode carregar texto da API ou do staging.** `comum.mjs:84-85` corta em 300 caracteres a `message` da API, ou `JSON.stringify(json)` quando não há `message`. Com o filtro do Zod (`apps/api/src/common/zod-exception.filter.ts:11`), o corpo traz `issues[].message`, e mensagem de enum do Zod inclui o valor recebido. Os campos enviados que poderiam cair aí são normalizados antes (`importar.mjs:356` prioridade), então o risco é baixo; mas as chamadas fora de `try` (`importar.mjs:166,192,208,216,230`) estouram até o console com essa mensagem. Busca por exceções da API que interpolam nome/título/e-mail em `finance`, `work`, `leads`, `comercial`, `approvals`: nenhuma.
- **P3 · `JSON.parse` do staging.** `comum.mjs:46`: se o psql devolver algo que não é JSON (aviso, linha extra), o `SyntaxError` do Node recente cita um trecho do texto recebido, que é dado de produção, e `preparar-destino.mjs` não tem `try` em volta. Sugestão: capturar e relançar com mensagem fixa.
- `e2e/copia.mjs:515` imprime `e.message` de falha fora dos passos (mesma classe do primeiro item).

## 3. Staging isolado · P2 + P3

Confirmado:
- `docker-compose.copia.yml:39-51`: staging só na rede `rootos-copia-staging-net`, porta `127.0.0.1:5442` (conferido em `HostConfig.PortBindings`), sem Tailscale.
- `docker network inspect rootos-copia-staging-net`: só `rootos_copia_staging`. `rootos-copia-net`: db, api, web, redis, dublês; o staging não está nela.
- Variáveis da API e do web: nenhuma cita staging nem 5442; `DATABASE_URL` aponta para `db:5432/rootos_copia`. `getent hosts staging` dentro da API: não resolve.
- Bancos: no `rootos_copia_db` só `postgres, rootos_copia`; o dump vive em `producao_staging`, no outro container. A regra "o dump nunca é restaurado num banco que uma API lê" está cumprida.

Problemas:
- **P2 · a API alcança o staging pela porta publicada no host.** De dentro de `rootos_copia_api`, `net.connect('host.docker.internal', 5442)` abre, e o Postgres responde à mensagem de partida pedindo SASL (código 10). No Docker Desktop, porta publicada em `127.0.0.1` do host é alcançável por qualquer container da máquina via `host.docker.internal` (o mesmo vale para 5440, a da rootos-comercial). O isolamento é só a senha (`pg_hba`: `host all all all scram-sha-256`), não a rede; o comentário de `docker-compose.copia.yml:9` ("sem rota a partir da API") e de `comum.mjs:6` não são verdade no Windows. O staging tem o cofre da produção (3 linhas em `SegredoDeConector`, 1 `GoogleAccount`, 1 `BioConexao`) e roda com superusuário. Correção sugerida: não publicar a porta do staging e ler só por `docker exec` (o `lerStaging` já faz isso, `comum.mjs:33-44`; a porta 5442 nem é usada pelo importador), ou derrubar o container do staging quando a importação acabar.
- **P3 · rede do staging com saída.** `rootos-copia-staging-net` tem `internal=false`: o container com o dump tem rota para a internet. Nada lá chama fora hoje, mas `internal: true` na rede fecha a porta sem custo (com a porta publicada removida, como acima).

## 4. Segredos da produção · CONFIRMADO-OK (P3 nas contas)

- `preparar-destino.mjs:168-171` lê do staging só `name, email, phone, isActive` e os papéis. Nunca `passwordHash`, nunca tabela de conexão ou cofre. Senha: `:188` hash de 32 bytes aleatórios jogados fora, exceto admin da semente (`ADMIN_PASSWORD`), o login do Rodrigo (`COPIA_LOGIN_SENHA`) e as duas da importação.
- No destino (`rootos_copia_db`), por `count(*)`: `SegredoDeConector 0`, `GoogleAccount 0`, `MetaAccount 0`, `BioConexao 0`, `BioChallengeAccount 0`, `BioOauthState 0`, `BankConnection 0`, `EnvioDeResposta 0`, `EnvioAoYoutube 0`. `IntegrationAccount 1`: chave `obsidian`, status `error`, `config` vazio, criada às 19:17Z pela própria API no arranque (sonda), não importada.
- Hashes: comparação em memória (nada impresso) entre `User.passwordHash` do staging (8) e do destino (10): **0 iguais**; 0 hashes repetidos no destino; as 8 contas da produção casam por e-mail.
- `User.phone` preenchido no destino: 0 (o código copia telefone, `preparar-destino.mjs:169,206`, o que vai além de "nome, e-mail e papel" da regra; hoje sem efeito porque a produção não tinha).
- Segredos do `.env.copia`: nenhum repetido entre si, nenhum igual aos do `.env.homolog`, todos com ≥ 16 caracteres (conferido sem imprimir).
- **P3 · "o login da homologação é um só" não está literal.** Têm senha conhecida no destino: o login do Rodrigo, `admin@marketing-os.local` (`ADMIN_PASSWORD`, `preparar-destino.mjs:205`) e as duas contas da importação (`admin_master`, `:216`). Com o item 8 resolvido, sobram duas; a do admin da semente pode ser desativada também.

## 5. RLS e regras · CONFIRMADO-OK com ressalvas P3

- `grep sqlDestino`: escrita só em `importar.mjs:317` (T, `createdAt`), `:374` (T, `externalId` + `createdAt`) e `:394` (C, comentário); leitura em `:106-112` (L) e `:149` (Org por slug). Bate com `EXCECOES.md` itens T, C e L.
- `UPDATE` de `WorkTask` (`:317`, `:374`) filtram por `id` **e** `orgId`.
- **P3 · `importar.mjs:394-396`** (`UPDATE "WorkComment"`) filtra por `id` e `taskId`, sem `orgId` (a tabela tem `orgId`). Risco prático nulo (id é uuid da linha recém-criada e `taskId` é da empresa), mas foge do padrão declarado e é o único caminho que reescreve AUTOR (`authorId/authorName`) por fora da API. Na cópia de hoje não executou (produção com 0 comentários; destino com 71 `WorkComment` = 71 de procedência, pela API).
- **P3 · `preparar-destino.mjs` escreve por Prisma direto** (Org, Permission, Role, User: `:149-217`), como o `seed.ts`, sem passar pela API nem pelo RASTRO. Está explicado no cabeçalho do script, mas não em `EXCECOES.md`, que só cobre o importador.
- **P3 · RLS inerte na stack.** As tabelas estão com `ROW LEVEL SECURITY` + `FORCE` (`app_rls_estado()`), mas a API e o `sqlDestino` conectam como `rootos`, superusuário com `rolbypassrls`; `.env.copia` não define `DB_APP_USER`. É o mesmo estado da produção descrito no CLAUDE.md, então o filtro por `orgId` no SQL é a única trava.
- Regras do nosso código **não contornadas**:
  - porta da implantação: `importar.mjs:286-293` desvia para Execução em vez de forçar (3 cartões); a prova registra a Implantação vazia como FALHA;
  - etapas de sistema `contrato`/`fechado`: `:438-445`, ficam em `proposta` (6 leads);
  - geladeira/parceiro sem dado: `:447-451`, não inventa;
  - mover etapa: `:458-460` pedido → `confirm` com reautenticação e motivo → mover com `x-approval-token`. No destino, `Approval`: 17, todas `consumida`.
  - **P3 · separação de funções formal.** Quem pede (`importador`) e quem assina (`conferente`) são duas contas `admin_master` operadas pelo mesmo script com as duas senhas do mesmo `.env` (`:146-147,459`). A régua é respeitada na letra; a "segunda pessoa" é o mesmo operador. Aceitável numa homologação, desde que o RESULTADO diga isso.
- Arquivamento (`:413-418`): copiadas que o mapa novo tira são arquivadas pela API (`DELETE` = arquivar), reversível; não apaga nada. Hoje: 0 arquivadas.

## 6. Idempotência · CONFIRMADO-OK (rodado)

Pré-condições: `homolog/copia/IMPORTADO` às 16:28; mapas sem mudança desde 16:24; nenhum `node.exe` com `importar`, `preparar-destino` ou `copia.mjs` na linha de comando (`Get-CimInstance Win32_Process`). Uma passada às 16:45:30, saída em `homolog/.tmp/revisao-importar.log`, exit 0, "passada verde".

| tabela | antes | depois |
|---|---|---|
| WorkTask (arquivadas) | 71 (0) | 71 (0) |
| Lead | 17 | 17 |
| Partner | 6 | 6 |
| WorkComment | 71 | 71 |
| WorkTag | 4 | 4 |
| LeadEvent | 51 | 51 |
| Approval | 17 | 17 |
| WorkList | 7 | 7 |
| AuditLog | 272 | 274 (os 2 `auth.login` das contas da importação) |

Contadores da passada: tarefas criadas 0 / já existiam 71 / recusadas 0, leads criados 0 / já existiam 17 / movidos 0, Partners criados 0, comentários 0, etiquetas criadas 0. `WorkTask` com `externalId like 'prod:%'`: 71, sem duplicata, nenhuma sem `externalId`.

Cantos da lógica (P3):
- **Janela entre o POST e o UPDATE** (`importar.mjs:370` → `:374`): se o processo cair ali, a tarefa fica sem `externalId` e a próxima passada cria outra. O mesmo vale para os comentários (`:380-398`): tarefa já marcada não recebe de novo os que faltaram. Mitigação simples: gravar o `externalId` antes dos comentários (já é assim) e, na passada seguinte, procurar tarefa sem `externalId` com o mesmo título e lista antes de criar.
- **Partner com nome > 160 caracteres**: criado com `slice(0,160)` (`:192`), mas achado pelo nome inteiro (`:173-174`); cada passada criaria outro. Hoje nenhum caso (0 criados na 2ª passada).
- `GET /finance/partners` não pagina (`apps/api/src/finance/apr.service.ts:113`), então a busca de dedupe vê todos. OK.

## 7. rootos-comercial intacta · CONFIRMADO-OK

- `rootos_comercial_api/web`: criados 19/10 17:36Z (14:36 local), antes da stack da cópia (19:06Z) e do início da rodada (16:17 local); `db/redis/dublês`: criados 13/10, iniciados 14/10. Nada recriado na rodada.
- `grep -E "3010|4010|5440|rootos_comercial"` nos scripts da rodada: só o comentário e a trava de `e2e/copia.mjs:52` (que RECUSA 3010/4010) e o reuso das imagens dos dublês (`docker-compose.copia.yml:68,80`, só leitura da imagem). Portas do `.env.copia`: 3020, 4020, 5441, 5442.

## 8. Contas da importação · P2

- `preparar-destino.mjs:139-142` (`--desativar`) existe e faz `updateMany isActive=false` nas duas.
- **P2 · no destino às 16:47, `importador@copia.homolog` e `conferente@copia.homolog` estão `isActive = true`**, ambas `admin_master`, com senha no `.env.copia`, numa API publicada também no Tailscale (`docker-compose.copia.yml:132`). Rodar `node homolog/importar-copia/preparar-destino.mjs --desativar` ao fim da rodada (a passada desta revisão logou com elas; se houver nova passada, desativar depois). Contas ativas no destino: 10 de 10 (8 da produção + 2 da importação).

## Ações sugeridas, por ordem

1. (P2) `preparar-destino.mjs --desativar` e conferir `isActive`.
2. (P2) Tirar a porta 5442 do compose do staging (o importador usa `docker exec`), ou parar o container ao fim; `internal: true` na rede do staging.
3. (P3) `orgId` no `UPDATE "WorkComment"` (`importar.mjs:394-396`); mensagem fixa no `JSON.parse` de `lerStaging` e nas chamadas fora de `try`.
4. (P3) Registrar em `EXCECOES.md` (ou no RESULTADO) a escrita por Prisma do `preparar-destino.mjs`, a conta `admin@marketing-os.local` com senha conhecida e que o par importador/conferente é operado pelo mesmo script.
5. Fora do git, para o Rodrigo decidir quando apagar: o dump em `C:\Users\User\dev\producao\` e a pasta `homolog/copia/`.
