# Conflitos do merge (F1) · Versão final, 19/10/2026

> `homolog/final-20261019` (nossa, 808d743 + roteiro) ← `lucas/tarefas` (abd1476, contém o snapshot
> f5552402 = 7ed42fb do Pedro). Estratégia: `git merge -X ignore-space-at-eol` (o nosso lado tem
> arquivos gravados com CRLF; sem a opção, o arquivo inteiro conflitava por fim de linha).
> 23 arquivos em conflito; o resto entrou limpo. Sem dado de cliente.
> Regra: no foco (Comercial, Dia a dia, Trabalho) a nossa é a referência, com as exceções do roteiro;
> fora do foco vale a produção; nada do que a produção enxugou volta (ver `enxugamento.md`).

| Arquivo | Nossa | Produção | Ficou | Porquê |
|---|---|---|---|---|
| `apps/api/prisma/schema.prisma` · `Org` | relações do cockpit | relações do cofre, acordos, análise, reuniões, operação, demo | as duas | união |
| `schema.prisma` · `WorkTask` | `clienteId` → `Partner` | `clienteId` → `WorkTask` de lista `cadastro` + `areaId`, `recorrencia`, `serieId`, `outrosResponsaveisIds`, `fontesContexto` | o `clienteId` NOSSO; todo o resto da produção | decisão do roteiro (conciliação); um campo, uma verdade |
| `schema.prisma` · índices e `WorkArea` | índice do cliente | índices de área e série + modelo `WorkArea` | os da produção (contêm o nosso) | `WorkArea` fica no esquema (decisão 4) |
| `schema.prisma` · fim do arquivo | modelos do cockpit (Comercial*, SalaVersao, LeadReacao…) | modelos do Pedro e do Lucas (Editorial*, Context*, AgentLocal*, Cofre*, AcordoComercial…) | os dois | união |
| migrations | `20261019100000_tarefa_do_cliente` criava a coluna | `20261019180000_tarefas_area_e_cliente` cria a mesma coluna (aplicada em produção, intocável) | a nossa 100000 ficou só com `Partner.interno` (idempotente); novo preparo `20261019170000`; nova conciliação `20261019230000` | o histórico aplica nos três pontos de partida (provado: produção, homologação antiga, banco novo) |
| `apps/api/src/finance/finance.module.ts` | porta de cobrança do cockpit (`PORTA_DE_COBRANCA`) | Análise, exercício financeiro, ponte comercial | os dois | união |
| `apps/api/src/tenants/modulos.ts` | `comercial` e `sala` → `leads` | `comercial` → `leads` | o nosso (contém o deles) | `sala` é a rota anônima da sala |
| `apps/api/src/work/work.module.ts` | Vistas, Atas, Movimento do quadro | Tarefas do dia (`/trabalho/todas`) | os dois; `VistasController` antes do `WorkController` | ordem de controller evita rota engolida |
| `apps/api/src/work/work.controller.ts` | import de `BadRequestException` | guarda de acesso atual e contexto | os dois | união |
| `apps/api/src/work/work-task-query.ts` | filtro `cliente` | filtros `assigneeUserId`/`semResponsavel` | os dois | união |
| `apps/api/src/work/work.service.ts` | cliente obrigatório, porta da implantação, `dueDate`/`clienteId` na auditoria | versão obrigatória (`expectedUpdatedAt`), edição HTTP com acesso atual, responsável ativo | a estrutura da produção com as nossas regras dentro (cliente, porta, auditoria) | a versão obrigatória do Pedro não afrouxa; as nossas regras seguem valendo |
| `apps/api/src/caixa/caixa-atividade.service.ts` (sem conflito textual; quebrou na compilação) | "minhas" por NOME (`identidadesDe`, `condicoesDeResponsavel`) | a produção tirou as duas funções: identidade por CONTA | por conta (`assigneeUserId` ou `outrosResponsaveisIds`) | regra do Pedro (14/10): o texto antigo do responsável não define identidade |
| `apps/api/src/work/tarefas-do-dia.service.ts` (sem conflito textual) | — | cliente = card de cadastro | cliente = `Partner` | consequência da conciliação |
| `packages/shared/src/index.ts` | exports do cockpit | exports do Pedro e do Lucas | os dois | união |
| `packages/shared/src/ficha-do-cliente.ts` (sem conflito textual) | `ehSaida(etapa)` em `comercial.ts` | `ehSaida(nome)` | o do Lucas virou `ehEtapaDeSaida` (2 usos na API) | dois exports com o mesmo nome no pacote |
| `packages/shared/src/nav.ts` | ver `enxugamento.md` | ver `enxugamento.md` | ver `enxugamento.md` §2 | menu na ordem do roteiro; fora do foco, a forma da produção |
| `apps/web/src/app/comercial/page.tsx` (add/add) | redireciona ao Funil vivo | Painel geral do Lucas | o do Lucas | decisão do Rodrigo (primeira tela do Comercial) |
| `apps/web/src/app/comercial/lead/[id]/page.tsx` (add/add) | painel do lead do cockpit | ficha do Lucas (por id de card) | o nosso; a ficha do Lucas mudou para `/comercial/ficha/[id]` e o link "abrir em página inteira" acompanha | foco; nenhuma das duas telas some |
| `apps/web/src/app/onboarding/page.tsx` | redireciona à Implantação | "Operação" (Implantação + Rodada da semana do Pedro) | o nosso; a Rodada da semana ganha aba na nossa Implantação, só para a ROOT; `/operacao` segue viva | foco Trabalho; a Rodada não pode sumir |
| `apps/web/src/app/caixa/page.tsx` | Pendências em abas (Atividade, Minhas tarefas, Decisões) | página única da A7 com identidade por conta | o nosso, com a regra da conta escrita no cabeçalho | roteiro F3 mantém Pendências; regra do Pedro mantida |
| `apps/web/src/app/globals.css` | barra de rolagem do quadro | tema do Comercial (`.com-tema`) | os dois | união |
| `apps/web/src/components/trabalho/TrabalhoView.tsx` | ver linha a linha no RESULTADO-FINAL | ver linha a linha no RESULTADO-FINAL | a nossa tela com a versão obrigatória, o responsável por conta e os quatro blocos do Pedro no pop-up | foco; nada do Pedro quebra |
| testes · `tenant-isolation.test.ts` | inventário do cockpit | `OperacaoRodada` | os dois | união |
| testes · `work-campo-moeda.test.ts` | `dueDate` na auditoria | `assigneeUserId` + auditoria na transação | os dois | união |
| testes · `caixa.test.tsx` | a caixa em abas | a caixa A7 | o nosso | segue a tela que ficou |
| testes · `menu.test.tsx` | a barra antiga | a barra por áreas da produção | o da produção, ajustado ao menu final | o shell da produção vale |
| testes · `nav.test.ts` | a guarda das nossas decisões | a guarda das deles | o nosso, reescrito para o menu final | a guarda acompanha o `enxugamento.md` |
