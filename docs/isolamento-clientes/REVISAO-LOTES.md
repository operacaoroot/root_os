# Revisão dos próximos lotes de isolamento

04/11/2026. Mapeamento de código sobre a base integrada de produção `2c45bf4465618f63bf6ad8b23be09893180edc9e`. Este documento define recortes e critérios de avanço; não registra aceite dos lotes nem prova de publicação.

## Contrato comum

`Partner` é o cliente canônico; `ClienteEscopoService` resolve a carteira atual do ator no servidor. Cliente escolhido na interface apenas restringe essa carteira. Papel continua definindo a ação. Métodos HTTP são liberados individualmente com `EscopoClienteAdaptado`; a marcação não substitui autorização no serviço.

`SELECTED` não vê registros com cliente nulo, clientes inativos ou cadastros secundários. O cliente interno exige vínculo ao seu UUID real. Não converter `NULL` em interno, nem usar título, nome ou CNPJ como autorização. Perfil ausente nega acesso. Revogação deve valer na operação seguinte, inclusive com o mesmo JWT.

O filtro de carteira deve entrar em `AND` com os filtros de busca e alimentar lista, total, agrupamentos, relações e contadores. Validar somente o recurso principal não basta quando um vínculo legado aponta para outro cliente. Escritas precisam validar origem, destino e relações dentro da transação; lotes mistos falham sem escrita parcial.

## Trabalho: recorte operacional

`WorkTask.clienteId` já existe. `WorkSpace`, `WorkFolder` e `WorkList` são agrupamentos organizacionais sem cliente próprio. Comentários, apontamentos, valores e anexos herdam autorização da tarefa. Subtarefas devem herdar o cliente do pai; cliente explícito divergente é recusado mesmo para quem acessa ambos os clientes.

| Caminho | Implementação a revisar | Condição para liberar |
| --- | --- | --- |
| `GET /trabalho/tarefas`, `GET /trabalho/tarefas/:id` | `work.service.ts`, `TASK_INCLUDE`, `mapTask` | Lista e total com carteira; subtasks e `_count` filtrados; parent e lead de fora da carteira não aparecem no DTO |
| `GET /trabalho/estrutura` | `WorkService.estrutura` | Apenas listas necessárias ao recorte e seus ancestrais; totais por lista/status e responsáveis derivados usam tarefas acessíveis |
| `GET /trabalho/clientes` | `clientes-da-casa.ts` | Carteira atual; interno real autorizado; não criar cliente como efeito do seletor |
| CRUD de tarefa, comentários, apontamentos, ordem | `WorkService` | Validar tarefa antes de qualquer leitura/escrita auxiliar; destino e pai coerentes; ordem mista recusada atomicamente |
| `GET/POST/PATCH /trabalho/todas`, `:id/feita`, `ordem` | `tarefas-do-dia.service.ts` | Abertas/concluídas e deduplicação escopadas; não revelar `parent.title` oculto; conferir escritas posteriores ao WorkService; criação exige cliente |
| `GET /trabalho/tarefas/:id/atividade`, quadro/movimento | Auditoria ligada à tarefa | Autorizar tarefa antes de consultar histórico; nenhum evento de tarefa oculta nos resultados |

Troca de cliente não é uma edição cosmética: pode transferir comentários, histórico, anexos, fontes, lead e filhos. Neste recorte, recusar transferências com relações que ainda não tenham regra transacional de migração. Relações legadas divergentes devem ficar ocultas na leitura, sem reclassificar dados silenciosamente.

A primeira tarefa de um cliente pode usar a lista técnica genérica do Dia a dia; não precisa revelar listas exclusivas de outro cliente. A estrutura retornada é um agrupamento compartilhado, não uma carteira adicional. Mutações de árvore, status/campos globais, atas, fontes de contexto, delegação, cobrança e checkout de agentes permanecem contidos até sua adaptação. Lixeira, mescla, duplicação e movimentos têm caminhos próprios em `lixeira/` e `menu-da-tarefa/`; não recebem liberação por terem nomes parecidos com o CRUD adaptado.

## Arquivos e clientes: leitura primeiro

| Caminho | Regra |
| --- | --- |
| `GET /trabalho/tarefas/:id/anexos` | Autorizar tarefa e limitar cópias `ArquivoDoCliente` ao mesmo cliente e referência |
| `GET /trabalho/tarefas/:id/anexos/:anexoId/arquivo` | Autorizar tarefa antes de abrir storage; anexo precisa pertencer à tarefa autorizada |
| `GET /trabalho/arquivos/:taskId/:fileId` | Resolver a tarefa nativa pelo `externalId` dentro da carteira antes de ler manifesto/disco; preservar verificações de hash e caminho |
| `GET /clientes/pastas` | Filtrar Partners pela carteira antes de calcular aprovações e arquivos na fila |

O POST de upload continua bloqueado para `SELECTED` neste recorte. Hoje `AnexosService.enviar` pode chamar `ArquivistaService.arquivar`, que propõe envio ao Drive pela Porta. A liberação depende de persistir e revalidar ator/cliente na proposta, execução e retry. `POST /clientes/:id/pasta` tem a mesma dependência. Uma URL de Drive entregue pela API é um link externo: a carteira do ROOT não revoga a permissão concedida no Drive. Downloads nativos devem continuar autenticados a cada requisição.

## Comercial: autorização pelo vínculo da ficha

`Lead` não tem cliente; `ComercialFicha.partnerId` é o vínculo existente. Ficha ausente ou sem Partner fica restrita a `ALL`. `FichaService.garantir` pode criar ficha em uma leitura, portanto o acesso deve ser conferido antes de chamá-lo. Filtro por carteira e autorização por ID devem partir da mesma regra.

O primeiro recorte útil inclui funil/fila, detalhe/fio, Geral/pendências, quadro/registro de contratos e prévia PDF. Antes da liberação, cobrir também `/leads`, `/comercial/painel`, `/comercial/lista-de-leads`, propostas vinculadas, tarefas do comercial e downloads. Enquanto um caminho alternativo não for adaptado, o interceptor o mantém negado para `SELECTED`.

`ComercialContrato.partnerId` deve coincidir com o cliente da ficha e do pai do contrato. Documentos, minutas, signatários e filhos herdam esse cliente. Consultas de filhos devem aplicar o vínculo, incluindo dados legados divergentes. Acordos e contratos financeiros ligados ao contrato comercial herdam a mesma autorização. Não basta conferir que lead, pai, minuta e documento pertencem à organização.

Criar/vincular novos clientes, mudar vínculo de ficha, iniciar onboarding e fechar contrato podem criar Partner, WorkTask, Contract e AcordoComercial. Essas operações dependem da validação de toda a cadeia e não podem conceder carteira implicitamente. Envios, assinaturas, publicação de sala, decisões e efeitos automáticos dependem também do lote de jobs/Porta. Preservar suas aprovações de negócio.

## Financeiro: contraparte e cliente não são sinônimos

`FinanceTransaction.partnerId` e `Contract.partnerId` representam contraparte, inclusive fornecedor. Não reinterpretar todo fornecedor como cliente proprietário. Para ampliar além de recebíveis comprovadamente ligados ao cliente, introduzir `clienteId` separado da contraparte, nullable e com FK composta, com regra explícita de origem. Não fazer backfill geral com `partnerId`.

| Superfície | Dependência de escopo |
| --- | --- |
| `/finance/transactions`, `payables`, `contracts` | Recurso e relações account/category/chart/contract/partner; impedir vincular contrato de outro cliente mesmo dentro do Org |
| `/finance/analise/acordos`, parcelas | `AcordoComercial.partnerId` autorizado; parcela herda acordo; recebimento e contrato ligado precisam do mesmo cliente |
| `summary`, `cashflow`, `accounts`, `periodo`, `kpis`, `dre` | Todos os componentes do cálculo usam a carteira; openingBalance organizacional não é saldo do cliente |
| `/finance/analise`, `rotina` | Escopar acordos, parcelas, previstos, contratos e extrato; preservar deduplicação contrato comercial/acordo já publicada |
| `analise/leitura` e relatórios de IA | Prompt, fontes, resultado persistido e chave de cache precisam de cliente e autorização atual |
| Conciliação, importação OFX, conexão/sync bancário | Mantidos amplos enquanto operarem a conta bancária inteira e não houver recorte próprio |

Para `SELECTED`, fluxo de lançamentos por cliente pode existir sem chamar o total de saldo bancário. Não incluir `FinanceAccount.openingBalance` em saldo filtrado. A soma não pode mudar quando forem acrescentados lançamentos de B ou sem classificação. A seleção na tela nunca autoriza a aprovação financeira.

## Jobs, efeitos e caminhos entre módulos

Antes de liberar uma entrada que dispara execução posterior:

1. Persistir organização, cliente, ator original, recurso e finalidade na execução. O cliente vem do recurso validado, não apenas do payload.
2. Revalidar perfil, vínculo e recurso na execução e em cada retry. Uma revogação após a proposta deve impedir efeito novo.
3. Impedir que ator ausente/inativo/restrito seja substituído por conta de sistema ampla. Jobs operacionais antigos permanecem explícitos como sistema, sem servir como acesso de um operador restrito.
4. Incluir cliente no isolamento de idempotência, cache e consultas intermediárias; não reutilizar resultado amplo para carteira restrita.

Pontos concretos: `ArquivistaService.proporEnvio/efeitoEnviar`, `PastaDoClienteService`, `FechamentoService`, `SalaVersaoService`, `EmissaoService`, `ContratoVivoService`, `FinanceService.onModuleInit` e sua conciliação periódica; agentes de tarefas, resumo de grupo e cobrança. O MCP usa conta de serviço em `apiGet()` e exige desenho de identidade própria antes de acesso por operador restrito. Bloqueio HTTP não altera os jobs antigos nem torna RLS efetiva no papel superusuário atual.

## Migração e preservação

Não mudar valores existentes por inferência de nomes. Manter `NULL` legado reservado à visão ampla. `ComercialFicha.partnerId`, `ComercialContrato.partnerId` e `ArquivoDoCliente.partnerId` hoje não têm FK; diagnosticar referências inválidas antes de acrescentar FK composta com Org. `WorkTask.clienteId` já tem FK simples e gatilho de organização; avaliar a troca para FK composta restritiva sem apagar vínculos.

Se houver legado inválido, registrar contagem/IDs em evidência privada e decidir correção explícita ou constraint `NOT VALID` que proteja novas escritas. Esse estado não equivale à validação integral do legado. Regras novas de herança devem impedir novas divergências e manter a leitura protegida das antigas. Novos dados internos usam Partner real, sem preencher os nulos antigos. Preservar todas as migrations de Comercial/Financeiro integradas da base produtiva.

## Critério de avanço

Os testes negativos precedem a implementação. Fixture mínima: duas organizações; clientes A, B e interno; registros nulos; perfis ALL, SELECTED A, SELECTED A+B, sem perfil e sem vínculo. Incluir relações legadas incompatíveis, não apenas dados perfeitamente consistentes.

- Lista, busca, detalhe, total, contadores, filhos e downloads não revelam B/NULL a A, mesmo conhecendo IDs.
- Criar filha A com cliente B, ligar pai/lead/contrato B e reordenar lote A+B falham sem efeitos parciais.
- Revogar vínculo torna a operação seguinte negada com o mesmo JWT, incluindo download e retry de efeito quando esse lote for liberado.
- Interno exige vínculo; criar cadastro nunca amplia carteira automaticamente.
- Agregados A não mudam ao adicionar valores extremos B/NULL; valores de abertura de conta não entram no recorte.
- Rotas não adaptadas continuam 403. Métodos marcados têm teste de autorização e relações, além de testes de resultado feliz.
- Teste HTTP cobre wiring/interceptor; Postgres descartável cobre migrations, FKs e atomicidade; build e regressões cobrem a base integrada.

Aceite de um recorte só descreve os métodos efetivamente adaptados e verificados. Publicação requer evidência separada de SHA/imagem, migrations e comportamento HTTP no runtime real. Não anunciar Trabalho, Arquivos ou Financeiro inteiros como concluídos enquanto os caminhos listados como dependentes continuarem contidos.

## Revisão independente da implementação

Revisão parcial em 04/11/2026, sobre os arquivos de trabalho ainda sem commit do recorte. Métodos liberados até esta conferência: clientes, lista e detalhe de tarefas, comentário; listagem e download de anexos; download migrado. Os demais requisitos acima continuam como critérios das próximas liberações.

Dois ajustes foram solicitados e conferidos no código:

- A lista de IDs autorizados calculada antes da consulta final podia ficar desatualizada após uma reclassificação concorrente. Lista e detalhe agora executam carteira, cadeia e projeções no mesmo `RepeatableRead`, passando o cliente transacional ao serviço de escopo e às consultas auxiliares.
- O comentário inicialmente travava todas as tarefas do Org. Agora autoriza antes de travar, bloqueia apenas alvo e ancestrais em ordem estável, compara a cadeia após o lock e revalida escopo antes da gravação. Mudança de cadeia aborta a operação.

O detalhe restrito omite auditoria histórica e lead neste recorte. A interface desmonta o estado ao trocar conta/token ou cliente; o hook cancela consultas e só aceita a resposta correspondente ao path/token atuais. Downloads conferem acesso antes de abrir o arquivo e novamente antes de entregar; revogação ou troca de cliente encerra o stream.

Verificação executada pelo revisor:

```text
pnpm --filter @mktos/api exec vitest run test/work-clientes-isolamento.test.ts test/tarefa-escopo.test.ts test/arquivos-clientes-isolamento.test.ts test/work-anexos.test.ts test/work-files.test.ts --maxWorkers=2
5 arquivos: 19 testes passaram; 5 foram pulados (integração de anexos sem TEST_DATABASE_URL).

pnpm --filter @mktos/web exec vitest run tests/component/trabalho-carteira.test.tsx
1 arquivo: 7 testes passaram.

git diff --check
Sem erros.
```

Sem achado de código pendente nos métodos revisados nessa fotografia. Foram pedidos ao autor testes adicionais de comentário autorizado, mudança da cadeia durante o lock e detalhe com filhos/lead de outro cliente. Este resultado não cobre publicação, upload, efeitos posteriores, Comercial ou Financeiro.

### Aceite HTTP com Postgres local

O revisor acrescentou `apps/api/test/work-clientes-http-postgres.test.ts`, usando Nest, JWT, guards, interceptor, serviços de carteira, `WorkService`, `AuditService` e Postgres reais. Storage é um dublê em memória; efeitos externos não são executados. A suíte exige `TEST_DATABASE_URL` explícita, host local e banco com `test` no nome. Cria duas organizações sintéticas com UUIDs novos e limpa somente seus registros.

Após a ampliação do recorte, foram revisados também POST de tarefa/subtarefa e PATCH de conteúdo/etapa. As relações permitidas na criação são conferidas no servidor; o PATCH restrito recusa transferência de cliente, pai e lista. As demais mutações continuam contidas. O nome de lista organizacional é neutralizado na projeção restrita.

Execução final contra o banco descartável local `cofre_test`:

```text
TEST_DATABASE_URL=<conexao-local-descartavel> pnpm --filter @mktos/api exec vitest run test/work-clientes-http-postgres.test.ts --maxWorkers=1
1 arquivo; 12 testes passaram; nenhum teste pulado; duração total 5,26 s.
```

Os casos cobrem lista/total/paginação, filhos divergentes, lead/histórico ocultos, IDs conhecidos B/NULL/interno/outra Org, ALL com legado, comentário autorizado e negado, anexos A e B antes do storage, download migrado negado antes do leitor, contenção de endpoints, criação e edição com relações negadas, carteira A+B sem misturar hierarquia, perfil ausente e revogação pelo gestor com o mesmo JWT.

A prova de concorrência usa duas transações reais. Uma segura o row lock; o pedido HTTP de comentário chega a esperar esse lock, confirmado em `pg_stat_activity`. A primeira transação reclassifica A para B e libera a linha; o comentário recebe 409 e nenhuma linha de comentário é gravada.

Na primeira execução de nove casos, um GET ALL retornou 500 depois de aproximadamente 14 s, sem diagnóstico capturado pela configuração inicial de logger. A segunda execução passou os nove casos; a execução final passou os doze. A causa da primeira ocorrência não foi confirmada. Este é aceite local do recorte, não prova de publicação ou de RLS pelo papel produtivo.

### Rechecagem após o snapshot

Revisão pontual do patch posterior a `1fce2a2`: a regressão N23 mostrou que revogar o papel durante a leitura não era visível dentro do `RepeatableRead`. Lista e detalhe agora conferem `tarefas.ver` novamente fora da transação e comparam a carteira atual com a do snapshot antes de entregar a resposta. A impressão da carteira diferencia ALL de SELECTED, inclusive carteira vazia. O detalhe também reautoriza tarefa e cadeia e recusa mudança do cliente ou pai. O teste N23 confirma que o hook de revogação foi executado, evitando um verde sem exercitar a corrida.

Sem achado pendente nessa revisão pontual. O revisor repetiu o aceite HTTP/Postgres acima após o patch: **12/12 passaram, nenhum pulado**, duração total 9,07 s (testes 4,72 s). `git diff --check` também passou. Nenhuma publicação foi feita pelo revisor.
