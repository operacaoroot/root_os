# Revisão do recorte Comercial e Financeiro por carteira

Data: 04/11/2026. Complementa `REVISAO-LOTES.md`. Revisão local sobre a integração `bd35af7` e alterações concorrentes do lote; não é evidência de publicação ou aceite em produção.

## Contrato de leitura

| API | Autoridade e resposta |
| --- | --- |
| `GET /comercial/carteira/leads` e `/:id` | `leads.ver`, carteira atual e `ComercialFicha.partnerId`; ficha e Lead da mesma organização. Lista com nome, empresa, etapa, produto, valor e data; detalhe acrescenta contato. |
| `GET /comercial/carteira/contratos` e `/:id` | Mesmo cliente da ficha, do contrato e de toda a cadeia de pais. Documento e minuta, quando ligados, devem ter o mesmo lead e organização. DTO explícito sem documentos, assinaturas, URLs, tokens ou eventos históricos. |
| `GET /finance/carteira/recebiveis` e `/:id` | `financeiro.ver`; lançamento de entrada, Partner autorizado e Contract de entrada da mesma organização e cliente. Se ligado a contrato comercial, a cadeia comercial também precisa ser válida. |
| `GET /finance/carteira/acordos` e `/:id` | Partner autorizado, organização atual e contrato comercial coerente quando presente. Detalhe traz apenas parcelas cujo recebimento, quando presente, pertence ao mesmo cliente e é entrada com contrato válido; vínculo comercial precisa coincidir quando o acordo o possui. |

As rotas antigas continuam sujeitas ao bloqueio para SELECTED. Este corte não libera alterações comerciais, assinatura, envio, publicação de sala, fechamento, escrituração, conciliação, contas bancárias, saldos, DRE, exportações ou IA.

`clienteId` é filtro opcional sobre a carteira calculada no servidor. Paginação e busca não ampliam acesso. IDs fora do conjunto autorizado recebem 404; uma revogação de papel ou carteira recebe 403. Reclassificação ou alteração detectada entre leituras interrompe a resposta. `NULL`, referências inexistentes e relações divergentes não entram neste recorte. O cliente interno continua sendo um Partner real, sujeito à carteira explícita.

Não é necessário criar outro `clienteId` para estas leituras: a autoridade vem dos vínculos canônicos existentes. Não preencher legado por nome nem inferir propriedade a partir de descrição financeira.

## Totais, concorrência e limites

Listagem, detalhes, totais e relações são lidos em RepeatableRead. Uma segunda transação repete a consulta e compara o DTO. Papel e carteira são revalidados fora dos snapshots. Isso cobre reclassificação entre as duas leituras e a revogação que antes passava despercebida dentro de um único snapshot. Como em outras consultas HTTP, não congela o banco após o último ponto de validação.

Contagens e somas usam o conjunto completo que passou pela autorização, coerência e busca, antes de paginar. Recebíveis retornam decimais como strings, somados com Decimal, separados em previsto, realizado e conciliado. `periodo: null` significa todos os períodos. Os números representam valores brutos dos títulos elegíveis; não representam saldo de conta ou dinheiro disponível. A UI revisada explicita essa definição e a busca aplicada.

Limitação de custo: contratos e recebíveis carregam o conjunto da carteira para validar relações antes de paginar, inclusive no detalhe, e repetem esse trabalho na segunda leitura. A correção de escopo foi preservada, mas não há ensaio de carga neste parecer. Para carteiras grandes, medir linhas, latência e memória e então mover filtro de coerência/agregação para SQL sem mudar o denominador nem paginar antes da autorização. No detalhe, uma consulta dirigida ao ID e à sua cadeia pode reduzir custo.

## Correção da paridade Prisma e migrations

O RED foi reproduzido num PostgreSQL 16 com pgvector local descartável, após replay integral das migrations. O diff propunha 48 remoções de FK, 35 renomeações de FK, três remoções de índice, sete alterações de tabela e duas adições de FK. Esse SQL não foi executado.

A correção altera somente `apps/api/prisma/schema.prisma` para representar o SQL existente:

- Relações e lados inversos de Editorial, Marketing, CommercialExercise e FinanceExercise, incluindo tenant e versão/hash nas FKs compostas.
- `map` com os nomes reais das FKs de Context, DemoInstallation, KnowledgeNote e WorkContextSource.
- `onUpdate: NoAction` nas relações Org de seleção/membro, conforme as migrations.
- Defaults UTC de Context e default de `ClienteAcessoPerfil.updatedAt`, preservando `@updatedAt`.
- Índices existentes de `Partner.principalId`, `AcordoComercial.partnerId` e `AgendaConferencia.[orgId,estado]`.

Os lados inversos novos usam coleções quando a inferência de relação 1:1 do introspector exigiria um índice único adicional com outra ordem de colunas. As constraints únicas já presentes no banco continuam sendo a autoridade; nenhum índice duplicado foi criado para satisfazer essa inferência.

Nenhuma migration, FK, CHECK, política RLS, trigger de imutabilidade ou trigger de consistência foi removido. Não houve backfill nem alteração de dados reais.

Validação local concluída:

- `prisma validate`: passou.
- Replay em banco descartável e `migrate diff --from-url ... --to-schema-datamodel ... --exit-code`: código 0, migration vazia.
- Gate exato do CI, `pnpm --filter @mktos/api db:diff`, com shadow separado e novo replay: código 0, `No difference detected.`
- `prisma generate`: passou.
- Suítes focais Comercial e Financeiro, `--maxWorkers=1`: 10/10 passaram.

Logs locais desta execução: `/tmp/root-clientes-comercial-financeiro/fresh-red.sql`, `fresh-green.log`, `generate.log` e `carteira-tests.log`. O build iniciado nesta revisão foi interrompido para evitar sobreposição com a checagem central de tipos; seu resultado deve ser registrado pelo coordenador.

## Critério de avanço

Sem achado bloqueante de autorização na leitura dos serviços, helpers e UI acima. Antes de publicar, exigir a prova HTTP/Nest/PostgreSQL do responsável pelo backend: A autorizado; B, NULL, outra organização e cadeia divergente excluídos; totais de A invariantes a dados de B; revogação com o mesmo JWT; reclassificação concorrente; métodos antigos não adaptados com 403. A paridade verde não substitui os testes de tenant, a checagem de tipos ou esses aceites. Mutação e jobs continuam dependências de lotes separados.

## Guarda do banco da suíte de atividade

O bloqueio fixo de `work-atividade-versionada.test.ts` aceitava apenas o clone na porta 55582, enquanto o job `qualidade` usa `localhost:5432/marketing_os_test`. A validação foi extraída para uma função pura, mantendo o clone local e acrescentando somente esse destino do runner hospedado, com `GITHUB_ACTIONS=true` e `RUNNER_ENVIRONMENT=github-hosted`.

`CI=true` isolado não autoriza o acesso. Host remoto, outro banco, outra porta, runner próprio, protocolo fora de PostgreSQL e parâmetros de redirecionamento são recusados. O único parâmetro aceito é `schema=public`. A guarda roda antes da construção dos clientes Prisma e não exibe a URL em mensagens de erro.

O teste puro registrou RED de 9 falhas em 27 casos com a lógica antiga e GREEN de 27/27 com a correção. Logs: `/tmp/root-clientes-comercial-financeiro/activity-guard-red.log` e `activity-guard-green.log`. Esta verificação não abriu conexão de banco; a execução integral da suíte no CI permanece com o coordenador.

Revisão do runner `scripts/typecheck-tests.mjs`: cobre todos os roots resolvidos pelo tsconfig, inclui declarações em cada programa, confere src/prisma e depois lotes sequenciais de testes, preserva imports reais e interrompe em status ou sinal de falha. Não encontrei teste sem escopo de módulo nem declaração `declare global/module` nos arquivos `.ts` de teste desta fotografia que dependesse de outro lote. O limite de memória dos filhos depende do `NODE_OPTIONS` fornecido pelo chamador. A revisão de código não substitui o resultado da execução completa de tipos.

## Correções de tipos reveladas pelo runner

O lote seguinte corrigiu apenas testes: as respostas JSON de `cliente-escopo-http` passaram a ser verificadas com `toMatchObject`, sem acessar propriedades de `unknown`; o parâmetro de conteúdo do Drive em memória declara `Buffer`, em vez de herdar a especialização de `Buffer.from`; o controller da inteligência comercial recebe as dez dependências atuais. As seis dependências fora desse teste são dublês tipados pela assinatura do construtor e lançam erro se forem usadas.

A execução local dos testes HTTP e de dublês teve 15 casos aprovados e 19 casos de banco pulados por ausência de `TEST_DATABASE_URL`. A inteligência comercial contra Postgres e a compilação completa permanecem na validação central do coordenador. Nenhuma alteração de produção, `any` ou supressão de erro de tipos foi introduzida nestas correções.

### Procedimento local e prova nativa

Os testes de procedimento passaram a usar `AgendaLocalService` real, contexto humano com empresa/pessoa, versão esperada do SOP e o schema público de execução. A recuperação confere o envelope `confirmado` e lê `execucao`; ausência recebe `ausencia_conferida`. Os dublês implementam `prontidao`, `estado` e `resumir`, com tipos dos métodos reais. Consulta de fontes não verifica a saúde do modelo: os testes de revogação dessa consulta agora alteram a permissão após a leitura de fontes, mantendo a exigência de negar o resultado antes do retorno.

Somente a prova que precisa de llama.cpp foi movida para `procedimento-local-nativo.test.ts`, no conjunto explícito `nativo`, autorizado pelo coordenador. Os demais testes de procedimento usam `TEST_DATABASE_URL` no conjunto padrão. O piso de casos e a proibição de skips do job padrão continuam inalterados; o teste de seleção confere que M05 e o procedimento comum não foram excluídos.

`pnpm --filter @mktos/api test:nativo` exige `ROOTOS_QA_PREVIEW=1`, `TEST_DATABASE_URL` do clone loopback `rootos_prova_trabalho` e `ROOTOS_LOCAL_MODEL_URL` explícita. O modelo real deve declarar o ID esperado pela prova. Não há stub nem skip nesse comando. A seleção de conjuntos passou de RED (2 falhas) para GREEN (2/2); o comando nativo sem ambiente foi recusado, como esperado. A inferência real não foi executada nem considerada aprovada neste lote.

O primeiro ciclo focal de procedimentos mostrou os contratos antigos em runtime. Um ciclo posterior no Mac foi interrompido após pressão de memória e timeouts em cascata; esse ciclo não é evidência de aprovação ou de regressão do código.

Na validação final, o container isolado `root_clientes4_types` e o banco novo `rootos_focal_test` receberam migrations e seed de política. M05 passou 33/33, procedimento comum 28/28 e seleção de conjuntos 2/2. Após corrigir as fixtures de Obsidian, sua repetição passou 7/7. São 70 casos aprovados, sem skips, nesses quatro arquivos. Os logs remotos estão no release de teste `clientes-comercial-financeiro-20261104`: `review-focais.log` e `review-obsidian-final.log`. A compilação final de tipos continua sob responsabilidade do coordenador.

Obsidian agora usa pessoas reais da fixture com IDs UUID e permissões persistidas, além do espelho canônico de onboarding. A limpeza arquiva identidades da vault e exclui apenas notas que podem ser removidas; o contador de itens da volta considera as identidades ativas. Nenhum trigger foi desligado para limpar o banco.

## CI: fixtures comerciais e seed idempotente

O focal reproduziu as falhas do CI em banco descartável. As correções de testes preservam as recusas e os efeitos finais:

- Comercial de exercício liga `ROOTOS_QA_PREVIEW` somente na suíte e restaura o ambiente depois. Financeiro cria pessoa, papel e `financeiro.editar` reais; as duas organizações têm identificadores exclusivos por execução. Os casos entre empresas continuam exigindo 404 e ausência de alteração.
- As cinco suítes de fechamento limpam também as parcelas e o acordo gerados pelo contrato atual, sempre pela organização sintética. A prova de contrato vivo confere as três parcelas de R$ 3.999,00, seus vencimentos e estados com data de consulta fixa.
- Painel usa `vendedorId`; um lead com dono, mas sem vendedor, permanece fora do grupo de vendas desse dono. Importação CRM cria um repositório Git temporário e confere tanto caminho interno quanto externo.
- Tarefas acompanha a regra publicada na Etapa 6: a lista comercial sem pasta vem em `listasDoComercial`; suas tarefas válidas entram em Todas. A fixture Rotina continua em `listasSoltas`.
- M05 atômico e fonte canônica reutilizam a guarda de banco já testada. Os clientes Prisma recebem a mesma URL validada; nenhuma URL diferente é inferida de `DATABASE_URL`.

A falha do seed era real: o segundo relógio mudava a validade e o hash da proposta, criando mais dois eventos de decisão apesar de a proposta v1 permanecer original. Após autorização específica, `prisma/seed-comercial/semear.ts` passou a reconstruir a data-base pela entrada persistida do primeiro lead sintético. O teste mantém a igualdade das contagens e agora compara integralmente eventos e decisões após repetição e após sete dias. O código não apaga histórico nem corrige retroativamente duplicações antigas.

Evidência remota no scratch `root_clientes4_types`, banco `rootos_focal_test`, `maxWorkers=1`:

- `review-comercial-finance-red.json` e `review-cleanup-red.log`: falhas originais reproduzidas.
- `review-comercial-finance-green1.log`: 10 arquivos finais aprovados; os dois restantes receberam ajustes das expectativas descritas acima.
- `review-comercial-final.log`: Tarefas e Painel, 26/26.
- `review-seed-red.log`: 2 falhas em 12 casos antes da correção; `review-seed-green.log`: 12/12 depois.

São 207 casos únicos aprovados em 13 arquivos, sem skips, reunindo esses focais. Não foi uma execução integral única. A compilação de tipos e o CI completo continuam com o coordenador. Nenhum seed ou teste deste lote foi executado na produção.

Revisão final antes da rodada integral: os oito endpoints de carteira permanecem GET, com `leads.ver` ou `financeiro.ver`, filtros de empresa/cliente e revalidação após os snapshots. Não houve ampliação de permissão ou introdução de mutação. Permanece a ressalva de custo: contratos e Financeiro materializam a carteira autorizada duas vezes; volume de produção não foi medido neste lote.

No migrador revisado, a trava de `memoria:<org>` precede a conferência de item e reivindicação canônica da chave. A origem, o hash declarado e o hash recalculado do corpo precisam coincidir; divergência aborta a transação. A ordem de organização/caminho é estável. Desfazer sem `--simular` é recusado, sem apagar identidades ou versões. Os testes de Terra incluem colisão de conteúdo, corpo divergente com hash armazenado preservado e duas migrações concorrentes.

A paridade foi repetida em modo de leitura contra `rootos_focal_test`: `prisma migrate diff --from-url ... --to-schema-datamodel ./prisma/schema.prisma --exit-code` retornou 0 e `No difference detected.` Evidência: `review-parity-final.log` no release de teste. `git diff --check` passou para os arquivos desta autoria. O ajuste de tipos em Tarefas adiciona uma guarda explícita para o catálogo comercial opcional, antes de acessar seus itens.
