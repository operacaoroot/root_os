# A8 — Delegação e contratação (o agente que reparte o trabalho)

> Especificação gerada em 13/09/2026 pelo workflow `controle-de-agentes-fatias`, na branch
> `root-os/controle-agentes`. **Não é código, e as decisões marcadas abaixo são do Pedro** —
> nenhuma delas foi tomada por agente. Plano: `docs/PLANO-CONTROLE-DE-AGENTES.md`.


## O caminho recomendado

A delegação não é um agente que escreve no banco dos outros — é um agente que produz um DOCUMENTO e para. O desenho tem três peças e nenhuma delas dá poder novo a um agente.

**1. O plano é o artefato.** O agente-regente não chama "criar tarefa" N vezes; ele propõe UM `PlanoDeDelegacao` com até N `ItemDoPlano`, cada item declarando `capabilityId` + `args` + o "porquê". Isso resolve de graça o problema de tela (uma coisa para ler, não cem) e o problema de rastro (um `contentHash` sobre o plano inteiro, um fio de correlação). A capacidade é `delegacao.plano.propor`, **R2** — registro interno, reversível por `delegacao.plano.alterar`. Em R2 a aprovação é `configuravel`: o cliente que quiser ver cada plano antes de existir liga o interruptor de R2 e não se muda uma linha de código.

**2. Executar o plano é um TRADUTOR, não uma capacidade.** `POST /delegacao/planos/:id/executar` não é ação de agente nem capacidade do catálogo: é o mesmo padrão que a fatia 3.3 usou para as escritas do Google (`apps/api/src/gateway/porta-do-operador.service.ts`). O handler percorre os itens e entrega **cada um** à porta, com a sua própria capacidade e o seu próprio nível. Item de tarefa é R2 e sai (ou é retido, se o interruptor de R2 estiver ligado); item de contratação é R3+ e **fica retido, com aprovação própria, exigindo segunda pessoa**. A resposta é 200 com `{executados, retidos:[{approvalId, precisaDeOutraPessoa:true, fila:'/atendimento'}], recusados}` — nunca 201, nunca "✅ feito". A tela diz a conta ANTES do clique: "3 tarefas saem agora · 1 contratação vai para a fila e precisa de outra pessoa com alçada".

**3. Contratar cria um agente VAZIO.** `agente.contratar` não concede capacidade nenhuma. O agente nasce `estado='planejado'`, `ativo=false`, `autonomiaAte=R0`, `capacidades=[]`, `podeDelegar=false`, `geracao = geracao(quem propôs) + 1`, e o **dono é quem ASSINOU** — resolvido por `apps/api/src/agents/donos-da-casa.ts`, nunca por `include: { dono }`. Dar capacidade ao agente novo continua sendo `PATCH /agents/:slug`, que já tem guarda (`CONFIGURAR_AGENTE`). É isso que permite a contratação ser R3 e não R4: o ato de contratar, por si, não move poder — ele cria uma linha sem alcance, e quem lhe dá alcance passa por outra porta, com outro registro. Se a contratação também concedesse capacidade num passo só, ela seria R4 — e aí bate o problema de redação descrito nos riscos.

**Recursão fechada por construção:** `geracao > 1` é recusado, e agente contratado nunca recebe `podeDelegar`. Um agente não pode fundar uma dinastia; ele pode, no máximo, pedir um colega — e só com assinatura de gente.

**O freio de volume é uma tabela, não uma esperança.** `LimiteDeDelegacao` por empresa (`itensPorPlano` 12 · `planosPorDia` 3 · `contratacoesPorMes` 1). O teto de itens tem de bater **na porta**, no passo 3 (validação de `argsSchema`), porque recusa fora da porta não entra em `PolicyDecision` nem no RASTRO — foi exatamente o defeito que a fatia 5.6 consertou movendo o rebaixamento para dentro. Só que `validarArgs` **não conhece `maxItems` hoje** e o ignoraria calado: ensinar `maxItems` ao validador é parte desta fatia.

**A linhagem.** `ItemDoPlano.taskId` → `WorkTask.planoId`/`itemDoPlanoId` → `PlanoDeDelegacao.metaId` (A5). É por aí que toda tarefa traça até a meta e que o "porquê" chega ao prompt. Enquanto A5 não existir, `metaId` é nulo e o plano se amarra só à sessão — o que funciona, e é metade da promessa.


## Modelo de dados

- ENUMS — `CREATE TYPE "EstadoDoPlano" AS ENUM ('proposto','aprovado','executado','parcial','descartado','expirado');` · `CREATE TYPE "TipoDeItemDoPlano" AS ENUM ('tarefa','contratacao');` · `CREATE TYPE "EstadoDoItemDoPlano" AS ENUM ('pendente','retido','executado','recusado','descartado');` — `parcial` existe porque um plano com tarefa E contratação sai pela metade de propósito: as tarefas saem no clique, a contratação fica na fila. Sem esse estado a tela teria de mentir 'executado' ou 'proposto'.
- TABELA `PlanoDeDelegacao` — `CREATE TABLE "PlanoDeDelegacao" ("id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "agenteSlug" TEXT, "sessionId" TEXT, "metaId" TEXT, "titulo" TEXT NOT NULL, "justificativa" TEXT NOT NULL, "estado" "EstadoDoPlano" NOT NULL DEFAULT 'proposto', "itensDeclarados" INTEGER NOT NULL DEFAULT 0, "contentHash" TEXT NOT NULL, "correlationId" TEXT, "decididoPorId" TEXT, "decididoEm" TIMESTAMP(3), "executadoEm" TIMESTAMP(3), "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlanoDeDelegacao_pkey" PRIMARY KEY ("id"));` — `agenteSlug` é SLUG e não relação, pelo mesmo motivo de `Rotina.agenteSlug`: chave estrangeira transformaria 'o roster ainda não foi semeado nesta empresa' em erro de gravação no meio de um tique. `justificativa` é NOT NULL de propósito: plano sem porquê é lista de tarefas, e é o porquê que vai para a tela e para o prompt.
- TABELA `ItemDoPlano` — `CREATE TABLE "ItemDoPlano" ("id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "planoId" TEXT NOT NULL, "ordem" INTEGER NOT NULL, "tipo" "TipoDeItemDoPlano" NOT NULL, "estado" "EstadoDoItemDoPlano" NOT NULL DEFAULT 'pendente', "capabilityId" TEXT NOT NULL, "args" JSONB NOT NULL, "approvalId" TEXT, "toolCallId" TEXT, "taskId" TEXT, "agentIdCriado" TEXT, "erro" TEXT, "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" TIMESTAMP(3) NOT NULL, CONSTRAINT "ItemDoPlano_pkey" PRIMARY KEY ("id"));` + `CREATE UNIQUE INDEX "ItemDoPlano_planoId_ordem_key" ON "ItemDoPlano"("planoId","ordem");` + `CREATE INDEX "ItemDoPlano_orgId_estado_idx" ON "ItemDoPlano"("orgId","estado");` — o índice único em (planoId, ordem) é o que impede dois cliques em 'executar' de criarem duas linhas para o mesmo item. `capabilityId` é TEXTO e não FK para `Capability` de propósito: `Capability` é tabela GLOBAL sem orgId (declarada em `common/modelos-globais.ts`) e uma FK aqui amarraria linha de empresa a linha global — o padrão do repositório é `PolicyDecision.capabilityId` anulável.
- TABELA `LimiteDeDelegacao` — `CREATE TABLE "LimiteDeDelegacao" ("id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "itensPorPlano" INTEGER NOT NULL DEFAULT 12, "planosPorDia" INTEGER NOT NULL DEFAULT 3, "contratacoesPorMes" INTEGER NOT NULL DEFAULT 1, "ativo" BOOLEAN NOT NULL DEFAULT true, "atualizadoPorId" TEXT, "atualizadoEm" TIMESTAMP(3) NOT NULL, CONSTRAINT "LimiteDeDelegacao_pkey" PRIMARY KEY ("id"));` + `CREATE UNIQUE INDEX "LimiteDeDelegacao_orgId_key" ON "LimiteDeDelegacao"("orgId");` — empresa SEM linha aqui usa os defaults do código, nunca 'sem limite': o precedente contrário (`TetoDeCustoIa`, onde empresa sem teto passa como antes) é defensável porque lá o gasto já é medido em dinheiro; aqui 'sem linha = ilimitado' seria a porta aberta que a fatia existe para fechar.
- COLUNAS NOVAS EM `Agent` — `ALTER TABLE "Agent" ADD COLUMN "podeDelegar" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "geracao" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "contratadoPorPlanoId" TEXT, ADD COLUMN "contratadoPorItemId" TEXT, ADD COLUMN "contratadoEm" TIMESTAMP(3);` — `podeDelegar` default `false` é a trava: todo agente que já existe continua sem poder propor plano, e a capacidade `delegacao.plano.propor` fora das `capacidadesDeclaradas` dele é recusada pela porta na PRIMEIRA das quatro recusas antecipadas (`fora_da_declaracao`). `geracao` é o corte da recursão. `Agent` já tem RLS+FORCE da migration 20260911050000, então ALTER de coluna não pede policy nova.
- COLUNAS NOVAS EM `WorkTask` — `ALTER TABLE "WorkTask" ADD COLUMN "planoId" TEXT, ADD COLUMN "itemDoPlanoId" TEXT;` + `CREATE INDEX "WorkTask_orgId_planoId_idx" ON "WorkTask"("orgId","planoId");` — é a LINHAGEM: tarefa → item → plano → meta (A5). Sem ela a tarefa criada por delegação é indistinguível de uma digitada à mão, e a pergunta 'esta tarefa existe por causa de qual meta?' não tem resposta.
- CHAVES ESTRANGEIRAS — `ALTER TABLE "PlanoDeDelegacao" ADD CONSTRAINT "PlanoDeDelegacao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` (idem `ItemDoPlano` e `LimiteDeDelegacao`) e `ALTER TABLE "ItemDoPlano" ADD CONSTRAINT "ItemDoPlano_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "PlanoDeDelegacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;` — CASCADE do item para o plano (o item não sobrevive sozinho), RESTRICT na empresa, como em todo o schema. NADA de FK de `ItemDoPlano.taskId`/`agentIdCriado`: são ponteiros de resultado, e uma FK ali faria arquivar uma tarefa quebrar o histórico do plano.
- ISOLAMENTO POR LINHA, nas TRÊS tabelas, na MESMA migration que as cria — `SELECT app_rls_aplicar_policies('PlanoDeDelegacao', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');` e idem para `'ItemDoPlano'` e `'LimiteDeDelegacao'`. A função vem da migration do isolamento e faz o pacote inteiro: DROP POLICY IF EXISTS, CREATE POLICY de SELECT, INSERT, UPDATE e DELETE (leitura e escrita SEPARADAS — policy `FOR ALL` sem `WITH CHECK` reusa a cláusula de leitura como verificação de escrita, que foi o furo que reprovou a primeira versão da 1.4), ENABLE e FORCE. NENHUMA SENTINELA, nem pública nem de plataforma: não existe caminho de delegação sem empresa no contexto.
- GRANT DO PAPEL RESTRITO, guardado — `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "PlanoDeDelegacao" TO mktos_app'; EXECUTE '... ON "ItemDoPlano" TO mktos_app'; EXECUTE '... ON "LimiteDeDelegacao" TO mktos_app'; END IF; END $$;` — o `has_role` não é zelo: GRANT para papel inexistente ABORTA a migration, e `migrate deploy` roda no `command` do container, então abortar é a API não subir.
- CONFERÊNCIA FINAL, local — o mesmo bloco `DO $$ ... FOREACH alvo IN ARRAY ARRAY['PlanoDeDelegacao','ItemDoPlano','LimiteDeDelegacao'] LOOP ... IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION '% ficou sem isolamento por linha (rls/force/policies).' ...` de `20260911180000_rotinas_por_empresa`, conferindo `relrowsecurity AND relforcerowsecurity AND count(pg_policy) >= 4`. Falha ALTA de propósito: um rebase mal resolvido que apague as chamadas acima tem de abortar aqui, não entrar em produção legível por outra empresa.
- CAMINHO DE VOLTA, escrito (o Prisma não tem migration de descida) — `DROP TABLE "ItemDoPlano"; DROP TABLE "PlanoDeDelegacao"; DROP TABLE "LimiteDeDelegacao"; ALTER TABLE "Agent" DROP COLUMN "podeDelegar", DROP COLUMN "geracao", DROP COLUMN "contratadoPorPlanoId", DROP COLUMN "contratadoPorItemId", DROP COLUMN "contratadoEm"; ALTER TABLE "WorkTask" DROP COLUMN "planoId", DROP COLUMN "itemDoPlanoId"; DROP TYPE "EstadoDoItemDoPlano"; DROP TYPE "TipoDeItemDoPlano"; DROP TYPE "EstadoDoPlano"; DELETE FROM "_prisma_migrations" WHERE migration_name = '...';` — atenção: desfazer NÃO apaga os agentes já contratados nem as tarefas já abertas, só a linhagem delas. O agente contratado fica como agente normal, sem dizer de onde veio.


## Arquivos

- CRIAR — apps/api/prisma/migrations/20260913HHMMSS_delegacao_e_contratacao/migration.sql (escrita à MÃO, não por `migrate dev`; copiar o cabeçalho e a conferência final de 20260911180000_rotinas_por_empresa)
- EDITAR — apps/api/prisma/schema.prisma (3 modelos novos, 3 enums novos, 5 colunas em Agent, 2 em WorkTask)
- CRIAR — apps/api/src/delegacao/delegacao.module.ts
- CRIAR — apps/api/src/delegacao/delegacao.controller.ts (prefixo @Controller('delegacao'))
- CRIAR — apps/api/src/delegacao/delegacao.service.ts (propor, alterar, ler, e os três contadores do LimiteDeDelegacao)
- CRIAR — apps/api/src/delegacao/executor-do-plano.service.ts (o TRADUTOR: percorre itens e entrega cada um à PortaDoOperador; espelha apps/api/src/gateway/porta-do-operador.service.ts)
- CRIAR — apps/api/src/delegacao/efeitos-da-delegacao.service.ts (inscreve `delegacao.tarefa.abrir`, `delegacao.tarefa.atribuir` e `agente.contratar` no EfeitosRegistry; é o ÚNICO lugar que cria Agent por contratação)
- CRIAR — apps/api/src/delegacao/limites.ts (núcleo puro: conta itens/planos/contratações e devolve `pode`/`motivo`, sem Nest e sem Prisma — testável sob vitest)
- CRIAR — apps/api/src/delegacao/contratacao.ts (núcleo puro: a regra de como um agente contratado NASCE — estado, autonomia, capacidades, geração, dono)
- EDITAR — apps/api/src/tenants/modulos.ts (acrescentar 'delegacao' a PREFIXOS_DA_ESPINHA; sem isso toda rota da família LANÇA em execução)
- EDITAR — apps/api/src/app.module.ts (DelegacaoModule nos imports)
- EDITAR — apps/api/src/gateway/validacao.ts (ensinar `maxItems` ao validador — ver o achado no item de riscos; hoje ele IGNORA maxItems em silêncio)
- EDITAR — packages/policy/politica-marketing-os.json (6 capacidades novas; subir `versao` para 1.3.0)
- EDITAR — apps/api/src/agents/roster/roster.ts (NADA de capacidade nova aqui — só o comentário dizendo que delegação não entra por roster)
- EDITAR — packages/shared/src/nav.ts (item 'Delegação' como filho de 'agentes', seção 'trabalha' — depende da A1, que está no working tree)
- CRIAR — apps/web/src/app/delegacao/page.tsx + apps/web/src/app/delegacao/plano/[id]/page.tsx
- CRIAR — apps/api/test/delegacao.test.ts
- CRIAR — apps/api/test/contratacao-de-agente.test.ts
- CRIAR — apps/web/tests/component/delegacao.test.tsx
- EDITAR — apps/api/test/validacao.test.ts (os casos de maxItems)
- EDITAR — packages/policy/test/politica.test.ts (nada a mudar se as 6 capacidades estiverem coerentes; a suíte já cobra declarado==calculado e reversibilidade)
- EDITAR — docs/DEPLOY.md (§2.0: `db:seed:politica` ANTES da subida, com as assinaturas de rebaixamento; §nova: o roteiro do LimiteDeDelegacao)
- EDITAR — docs/PLANO-CONTROLE-DE-AGENTES.md (marcar A8 e registrar as decisões tomadas, com data)
- NÃO TOCAR — apps/api/test/publicar-peca.test.ts e apps/web/src/app/pauta/aprovacao.ts (ver riscos: a suíte mede uma dívida de propósito e o caso final dela fica vermelho se `agentSlug` aparecer naquela tela)


## Rotas

- `GET /api/delegacao/planos` — R0 (leitura, entra no rastro), permissão `mcp.ver`. Lista por estado, com contagem de itens por tipo. PAGINADA desde o primeiro dia, com cursor, e SEM devolver `args` de item — o defeito da rota de listagem da memória (baixa o corpo de toda nota para desenhar dezenove pontos) está declarado no CLAUDE.md e não se repete aqui.
- `GET /api/delegacao/planos/:id` — R0, `mcp.ver`. O plano com os itens, cada um com `capabilityId`, `nivel` (resolvido do catálogo AGORA, não gravado), `estado`, `approvalId` e se precisa de outra pessoa. É esta rota que alimenta a frase-conta da tela.
- `POST /api/delegacao/planos` — capacidade `delegacao.plano.propor`, **R2**. Dois chamadores: o laço do agente (pela porta, com `ferramenta: delegacao_plano_propor`, só para agente com `podeDelegar` E a capacidade declarada) e uma pessoa na tela (por `PortaDoOperador`, mesmo efeito registrado). Em R2 a aprovação é `configuravel`: com o interruptor ligado, até propor plano vira item de fila.
- `PATCH /api/delegacao/planos/:id` — capacidade `delegacao.plano.alterar`, **R2**, desfazer = ela mesma (autorreferência válida: é `alterar`). Descarta o plano, corta item, edita título/justificativa. Mexer em item de plano já `aprovado` é RECUSADO — mudar `args` depois da assinatura é exatamente o que `vinculoDoConteudo` existe para pegar.
- `POST /api/delegacao/planos/:id/executar` — **NÃO é capacidade**: é TRADUTOR, no padrão de `porta-do-operador.service.ts`. Permissão `automacoes.executar` + `admin.usuarios` (o `CONFIGURAR_AGENTE` de hoje; ver a decisão 7). Percorre os itens em ordem e entrega CADA UM à porta com a sua capacidade. Responde **200** com `{estado:'parcial'|'executado', executados:[{ordem,taskId}], retidos:[{ordem,approvalId,resumo,nivel,precisaDeOutraPessoa:true,fila:'/atendimento'}], recusados:[{ordem,causa,motivo}]}` — nunca 201, e nunca um '✅ feito' por cima de uma retenção (foi o defeito que a tela `/google` pagou na 3.3).
- `GET /api/delegacao/limites` — R0, `mcp.ver`. Os três números da empresa mais o consumo da janela (planos hoje, contratações no mês), para a tela mostrar a conta e não só a regra.
- `PUT /api/delegacao/limites` — `admin.usuarios`. Fora da porta de propósito: é configuração de governança da própria empresa, no mesmo lugar em que `TetoDeCustoIa` é configurado. Grava `atualizadoPorId` e evento no rastro.
- CAPACIDADE `delegacao.tarefa.abrir` — **R2**, `escreveForaDoOS: true`, `reversibilidade: automatica`, desfazer `operacao.trabalho.alterar`. **SEM `ferramenta`**, de propósito: `tool-adapter.ts` filtra por esse campo, e dar nome aqui liberaria a capacidade para o laço do agente por fora do plano. Só o executor do plano a alcança (mesmo padrão de `clickup.tarefa.criar`).
- CAPACIDADE `delegacao.tarefa.atribuir` — **R2**, sem `ferramenta`. Grava `WorkTask.agenteId` (A4) e é ela que a A6 escuta para acordar o agente atribuído. Desfazer `operacao.trabalho.alterar`.
- CAPACIDADE `agente.contratar` — **R3 recomendado** (ver decisão 1), sem `ferramenta`, `rota: POST /agents`. `escreveForaDoOS: true`, `produzArtefato: false`, `reversibilidade: manual`, `exposicaoExterna: false`, `impactoFinanceiro: nenhum`, `sensibilidade: interna`, `destruicao: false`, `obrigacaoLegal: false` → `classificar` devolve R3, que é o que o `nivel` declara (a suíte `politica.test.ts` reprova qualquer divergência). SEM `desfazer`: encerrar um agente contratado é ato de gente em `/agentes`, e prometer volta automática que o catálogo não sabe dar reprova em `verificarReversibilidade`. Executada por `POST /approvals/:id/confirm` → `AcoesService.executarAprovada`, com `actorType: user` e `actorId` = quem assinou.
- CAPACIDADES DE APOIO QUE FALTAM NO CATÁLOGO e a fatia descobre — `operacao.trabalho.criar` (**R2**, `ferramenta: trabalho_tarefa_criar`, `rota: POST /trabalho/tarefas`, desfazer `operacao.trabalho.alterar`) e `operacao.trabalho.alterar` (**R2**, `ferramenta: trabalho_tarefa_alterar`, `rota: PATCH /trabalho/tarefas/:id`, desfazer = ela mesma). Hoje NENHUMA capacidade do catálogo cria tarefa interna: as três de `operacao.trabalho.*` são leitura, e `operacao.tarefa.alterar` é o PATCH do modelo antigo (`/tasks/:id`), não do `WorkTask`. Sem essas duas, `delegacao.tarefa.abrir` não tem desfazer implementado e reprova `verificarReversibilidade`.
- EVENTOS NO RASTRO (nomes, no padrão de `TIPO_DE_EVENTO` da memória) — `delegacao.plano.proposto`, `delegacao.plano.decidido`, `delegacao.plano.executado`, `delegacao.item.retido`, `delegacao.item.executado`, `delegacao.item.recusado`, `agente.contratado`. Todos com `actorId` (a pessoa), `agentSlug` (o proponente) e `payload.planoId` — sem os DOIS nomes a Linha do tempo (A9) não responde 'quem decidiu que esta tarefa existia'.


## Telas

- `/delegacao` — a lista de planos, por estado, submenu de `agentes` (`NavItem.pai: 'agentes'`, seção `trabalha`, permissão `mcp.ver`). Cada linha diz o agente que propôs, a meta (quando A5 existir), quantos itens de cada tipo e o estado. Empresa sem plano nenhum NÃO mostra tela vazia: mostra o caminho — 'nenhum agente desta empresa tem delegação ligada; ligue em /agentes' — como o mapa da 4.4 faz.
- `/delegacao/plano/[id]` — o plano aberto. No topo, a JUSTIFICATIVA (o porquê, que é o que o agente tem de defender) e a CONTA ANTES DO CLIQUE, em uma frase: 'ao executar: 3 tarefas saem agora · 1 contratação vai para a fila e precisa de outra pessoa com alçada responsável'. Cada item com o nível resolvido AGORA e o rótulo do que vai acontecer com ele. Quando o plano tem contratação e a empresa tem um usuário só com alçada, a frase troca para 'esta contratação fica retida até existir um segundo usuário com alçada — crie em /usuarios' e o botão continua clicável (as tarefas saem), com o item marcado. É a lição de `/google` na 3.3: a tela não diz '✅ feito' em cima de uma retenção.
- Painel de LIMITES dentro de `/delegacao` — os três números da empresa e o consumo da janela, com o texto dizendo QUAL número é o da empresa e qual é o teto absoluto do catálogo. Editável só por `admin.usuarios`.
- `/agentes` — uma coluna e um interruptor novos: `podeDelegar` (com a frase 'agente com delegação propõe plano de trabalho; ele não abre tarefa nem contrata sozinho') e, no detalhe do agente, a PROCEDÊNCIA quando ele foi contratado: 'contratado pelo plano X, proposto por Y, assinado por Z em DD/MM/AAAA'. Agente contratado aparece com `geracao` e com o aviso de que ele nasce sem capacidade nenhuma — senão o operador acha que a contratação não funcionou.
- `/atendimento` — sem tela nova, mas o card da aprovação de contratação precisa mostrar o CONTEÚDO EXATO do agente proposto (nome, missão, pilar, SOP, dono sugerido) e o link para o plano de origem. É o argumento contra declarar a contratação como `restrita`: em `restrita` esse card mostraria só os nomes dos campos.
- `/rastro` e a futura Linha do tempo (A9) — sem tela nova: os sete eventos `delegacao.*`/`agente.contratado` já aparecem, e é deles que a A9 monta a história 'meta → plano → tarefa → sessão'.


## Os testes que travam a fatia

- `apps/api/test/delegacao.test.ts` · 'o plano nasce proposto e não abre tarefa nem agente nenhum' — trava o desenho: propor é artefato, não efeito.
- · 'plano com mais itens que o teto do catálogo é recusado NA PORTA, no passo do argsSchema' — fica vermelho se alguém tirar `maxItems` do JSON OU se a emenda de `validacao.ts` for revertida. É o caso que mede o achado central da fatia.
- · 'plano com mais itens que o teto DA EMPRESA é recusado com causa própria e a mensagem diz que o número é o da empresa' — o segundo dos dois números.
- · 'quarto plano do dia é recusado, e o terceiro do dia passa' — `planosPorDia`, na fronteira.
- · 'executar plano com item de contratação responde 200 com `retidos`, nunca 201, e nunca marca o item como executado' — trava a lição de `/google`.
- · 'item de tarefa executado NÃO executa de novo no segundo clique' — `updateMany` condicional; fica vermelho se alguém trocar por `update` seco.
- · 'mudar os args de um item depois da assinatura REJEITA a aprovação, e não só recusa a execução' — é o comportamento que a 5.5 instalou nas duas superfícies.
- · 'plano de outra empresa não é visível nem executável' — roda na seção de isolamento (`RLS_NO_TESTE=1`, banco `marketing_os_test_rls`, conexão `TENANT_DATABASE_URL` com o papel restrito). Sem a segunda conexão a leitura sai pela conexão DONA, que atravessa policy, e o verde não vale nada.
- · 'agente sem `podeDelegar` que chama `delegacao_plano_propor` é recusado por `fora_da_declaracao`, antes de o modo da porta ser consultado' — a primeira das quatro recusas antecipadas.
- `apps/api/test/contratacao-de-agente.test.ts` · 'quem propôs o plano não assina a contratação dele' — invariante 7, no caminho novo.
- · 'agente contratado nasce planejado, inativo, com autonomia R0, sem capacidade e sem podeDelegar' — a regra que sustenta a contratação ser R3. Vermelho no dia em que alguém quiser 'contratar já pronto', que é quando a decisão 1 volta à mesa.
- · 'agente contratado tem como dono QUEM ASSINOU, resolvido por donosDaCasa' — e o par: 'aprovador que não é gente desta empresa faz a contratação RECUSAR, em vez de criar agente órfão'. É a quinta porta do defeito do dono.
- · 'agente de geração 1 não pode contratar: geracao > 1 é recusado' — o corte da recursão.
- · 'segunda contratação no mesmo mês é recusada, e a mensagem nomeia o limite' — `contratacoesPorMes`.
- · 'a contratação não concede capacidade nenhuma: as capacidades do agente novo são [] mesmo quando o item as pediu' — trava contra contrabando pelo `args`.
- `apps/api/test/validacao.test.ts` · 'maxItems recusa array maior que o teto' e 'maxItems ausente continua permissivo' — a emenda do validador, com o caso que prova que nada que já passava passou a falhar.
- `apps/api/test/modulos-por-tenant.test.ts` — reprova sozinha até `delegacao` entrar em `PREFIXOS_DA_ESPINHA`. Não é caso novo: é a catraca existente cobrando.
- `apps/api/test/tenant-isolation.test.ts` — reprova sozinha até as três tabelas terem RLS + FORCE + 4 policies. Idem.
- `apps/api/test/arquitetura.test.ts` — a catraca 'efeito só dispara pela porta' cobra que `efeitos-da-delegacao.service.ts` INSCREVA no `EfeitosRegistry` e que ninguém fora do gateway dispare. Sem caso novo.
- `packages/policy/test/politica.test.ts` — as 8 capacidades novas passam por 'todo nível declarado é o que a régua calcula do efeito' e por 'nenhuma capacidade promete uma volta que o catálogo não sabe dar' sem caso novo. Se `agente.contratar` for declarada R4 ou R5, é AQUI que a mentira aparece.
- `apps/web/tests/component/delegacao.test.tsx` · 'a tela diz, antes do clique, quantos itens saem agora e quantos vão para a fila' · 'empresa de operador único vê a frase da segunda pessoa e o botão continua clicável' · 'plano parcial não é rotulado executado'.
- `apps/api/test/publicar-peca.test.ts` — **continua exatamente como está, e vermelha do jeito que está.** Se ela mudar de cor por causa desta fatia, alguém escorregou na tela da pauta ou em `propostoPorId: input.actorId`.


## DECISÕES PENDENTES — do Pedro, não de agente


### 1. Contratar um agente é R3, R4 ou R5?

- R3 — `escreveForaDoOS: true` + `reversibilidade: manual` + `sensibilidade: interna`. Retido sempre, segunda pessoa com alçada `responsavel`, sem reautenticação, e os args APARECEM na fila (o aprovador lê nome, missão e SOP do agente proposto).
- R4 por sensibilidade `restrita` — alçada `titular`, motivo escrito e reautenticação com senha. MAS `ToolGateway.redigir` (tool-gateway.service.ts:1367) troca `ToolCall.args` por `{redigido:true, chaves:[...]}` para tudo que é `restrita`: a fila mostraria só os NOMES dos campos, e a pessoa assinaria sem ver quem está contratando. `vinculoDoConteudo` devolve 'redigido' e o vínculo deixa de ser conferível. Consertar isso é mexer em `redigir`, que vale para todo o catálogo.
- R4 por `impactoFinanceiro: 'obrigacao'` — sem redação, alçada `titular`, reautenticação. Só é declaração honesta se a A3 já existir: 'contratar compromete orçamento mensal' precisa que exista orçamento mensal por agente.
- R5 — o OS NUNCA executa (`permitido: nivel !== 'R5'`); o plano vira recomendação e uma pessoa cria o agente à mão em /agentes. NÃO é declarável hoje sem mentir: R5 sai de `destruicao`, `obrigacaoLegal` ou `impactoFinanceiro: 'movimento'`, e nenhum dos três é verdade. Exigiria um gatilho novo na escada ('cria ator com capacidade'), o que é mudança no documento normativo, não no JSON.

**Recomendação:** R3, junto com a regra de que a contratação cria um agente VAZIO (estado 'planejado', ativo=false, autonomiaAte=R0, capacidades=[], podeDelegar=false). O ato de contratar não move poder nenhum; quem move é o PATCH /agents/:slug seguinte, que já tem guarda própria e registro próprio. Se você quiser que contratar também conceda capacidade num passo, então é R4 — e aí o problema da redação tem de ser resolvido ANTES, porque aprovar contratação sem ver as capacidades é pior do que não ter a fatia.

**Por quê:** A régua não aceita nível declarado por vontade: `packages/policy/test/verificacao.ts` reprova quando `nivel` difere do que `classificar(efeito)` calcula. O nível é consequência do efeito declarado, então escolher o degrau é escolher o que se afirma sobre o efeito — e duas das quatro rotas para R4/R5 exigem afirmar coisa que não é verdade ou aceitar que o aprovador assine no escuro.


### 2. A proposta do agente conta como 'primeira pessoa' para a invariante 7 (quem propõe não assina)? E, se contar, uma empresa de operador único consegue usar isso?

- (a) NÃO carimbar o agente: o proponente é quem clicou em 'executar plano'. Uma empresa de operador único NÃO consegue contratar agente até existir um segundo usuário com alçada — do mesmo jeito que hoje ela não consegue mandar e-mail pela tela do Google. Coerente com `porta-do-operador.service.ts` e com a dívida de `publicar-peca.test.ts` continuar aberta.
- (b) Carimbar o agente (`propostoPorId = agentSlug`, `propostoPorTipo: ai`): o operador único assina. Isso NÃO é máquina nova — é o que JÁ acontece quando a sessão nasce de rotina, porque `agent-runtime.service.ts:309` faz `actorId: p.solicitanteId ?? agent.slug`. A consequência é auto-aprovação lavada pelo agente: a mesma pessoa pede ao agente que proponha e depois assina.
- (c) Carimbar o agente MAS subir a exigência da contratação: alçada `titular` e reautenticação obrigatória (ou seja, R4). O operador único consegue, desde que seja o titular e digite a senha de novo. A assinatura volta a pesar, ao preço de escolher R4 com todos os efeitos colaterais da pergunta anterior.

**Recomendação:** (a) para `agente.contratar`: a contratação é o único lugar do produto em que o sistema ganha um ator novo, e é onde a segunda pessoa vale mais. Diga na tela, antes do clique, que numa empresa de operador único a contratação fica retida — é decisão de operação (criar o segundo usuário), não defeito. E, separadamente, DECIDA a assimetria do `??`: minha recomendação é deixar o caminho da rotina como está (é o precedente de `AcoesService.executarAprovada`, 'a proposta é da IA; a execução é de gente') e NÃO estendê-lo para o caminho humano — mas isso tem de ser uma linha escrita, não um acidente.

**Por quê:** Existe hoje uma ASSIMETRIA NÃO DECIDIDA, e ela é de um `??`: quando um humano invoca o agente, o proponente é o humano e ele fica travado; quando a rotina invoca, o proponente é o slug do agente e qualquer humano assina. Ninguém escolheu isso. Qualquer resposta a esta pergunta deveria fechar a assimetria de propósito, em vez de deixá-la de pé.


### 3. Um agente que atribui tarefa a outro agente está executando ação sensível em nome de quem?

- (a) Em nome de GENTE. O plano só executa quando uma pessoa clica; `ContextoDoEfeito.actorType = user`, `actorId` = quem clicou, `agentSlug` = quem propôs, `payload.planoId` = o documento. Precedente literal: `acoes.service.ts:405` ('O ator do efeito é QUEM APROVOU. A proposta é da IA; a execução é de gente').
- (b) Em nome do próprio agente (`actorType: ai`), dentro do `autonomiaAte` dele. Aí valem as máquinas certas — teto de custo de IA da empresa e teto de momento por rebaixamento só se aplicam a `actorType === ai` —, mas nenhuma pessoa está no laço dos itens R2.
- (c) Em nome do agente para propor e em nome de gente para executar, com o RASTRO carregando os dois (é o que (a) já faz no registro; a diferença é só quem aparece como `actorType`).

**Recomendação:** (a), com os dois nomes gravados. Atribuir trabalho a alguém é ato de chefia, e chefia no ROOT OS é de gente — o agente propõe a quem, a pessoa assina que sim. Registre `actorId` (pessoa), `agentSlug` (proponente) e `planoId` em todo item executado, senão a fatia A9 nasce cega.

**Por quê:** Sem os DOIS nomes na linha do rastro, a Linha do tempo (A9) não consegue responder 'quem decidiu que esta tarefa existia'. E a escolha do `actorType` não é cosmética: ela liga ou desliga o teto de custo de IA e o teto de momento do agente, que só olham para ação de IA.


### 4. O plano é sempre executado por gente, ou o agente pode executar item R2 sozinho dentro da autonomia dele?

- (a) Sempre gente. A delegação vira máquina de sugestão: zero superfície nova, e metade da promessa do Paperclip.
- (b) O agente executa item R2 sozinho quando `podeDelegar = true` e `autonomiaAte >= R2`; item R3+ vai para a fila. É o que o Paperclip promete.
- (c) (b) com um segundo interruptor por empresa (`LimiteDeDelegacao.autoExecutarR2`), separado do interruptor global de aprovação de R2.

**Recomendação:** (b), com `Agent.podeDelegar` nascendo `false` e a chave do cliente sendo o interruptor de aprovação de R2 que JÁ existe (`aprovacaoR2Ligada`): quem quiser ver cada tarefa antes de ela nascer liga R2 e obtém (a) sem uma linha de código nova. Não crie o terceiro interruptor da opção (c) — ele seria um segundo lugar dizendo a mesma coisa, e um dia diverge.

**Por quê:** É o miolo da fatia: sem autonomia nenhuma, o agente-CEO é um redator de listas. Com autonomia, ele abre tarefa que acorda outro agente que gasta token — e a A6 (heartbeat por atribuição) transforma cada tarefa aberta numa sessão paga.


### 5. O que impede o agente-regente de queimar o teto da empresa quebrando a meta em cem tarefas — e onde esse freio mora?

- (a) `LimiteDeDelegacao` por empresa (`itensPorPlano`, `planosPorDia`, `contratacoesPorMes`), com o teto de itens batendo DENTRO da porta via `argsSchema.maxItems` (passo 3, a terceira das quatro recusas antecipadas) e os dois contadores de janela conferidos pelo serviço.
- (b) Nada dedicado: o plano é uma aprovação só, uma pessoa lê, e se tiver cem itens ela recusa. Barato, e transfere o freio para a atenção humana.
- (c) Contar cada tarefa aberta por plano contra o teto diário de IA da empresa, com um preço nocional por item.
- (d) (a) sem `maxItems` na porta: o teto fica só no serviço.

**Recomendação:** (a) — com defaults `itensPorPlano=12`, `planosPorDia=3`, `contratacoesPorMes=1`, e os três números visíveis na tela. Recuse explicitamente a (d): freio fora da porta não vira `PolicyDecision` nem linha de RASTRO, que foi exatamente o defeito que a 5.6 pagou movendo o rebaixamento para dentro da porta. E aceite o preço: `argsSchema` é GLOBAL (o catálogo não tem schema por empresa), então o número do catálogo é o TETO ABSOLUTO e o da tabela é o da empresa — são dois números, e a mensagem de recusa tem de dizer qual dos dois mordeu, senão o operador mexe no errado.

**Por quê:** Os freios que já existem NÃO cobrem isto, e vale medir: `MAX_PASSOS_ABSOLUTO = 16` conta CHAMADAS de ferramenta, e um plano é uma chamada com N itens dentro; `volume_atipico` só acende com 3x a média histórica e ainda assim sobe um degrau só, parando em R4; e o `TetoDeCustoIa` conta TOKEN — abrir tarefa custa quase nada, e o custo real chega depois, quando a A6 acorda um agente por tarefa. A delegação é multiplicadora de custo, e hoje nada mede a multiplicação.


### 6. A8 pode começar antes de A4, A5 e A6?

- (a) Não: A4 (WorkTask com agenteId e checkout atômico), A5 (MetaDaEmpresa e linhagem) e A6 (heartbeat por atribuição) primeiro.
- (b) Sim, com `metaId` anulável e sem heartbeat: o plano abre tarefa, e a tarefa fica parada esperando alguém abrir a tela.
- (c) Trazer um `MetaDaEmpresa` mínimo dentro da A8.

**Recomendação:** (a), e trate a convergência com o Rodrigo como pré-requisito declarado da A8, não só da A5. Recuse a (c): um `MetaDaEmpresa` inventado aqui é a forma mais rápida de as duas bases divergirem sem volta, e meta é justamente a tabela que você não quer duplicada.

**Por quê:** Sem A4 a tarefa criada não tem agente responsável — dois agentes fazem o mesmo trabalho e ninguém percebe, que é o defeito que a A4 existe para fechar. Sem A6 a tarefa atribuída não acorda ninguém. E o próprio plano do controle de agentes manda 'convergir com a segunda base do ROOT OS (o repo do Rodrigo) ANTES de abrir A5 — meta e tarefa são exatamente onde duas bases divergem sem volta': esse bloqueio é herdado pela A8 inteira.


### 7. Permissão nova (`delegacao.ver` / `delegacao.executar`) ou reuso das que existem?

- (a) Reusar: `mcp.ver` para ler (é o que Agentes, Sessões e Régua usam) e `automacoes.executar` + `admin.usuarios` para executar plano (é o `CONFIGURAR_AGENTE` de `agents.controller.ts`).
- (b) Criar `delegacao.ver` e `delegacao.executar`, e pagar o ritual de três passos: `pnpm --filter @mktos/shared build` → `db:sync-permissions` (não é aditivo: realinha com `set:` e revoga vínculo feito à mão) → todo mundo sai e entra, porque a permissão viaja no JWT.

**Recomendação:** (a) nesta fatia, com o motivo escrito no controlador como `EXECUTAR_AGENTE` já faz — e a chave própria como fatia seguinte, junto com a decisão de quais papéis a recebem. Criar permissão é fácil; decidir quem a tem é o trabalho, e essa decisão é sua.

**Por quê:** `admin.usuarios` hoje só existe no `admin_master` — nem o Diretor tem. Reusar significa que só o Admin Master executa plano, e foi exatamente esse acúmulo que produziu o desencontro da fila de aprovação (menu pedindo uma permissão, API pedindo outra), consertado na 3.10 com duas chaves novas.


## Riscos

- **`validarArgs` IGNORA `maxItems` EM SILÊNCIO** (`apps/api/src/gateway/validacao.ts`). O validador da porta cobre objeto, `required`, tipo primitivo, `enum` e `minLength` — e nada mais; o cabeçalho dele diz explicitamente que 'schema mais exótico que isso é sinal de capacidade mal desenhada'. Declarar `maxItems: 12` no `argsSchema` do plano não recusaria NADA: um plano de quinhentos itens passaria o passo 3 e chegaria ao efeito. É o risco central da fatia, porque é o freio de volume inteiro. Conserto: ensinar `maxItems` (e `items.type`) ao validador, com casos próprios em `apps/api/test/validacao.test.ts` — mudança num arquivo de que TODA capacidade depende, então tem de vir com teste antes do resto.
- **`sensibilidade: 'restrita'` REDIGE os argumentos, e a fila passaria a pedir assinatura no escuro.** `ToolGateway.redigir` (tool-gateway.service.ts:1367) troca `ToolCall.args` por `{redigido:true, chaves:[...]}` sempre que a capacidade é `restrita`, e `vinculoDoConteudo` devolve `'redigido'` em vez de `'intacto'`. Se a contratação for declarada R4 por essa via, `/atendimento` mostraria ao aprovador só os NOMES dos campos — ele assinaria a criação de um ator sem ver nome, missão nem capacidade. É a razão técnica da recomendação de R3, e não uma preferência de estilo.
- **A delegação é multiplicadora de custo e nada mede a multiplicação.** Abrir tarefa custa quase zero em token; o gasto vem depois, quando o heartbeat da A6 acorda um agente por tarefa atribuída. Doze itens num plano, três planos por dia, é trinta e seis sessões novas por dia que o `TetoDeCustoIa` só vê UMA a uma, depois de já terem começado. O teto por empresa e por dia continua sendo o único freio de dinheiro — e ele corta no meio da cascata, não antes dela. Medir o custo esperado de um plano ANTES de executá-lo não está nesta fatia, e devia estar na seguinte.
- **`apps/api/test/publicar-peca.test.ts` fica vermelho se a fatia escorregar.** O último caso dela afirma `!tela.includes('agentSlug')` em `apps/web/src/app/pauta/aprovacao.ts` e a suíte inteira mede a dívida 'propor em nome do agente', que o CLAUDE.md marca como decisão do Pedro. A A8 como especificada NÃO toca aquele arquivo nem `propostoPorId: input.actorId` — mas a tentação de 'já que estou aqui' é real, e ceder a ela resolve a dívida por acidente, sem a decisão. Se a decisão 2 for tomada no sentido de carimbar o agente, então a dívida foi paga e a suíte tem de ser APAGADA com data no relatório, nunca ajustada para continuar verde.
- **Prefixo `delegacao` não declarado LANÇA em execução.** `apps/api/src/tenants/modulos.ts` declara a lista em vez de deduzi-la, e `moduloDoCaminho` lança para prefixo desconhecido — foi assim que as famílias `memoria` e `rotinas` quebraram inteiras. E `modulos-por-tenant.test.ts` varre os `@Controller()` do fonte e reprova até alguém escrever de que lado o prefixo está. Delegação é ESPINHA, pelo mesmo critério de `rotinas` e `organograma`: um cliente que pudesse desligá-la ficaria com agentes contratados e nenhuma tela para vê-los.
- **Agente contratado sem dono humano é agente sem escalação.** O bloco de ESCALAÇÃO do prompt de sistema vem de `montarSop`, e `donoId` que não resolve em gente DESTA empresa faz o agente aparecer 'sem dono' — que é a única resposta segura, e é uma resposta ruim para um agente que acabou de ser criado. O efeito da contratação tem de gravar como dono QUEM ASSINOU (`Approval.aprovadoPorId`), resolvido por `donosDaCasa`; se a resolução falhar, a contratação RECUSA em vez de criar órfão.
- **Contratação é a quinta superfície do dono do agente.** `donos-da-casa.ts` foi escrito porque o defeito 'volta pela quinta porta' — e esta é literalmente a quinta. Qualquer `include: { dono: ... }` no caminho novo traz gente de outra empresa, e daqui o nome vai para o prompt.
- **Dois cliques em 'executar plano' não podem executar duas vezes.** O índice único em (planoId, ordem) e a transição de estado do item (`pendente` → `retido`/`executado`) precisam ser um `updateMany` condicional, como `ApprovalsService.consumeForWrite` faz — no Map em memória o uso único era seguro por acidente; em tabela, duas requisições simultâneas consomem o mesmo item.
- **O teto da empresa e o teto do catálogo são dois números, e a mensagem tem de dizer qual mordeu.** `argsSchema` é global (o catálogo não tem schema por empresa), então o `maxItems` do JSON é o teto ABSOLUTO e `LimiteDeDelegacao.itensPorPlano` é o da empresa. Recusa que não nomeia a fonte faz o operador mexer no arquivo errado.
- **Nada sob `tsx` ou `vitest` com injeção do Nest.** O executor do plano usa Nest; por isso os dois núcleos de regra (`limites.ts`, `contratacao.ts`) são funções puras — é o que permite a suíte medir 'agente contratado nasce vazio' sem subir aplicação. Script de terminal, se houver, mora em `apps/api/src/scripts/` e roda COMPILADO.


## Depende de

- A4 — Tarefa com dono único (`WorkTask.agenteId` + checkout atômico com 409). Sem ela o plano abre tarefa sem responsável, e dois agentes fazem o mesmo trabalho.
- A5 — Meta da empresa e linhagem. `PlanoDeDelegacao.metaId` não tem para onde apontar, e o 'porquê' não chega ao prompt de sistema.
- A6 — Heartbeat por evento (gatilho de ATRIBUIÇÃO). Sem ele a tarefa atribuída a um agente fica parada até alguém abrir a tela e invocar na mão.
- A2 — Estado do agente e botão (pausar/retomar/encerrar). Contratar sem poder pausar cria ator que ninguém desliga.
- A1 — Submenu (está no working tree, não commitado). O item 'Delegação' entra como filho de 'agentes' via `NavItem.pai`.
- CONVERGÊNCIA COM A SEGUNDA BASE DO ROOT OS (o repo do Rodrigo) — declarada no próprio plano como pré-requisito da A5. Meta, tarefa e agora plano de delegação são as três tabelas onde duas bases divergem sem volta.
- `db:seed:politica` rodado ANTES da subida do código novo, com as assinaturas `POLITICA_REBAIXAMENTO_AUTOR`/`POLITICA_REBAIXAMENTO_MOTIVO` se algum nível afrouxar (não deve afrouxar nenhum nesta fatia). O esquema do banco tem `additionalProperties: false`: capacidade que o esquema antigo não conhece é RECUSADA pela porta.


## Esforço

Alto — 4 a 6 dias de trabalho, e nenhuma linha antes de A4, A5 e A6 (mais a convergência com a base do Rodrigo). A conta: 1 migration escrita à mão com 3 tabelas + 3 enums + 5 colunas em Agent + 2 em WorkTask + RLS em todas as três + conferência final; 6 capacidades novas no catálogo (mais `operacao.trabalho.criar`/`alterar`, que a fatia descobre faltando); 4 serviços + 1 controlador + 2 núcleos puros; 2 telas; a emenda em `validacao.ts`; ~18 casos de teste. O que pesa não é o volume — é que a fatia toca a porta, a fila de aprovação e o catálogo ao mesmo tempo, e cada um dos três tem catraca que derruba o arranque quando alguém esquece um passo.
