# Revisão adversarial da versão final (19/10/2026)

> Branch `homolog/final-20261019`, HEAD `95f747c`. Revisor adversarial, só leitura: nenhum
> código editado e nenhum commit feito. Sem dado de cliente: aqui só há contagens, nomes de
> esquema e caminhos de arquivo.
>
> Fontes comparadas: `lucas/tarefas` (abd1476; a produção roda 10939e1, que só difere no
> `seed-tarefas-clickup.ts`), `comercial/cockpit-homolog`, `main`, `pedro/operacao-painel-20261014`.
>
> Provas feitas:
> - Um Postgres descartável próprio (`advrev-pg`, pgvector pg16, porta 55439), já removido.
>   Nele: as 85 migrations da produção, depois as 13 nossas por cima (o ponto de partida da
>   produção); as 71 da `comercial/cockpit-homolog`, depois as 27 pendentes da HEAD (o ponto
>   de partida da homologação).
> - No `rootos_final_db`, só `SELECT count(*)` e nomes de coluna.
> - Três agentes de leitura cobriram os itens 2, 3 e 7. O resultado deles foi conferido por
>   amostra (login, propostas, compose).

Legenda de gravidade:
- **BLOQ**: bloqueia a virada.
- **ANTES**: corrigir antes do RESULTADO.
- **REG**: registrar.

## 1. Conciliação do `WorkTask.clienteId`

**O que se sustenta**
- **Nenhuma migration aplicada em produção foi editada.** As 85 pastas de `lucas/tarefas` têm o mesmo hash de árvore na HEAD. As 13 a mais na HEAD são todas nossas.
- **Ponto de partida da produção, provado no banco descartável.** O cenário: 2 empresas, 4 cards de cadastro, dois deles com o mesmo nome normalizado.
  - 4 tarefas convertidas e 3 `Partner` criados. Os dois cards de mesmo nome viraram um `Partner` só, e cada empresa ficou com o seu.
  - Ao fim: FK `WorkTask_clienteId_fkey` → `Partner` com `ON DELETE SET NULL`; nenhum CHECK do Lucas sobrando; gatilho `WorkTask_orgId_confere_cliente` criado.
  - Apontar uma tarefa para o `Partner` de outra empresa dá erro: `empresa cruzada`.
  - `WorkTask`, `Partner` e `WorkArea` ficam com RLS, FORCE e 4 policies.
- **Segunda passada da `20261019230000`**: o resumo md5 de (tarefa, cliente) e a contagem de `Partner` não mudam.
- **Ponto de partida da homologação, provado.** A coluna nossa volta a ser `clienteId` e o vínculo com o `Partner` fica. O preenchimento por `parentId` que a migration do Lucas faz é descartado, conforme a regra "nenhum backfill".

**Achados**

| # | Grav. | Onde | Cenário de falha | Conserto |
|---|---|---|---|---|
| 1.1 | ANTES | `20261019230000_conciliacao_cliente_da_tarefa/migration.sql` linhas 103-108 (agrupamento) e 111-115 (INSERT) | **A migration aborta.** Basta um card citado como cliente cujo título fica vazio depois de normalizado (só pontuação, emoji ou alfabeto fora do latim) e sem CNPJ: a chave do agrupamento sai `NULL`, o `partner_id` fica `NULL` e o INSERT em `Partner` estoura `null value in column "id"`. **Reproduzido** com um card de título `---`. Em produção é o `migrate deploy` do passo 5b falhando, ou a API sem subir. O ensaio 5a pega antes, mas aí a virada para no meio. | Chave do grupo `coalesce(cnpj, nome_normalizado, 'card:'||card_id)` e nome do Partner `coalesce(nullif(btrim(nome),''),'Cliente sem nome')`. Acrescentar o caso à prova dos três bancos. |
| 1.2 | ANTES | mesma migration, linhas 118-119 (`UPDATE "Partner" ... SET "isCliente" = true`) e o casamento por nome nas linhas 94-101 | **O Financeiro muda (fora do foco).** Um `Partner` que já existia e foi achado só pelo nome normalizado passa a ser cliente: um fornecedor de nome parecido vira cliente. Além disso, todo card citado vira `Partner` cliente, inclusive card em fase de **lead**: o seletor da produção oferecia leads (`fase: 'lead'`). O organizador depois transforma esses cards em lead do funil, mas o `Partner` cliente continua no Financeiro e nos seletores. | Só promover a `isCliente` quando o casamento for por CNPJ. Para card em fase de lead, não criar `Partner`: deixar a tarefa sem cliente, com o selo "sem cliente". No ensaio 5a, contar quantos cards citados estão em fase de lead. |
| 1.3 | REG | mesma migration, todo o bloco `DO` | **Vínculos somem em silêncio.** A migration depende de atravessar o RLS FORCE. Rodada por um papel sem `rolsuper`/`rolbypassrls`, a tabela de conversão sai vazia e a coluna antiga é apagada (`DROP COLUMN`). Hoje o dono `mkt` é superusuário, então passa. | Abortar no começo se `current_user` não atravessa RLS, ou conferir `convertidas = tarefas com clienteId` antes do `DROP`. |
| 1.4 | REG | `20261019170000_cliente_da_tarefa_preparo` | **O preparo não é reentrante.** Rodado de novo à mão depois da conciliação (por exemplo, numa recuperação manual), ele acha a FK final para `Partner` e renomeia `clienteId` para `clienteIdParceiro`: a coluna some do esquema. **Reproduzido.** O Prisma nunca reaplica, então só morde em mão humana. | Só agir se a migration `20261019180000` ainda não estiver aplicada (`to_regclass('"WorkArea"') IS NULL`). |
| 1.5 | REG | FK nova simples (`clienteId` → `Partner.id`) no lugar da composta do Lucas | Trocar o `orgId` de um `Partner` não é barrado pelo banco. O gatilho só confere a tarefa. | Aceitável. Registrar, ou acrescentar índice único `(id, orgId)` em `Partner` e FK composta. |
| 1.6 | REG | histórico das homologações | `20261018220000_implantacao_card` virou `…221000`, e a `20261019100000` foi editada em relação à versão das homologações. O `migrate status` das stacks antigas vai acusar migration "modificada" ou "ausente". | Anotar no RESULTADO para ninguém "consertar". |

**Código que ainda trata o cliente como card (consequência da conciliação)**

| # | Grav. | Onde | Cenário | Conserto |
|---|---|---|---|---|
| 1.7 | ANTES | `apps/api/src/work/tarefas-do-dia.service.ts:101-111` (`criarCliente`) com `apps/web/src/components/tarefas/TarefasDoDia.tsx:208-212` e `1199` | **Telas de produção quebradas (fora do foco).** Em `/financeiro/tarefas`, `/marketing/tarefas` e `/comercial/tarefas`, "Novo cliente" cria um **card na lista `crm-root-lista`** e devolve o id do card. Em seguida, `editar({clienteId})` cai em `conferirCliente`, que procura `Partner`, e responde 400 "Cliente não encontrado". O usuário vê erro, e um card órfão fica no CRM a cada tentativa. | `criarCliente` cria ou acha o `Partner` (`isCliente`) pela mesma regra de `clientes-da-casa.ts`, sem card. |
| 1.8 | ANTES | `apps/api/prisma/seed-tarefas-clickup.ts:110-116` (`db:seed:tarefas`, a carga do ClickUp do Lucas) | Depois da virada, a carga grava `clienteId` = id de um card. Isso viola a FK para `Partner` (P2003), e o script aborta na primeira tarefa com cliente. | Resolver o cliente como `Partner` (pelo nome do card), ou deixar `null`. Registrar no VIRADA: não rodar a carga antiga depois da virada. |
| 1.9 | REG | `tarefas-do-dia.service.ts:278` (`doCliente`) | O fallback compara o id do `Partner` com `parentId` (id de card). A deduplicação por cliente nunca casa nas tarefas antigas feitas pela ficha. | Tirar o fallback por `parentId`. |

## 2. Pedro e Lucas: nada quebrado nem ressuscitado fora do foco

**Conferido OK**
- `SECOES`: a única mudança é o Contexto em 7º, mudança nossa e documentada.
- `NAV` bate com `homolog/final/enxugamento.md` item a item:
  - nenhum item fora do foco mudou de chave, permissão ou módulo;
  - Banco de ideias e Estratégia do mês seguem visíveis no Motor de Marketing;
  - `marketing-tarefas`, `financeiro-tarefas` e `cofre` intactos.
- `ROTAS_ABSORVIDAS` só ganhou entradas.
- Nenhuma rota web da produção sumiu; a HEAD só acrescenta 16. Financeiro, cofre, conexões, análise, marketing, pauta, agentes, sessões, memória, contexto, operação e configurações: sem diff.
- Na API, nenhum `@Controller`, rota, `@RequirePermissions` ou guarda removido. O `app.module.ts` só ganha o `ComercialModule`.
- `permissions.ts` é idêntico ao da produção, `cofre.*` incluído. `modulos.ts` só ganha `sala → leads`.

**Achados**

| # | Grav. | Onde | Cenário | Conserto |
|---|---|---|---|---|
| 2.1 | ANTES | `apps/web/src/app/login/page.tsx:70` | Depois do login, quem tem `tarefas.ver` vai para `/dia-a-dia` sem conferir o **módulo** `trabalho`. Empresa cliente sem esse módulo cai em "Módulo não contratado". Na produção ia para `/contexto`. | Conferir o módulo antes de escolher o destino, ou cair na regra da produção. |
| 2.2 | ANTES (decidir) | `apps/web/src/app/onboarding/bancada/page.tsx` contra o `onboarding/page.tsx` da produção | Some a criação manual de trilho de onboarding: nenhuma tela chama mais `POST /tenants/onboarding/trilhos`. Cliente fechado fora do funil, ou empresa sem `leads`, fica sem como abrir a implantação. | Pôr "Novo trilho" na Implantação, ou registrar a perda no RESULTADO como decisão. |
| 2.3 | REG | `packages/shared/src/nav.ts:192` | Propostas passou de item da sessão da plataforma (`dashboard.ver`) a item do NAV com `leads.ver` e módulo `leads`. Quem na ROOT tinha só `dashboard.ver` perde o item. Não vaza dado: as propostas do serviço seguem presas à plataforma. | Previsto pela decisão 1; registrar. |
| 2.4 | REG | `apps/api/test/arquitetura.test.ts:854` | A catraca fica vermelha por causa de `apps/api/src/obsidian/contexto-movimento-explicito.service.ts:19` (veio da produção, idêntico): o `ObsidianService` é importado fora da porta. | O dono da produção decide entre exceção com motivo e passar pela porta. Não afrouxar a catraca. |
| 2.5 | REG | comentários em `nav.ts:181`, `nav.ts:250` e `Sidebar.tsx:230` | Descrevem o menu antigo (por exemplo, "/comercial redireciona ao Funil vivo"). | Atualizar. |

## 3. Política, porta, alçada e isolamento

- **Nada afrouxou.**
  - As 63 capacidades da produção e as 69 da nossa estão iguais na HEAD, campo a campo: nível, `aprovacao`, sensibilidade e esquema.
  - O delta vai de 1.7.0 a 1.9.0 com exatamente as 6 `comercial.*` (3 R3 e 3 R4). Nenhum esquema aceita mais, então basta `POLITICA_CAPACIDADE_NOVA_*`, como o VIRADA diz.
  - `packages/policy` passa 101/101.
  - `gateway/`, `alcada.ts` e `lotes.service.ts` sem afrouxamento.
- **Isolamento.**
  - Toda tabela com `orgId` criada desde `20260911050000`, as da produção (cofre, `WorkArea`, acordos, análise, reuniões, operação, editorial) e as nossas, passa por `app_rls_aplicar_policies`: leitura e escrita separadas, mais FORCE.
  - `FILHOS_COM_ORGID_REDUNDANTE` = 31, coerente com as migrations.
  - Todo prefixo de `@Controller` está declarado em `modulos.ts`.
- **Rotas públicas novas para a produção:**
  - `sala/:token/*`: empresa pelo hash do token, `comTenantPublico` e teto por origem e por token;
  - `comercial/webhooks/{asaas,zapsign}`: segredo em tempo constante, falha fechada sem variável.
- Achado de isolamento: só o 1.3 acima.

## 4. Neutralização da cópia

**Medido no `rootos_final_db`, só contagens**
- Credenciais vivas, todas com contagem zero:
  - `SegredoDeConector` fora do marcador;
  - token do Google;
  - `CofreItem` cifrado;
  - convite de onboarding com token cifrado;
  - rotina ativa.
- `SalaDoCliente`: 0 linhas.
- `IntegrationAccount` (9 linhas) só tem chaves de configuração não secretas (`destino`, `dir`, `folderId`).
- A stack usa `LLM_PROVIDER=stub`, `ROTINAS_CRON=off`, `PAUTA_CRON=off`, Asaas/ZapSign/propostas nos dublês e Evolution/Apify/OpenAI/Anthropic vazios.

**Achados**

| # | Grav. | Onde | Cenário | Conserto |
|---|---|---|---|---|
| 4.1 | REG | `homolog/organizar/neutralizar-copia.mjs` (lista de tabelas) | O script não cobre as tabelas nossas que passam a existir na produção depois da virada: `SalaDoCliente.tokenHash`/`tokenCifrado` (link público `/s/<token>` vivo), além de segredos de webhook ou cobrança do cockpit, se houver. Uma cópia da produção feita **depois** da virada sairia com a sala do cliente abrindo na homologação. | Acrescentar `SalaDoCliente` (hash aleatório, cifrado nulo), mais uma varredura que falhe se sobrar coluna `*token*`/`*cifrad*`/`*segredo*` não tratada. |
| 4.2 | REG | idem | 1 `Approval` pendente segue pendente: o hash do token foi trocado, mas ela aparece na fila da homologação. | Expirar as pendentes na neutralização. |
| 4.3 | REG | idem | `User.email` e nomes reais ficam. As senhas são aleatórias e o login com Google só funciona com credencial da stack. | Aceitável para homologação local; registrar. |

## 5. Organizador (`homolog/organizar/organizar.mjs`)

**Conferido**
- `--simular` não escreve:
  - toda escrita (POST, PATCH, DELETE) está atrás de `if (SIMULAR)`;
  - o `GET /trabalho/tarefas/:id` não grava nada;
  - o único rastro é o login das duas contas.
- Arquivar é `DELETE /trabalho/tarefas/:id`, que é `archived: true` com versão: nunca apaga.
- Marketing nunca é escrito.
- A entrada de lead é idempotente (`ref cartao:<id>`).

**Achados**

| # | Grav. | Onde | Cenário | Conserto |
|---|---|---|---|---|
| 5.1 | ANTES | `organizar.mjs:282` (`GET /finance/partners` com `.catch(() => ({ items: [] }))`) | Uma falha do GET (403 sem `financeiro.ver`, 5xx passageiro) vira "nenhum Partner existe". Se o POST passar, nascem **`Partner` duplicados** de clientes que já existiam e que o mapa cita sem vínculo da conciliação. | Remover o `catch` e abortar. Exigir `financeiro.ver` e `financeiro.editar` da conta que pede. |
| 5.2 | ANTES | `organizar.mjs:490-515` (varredura) | **Cliente da casa posto errado.** Lista movida para Administrativa ou Gestão leva junto as tarefas que **não estão nos mapas**, criadas na produção depois da cópia. Elas recebem o cliente da casa automaticamente, mesmo sendo de cliente. | Na passada real, preencher `interno` só nas tarefas do mapa. As outras vão para as sobras com "sem cliente". |
| 5.3 | ANTES | todo o script | **Nenhuma conferência de versão.** Contra a API antiga, a simulação lê `clienteId` como id de card e conta como "achado"; a passada real falha no meio. | Antes de tudo, conferir que a API é a do merge (`POST /trabalho/estrutura/sugerida` existe, ou `clienteNome` aparece na tarefa) e abortar se não for. |
| 5.4 | REG | `organizar.mjs:81-83` | A trava `--producao` só vale para endereço público. Pela rede interna da VPS (`127.*`, `172.*`) a passada real escreve sem a flag. | Exigir `--producao` sempre que não for `--simular`, ou uma flag `--homologacao` explícita. |
| 5.5 | REG | passos 2 a 6 | **Sem transação** (é pela API, de propósito). Uma queda entre `mover/pedido` e `confirm` deixa uma aprovação pendente; a nova passada abre outra. O lote de 500 em `GET /trabalho/tarefas?limit=500` ignora o excedente. | Documentar. Paginar a varredura. |
| 5.6 | REG | `organizar.mjs:469` | A confirmação exige a **senha** de quem confere (reautenticação). Conta que só entra pelo Google não consegue: os leads caem em "recusados" e vão para as sobras. | Dizer no VIRADA quais duas contas têm senha. |

## 6. `docs/comercial/VIRADA-PRODUCAO.md`

| # | Grav. | Onde | Problema | Conserto |
|---|---|---|---|---|
| 6.1 | ANTES | linhas 260, 277 e 322 | **A contagem de migrations está errada.** O texto diz "12 que ela ainda não tem", "as doze primeiras" e "o primeiro `migrate status` lista 12… aplica as 12". A tabela tem 13, e o passo 5b e o total de 98 também contam 13. Quem seguir a conferência do ensaio vai achar divergência e parar. | Trocar para 13 (as 12 primeiras têm data anterior; a 13ª é a conciliação). |
| 6.2 | ANTES | passo 4, antes de 5a | **O seed da política vai à produção antes do ensaio das migrations.** Se o ensaio falhar (por exemplo, pelo 1.1), a produção já ficou com a política 1.9.0 sob a imagem antiga, e a "parada sem rollback" deixa de ser verdade. | Ensaio completo primeiro: restore, seed, migrate duas vezes e smoke no `virada_ensaio`. Só depois, seed e migrate em produção. |
| 6.3 | ANTES | passo 9 | Faltam três coisas: (a) `--producao`, que a passada real pela URL pública exige (sem ela, o script recusa); (b) **como** passar as senhas sem gravá-las (o script lê de variável ou `--env`; sugerir `read -rs ORGANIZAR_PEDE_SENHA; export …` e `unset` ao fim); (c) as duas contas precisam ter senha e `financeiro.ver`/`financeiro.editar`, `tarefas.editar` e alçada. | Escrever os argumentos completos. |
| 6.4 | REG | depois do passo 9 | Falta o aviso de não rodar `db:seed:tarefas` (a carga do ClickUp) depois da virada (achado 1.8). | Acrescentar. |
| 6.5 | REG | passos 0 e 6 | O VIRADA dá `PROPOSTAS_URL`/`PROPOSTAS_API_TOKEN` como "continuam como estão", mas eles **não estão** no bloco `environment:` do `docker-compose.yml` do repositório, nem na produção nem na HEAD. Se o compose do easyPanel também não os tiver, Propostas mostra só o aviso de serviço fora. | No passo 0, `docker exec mktos_api printenv \| grep -c '^PROPOSTAS_'` (conta, sem valor). Pôr as duas no compose do repositório, sem padrão. |
| 6.6 | REG | passo 3 | `$IMG_ID` nasce no passo 1c, e não no bloco de variáveis da sessão. Se a sessão cair, o build lê `Config.Env` de uma imagem vazia. | Mover `IMG_ID` para o bloco de variáveis. |
| 6.7 | REG | passos 5b a 7 | Durante a janela, a API antiga grava `clienteId` = card. Isso viola a FK nova, e tarefa com cliente dá 500. Está avisado ("instável"). | Opcional: parar `api` e `web` durante 5b-7. |

O que está bem no VIRADA:
- passo 0 sem paralelismo;
- dump `-Fc` com `--list` e sha256;
- `docker tag` e `docker save` da imagem;
- ensaio num banco descartável com segundo `migrate deploy`;
- variáveis novas nos dois lugares;
- `db:sync-permissions` só com diff, e o diff é vazio;
- rollback de imagem e banco juntos, com o banco que falhou guardado.

## 7. Telas novas do foco: isolamento e permissão

**Conferido OK**
- Propostas da sala, Painel geral do Comercial, Lista de leads, Todas as tarefas, ordem manual do Trabalho, Caixa, ficha, histórico da tarefa: toda consulta nova leva `orgId`; o detalhe de outra empresa dá 404.
- O lote é um PATCH por tarefa, com versão.
- Os `outrosResponsaveisIds` são conferidos na empresa e ativos.
- O serviço antigo de propostas fica atrás do `SessaoDaPlataformaGuard`, com token só no servidor e sem SSRF.
- `PUBLICAS` do AppShell sem mudança; nenhum `dangerouslySetInnerHTML` novo.

**Achados (todos REG, nenhum vazamento entre empresas)**
- `apps/api/src/ficha/ficha.service.ts:28`: `user.findMany({ id: { in } })` sem `orgId`. Hoje não é explorável, porque os ids vêm de linha já filtrada. Acrescentar `orgId`.
- `apps/api/src/work/tarefas-do-dia.controller.ts`: `GET /`, `GET areas` e `POST areas` sem `AcessoAtualGuard` (confiam no token de 8h). Além disso, `areas()` (`tarefas-do-dia.service.ts:69-76`) cria as áreas padrão dentro de um GET, com `tarefas.ver`.
- `tarefas-do-dia.service.ts:380-386`: a ordem manual do Dia a dia não confere `expectedUpdatedAt`, ao contrário do Trabalho.
- `work.service.ts:140-143`: a estrutura devolve o e-mail de toda a equipe, inativos e contas de sistema incluídos, a quem tem `tarefas.ver`. Usar `pessoas()`.
- `packages/shared/src/ficha-do-cliente.ts:21`: `z.string().url()` aceita `javascript:` no link da reunião. O React 19 bloqueia no `href`, mas é melhor aceitar só `http` e `https`.

## Veredito

**Fecha com ressalvas.**

Nenhum achado bloqueia a virada:
- o histórico de migrations da produção está intacto;
- a conciliação está provada nos dois pontos de partida, com segunda passada sem mudança;
- política, porta, alçada, permissões e isolamento não afrouxaram;
- o ensaio 5a do VIRADA pega a falha da conciliação (1.1) antes da produção.

Antes do RESULTADO, corrigir:
- 1.1 (nome vazio derruba a conciliação);
- 1.2 (fornecedor ou lead vira cliente no Financeiro);
- 1.7 ("Novo cliente" quebrado nas Tarefas do Financeiro, do Marketing e do Comercial);
- 1.8 (carga do ClickUp quebra);
- 2.1 (login sem o módulo `trabalho`);
- 2.2 (decidir a criação manual de trilho);
- 5.1, 5.2 e 5.3 (organizador);
- 6.1, 6.2 e 6.3 (VIRADA).

O resto é registro.
