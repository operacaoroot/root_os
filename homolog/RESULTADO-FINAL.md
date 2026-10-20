# RESULTADO da versão final · nossa + Pedro + Lucas (19 e 20/10/2026)

> Branch `homolog/final-20261019` (de `comercial/cockpit-homolog`, tag `trabalho-entrega-20261020`). Tag `final-entrega-20261020`. Bundle `C:\Users\User\dev\final.bundle` (`main..homolog/final-20261019`).
> Roteiro: `docs/comercial/RODADA-FINAL-20261019.md`. Registro marco a marco: `homolog/progresso.md` (linhas "Versão final").
> Só homologação, no Predator. **Nada foi à produção.** A virada é `docs/comercial/VIRADA-PRODUCAO.md`, para o Rodrigo e o Pedro executarem depois da validação.
> Este arquivo não tem dado de cliente: só contagens. O que tem título (mapas, sobras, feito, fotos com dado real) fica em `homolog/organizar/` e `homolog/copia/`, fora do git.

## 1. Onde ver

| O quê | Onde |
|---|---|
| A versão final com a cópia da produção de 19/10 (19h33), organizada | `rootos-final`: web `http://100.95.41.124:3030` (e `127.0.0.1:3030`), api `:4030`. Login do Rodrigo e do Lucas com a senha que está em `homolog/.env.final` |
| A versão final com o seed fictício (onde os 5 roteiros rodaram) | `rootos-final-seed`: web `http://127.0.0.1:3031`, api `:4031` |
| A homologação de antes e a cópia de 16h | `rootos-comercial` (3010) e `rootos-copia` (3020), intocadas nesta rodada |

## 2. As fontes e o que entrou

| Fonte | Ref | Como entrou |
|---|---|---|
| Nossa | `comercial/cockpit-homolog` 808d743 | base da branch |
| Lucas (produção) | `lucas/tarefas` abd1476 (a produção roda 10939e1, que difere só num script de carga) | **mesclada** (F1, `-X ignore-space-at-eol`, 23 arquivos em conflito, tabela na §5) |
| Pedro 14/10 | `pedro/operacao-painel-20261014` 7ed42fb | **não mesclada de novo**: o snapshot f5552402 que já está em `lucas/tarefas` é equivalente em código (`git diff 7ed42fb f5552402` = 6 arquivos, nenhum de código: `AGENTS.md`, cabeçalhos "Autorização vigente" de `CLAUDE.md`, `README.md`, `docs/DEPLOY.md`, `docs/PLANO-CONTINUIDADE.md` e 5 linhas do `.env.example`). Esses textos operacionais ficam fora: **[a decidir pelo Rodrigo]** se entram na virada |
| Lucas, painel comercial | `lucas/comercial-painel` 19dd275 | **não mesclada de novo**: os 2 commits a mais são os mesmos patches já em `lucas/tarefas` (`git cherry` marca os dois com `-`) |
| `root-os/atendimento` além do que já está em `lucas/tarefas` | | **fora**, pela decisão 3 (o WhatsApp continua no Motor Comercial) |

## 3. O que a versão final entrega, lane por lane

| Lane | O que entrou | Onde está o detalhe |
|---|---|---|
| F1 · o merge | `lucas/tarefas` mesclada sobre a nossa; snapshot do Pedro conferido (equivalente, não mesclado de novo); conciliação do `WorkTask.clienteId` (o do Lucas, que aponta para um card de lista `cadastro`, vira o nosso, que aponta para `Partner`), idempotente nos três pontos de partida; `WorkArea` e `outrosResponsaveisIds` ficam; toda tabela da produção com RLS e FORCE; `prisma migrate diff` idêntico à linha de base da produção | §5, `homolog/final/conflitos.md`, `homolog/final/enxugamento.md` |
| F2 · Motor Comercial | Painel geral do Lucas (layout dele) como primeira tela, lendo `Lead`, ficha comercial, fechamentos, contratos vivos e o canal da entrada; Propostas (tela do Lucas) lendo também as publicadas pela sala, com visitas, tempo por seção, reações e aceite, ao lado das antigas do serviço; Lista de leads sobre a tabela `Lead` (filtros, copiar contatos, CSV; nada é enviado); menu na ordem do roteiro; Clientes, Tarefas e o funil antigo ocultos com a rota absorvida | `homolog/revisao/lane-B.md` |
| F3 · Dia a dia | Visão geral (o dash do Lucas, por pasta e por lista nossa) como primeira aba e entrada; Pendências (Atividade, Minhas tarefas com vistas salvas e o calendário como uma das formas de ver, Decisões); Aprovações (a nossa); Agenda; Painel geral da empresa | `homolog/revisao/lane-B.md` |
| F4 · Trabalho | Base nossa (pastas, quadro denso, lista, pop-up, cliente obrigatório, atas, Implantação), mais o que só o Lucas tinha: calendário (arrastar muda o prazo), seleção em lote, tarefa que se repete, ordem manual, vários responsáveis (o primeiro é o principal), régua de prazo (Atrasadas · Hoje · Próximos 7 dias · Sem prazo) como agrupamento, concluídas (mostrar/ocultar); "Todas" no seletor de pastas; menu lateral recolhível em todo o OS; a Rodada da semana do Pedro como aba da Implantação, só para a ROOT | `homolog/revisao/lane-C.md` |
| F5 · dados reais | Stack `rootos-final` com a cópia de 19/10 19h33 restaurada direto no banco, credenciais neutralizadas, as migrations do merge por cima e o organizador idempotente (§4) | `homolog/organizar/README.md` |
| F6 · provas, revisão e virada | Os 5 roteiros e o `final.mjs`; suítes; revisão adversarial com os consertos; `docs/comercial/VIRADA-PRODUCAO.md` | §8, `homolog/final/e2e-seed.md`, `homolog/final/suites.md`, `homolog/revisao/final-adversarial.md` |

## 4. Provas

**Roteiros e2e na imagem final com o seed** (stack temporária `rootos-final-seed`, banco novo, seed fictício; `homolog/final/e2e-seed.md`):

| Roteiro | Resultado |
|---|---|
| `ux-painel.mjs` | PASSA, 13 passos, 21 s |
| `painel.mjs` | PASSA, 16 passos, 45 s |
| `jornada-docker.mjs` | PASSA inteira: 23 passos, 13 toques humanos, fechamento com as 6 escritas; e com `JORNADA_PARAR_NO_R4=1`, para no R4 da cobrança (16 de 23) |
| `implantacao.mjs` | PASSA, 14 passos, 77 s |
| `trabalho.mjs` (com `trabalho-t7` e `trabalho-t1b` dentro) | PASSA, 24 passos (t7: R3 num clique, R4 com senha, "Pedir de novo" depois da vencida; t1b sem storage, como na rodada do Trabalho) |
| `final.mjs` contra o seed | 16 de 17. Propostas mostra **9 da sala e 2 do serviço antigo** (o dublê). O passo "Todas mostra tarefas de várias pastas" falha porque o seed só tem tarefa numa pasta: é condição do dado, e o mesmo passo passa na cópia com 4 pastas |

O que mudou nos roteiros, sempre por decisão declarada (nenhuma conferência afrouxada): T6 confere as 8 abas do Comercial na ordem nova e que `/comercial` fica no Painel geral (não redireciona mais ao Funil vivo); T1 entra pela área Trabalho (o menu da produção não tem `title` no link); a tarefa de prova nasce com `assigneeUserId` (Minhas tarefas e Atividade acham por conta desde F1); `ux-painel` aceita `UX_RAIZ=site`. A stack do seed roda com `ROTINAS_CRON=on`, como a `rootos-comercial`, porque a jornada depende do relógio para a mensagem da véspera.

**`final.mjs` com a cópia da produção** (`rootos-final`; `homolog/organizar/prova-final.json`, fotos fora do git): RESULTADO_FINAL_MJS_COPIA

**Suítes** (`homolog/final/suites.md`). A linha de base da produção foi refeita: a de 236 vermelhos estava baixa demais porque o worktree `base-lucas` não tinha o `packages/policy` construído, e todo arquivo que importava a política caía como um vermelho só. Medida de novo num `git archive abd1476` com policy e shared construídos:

| Suíte | Produção (abd1476) | Versão final |
|---|---|---|
| Política | não medida | 101/101 |
| Web | 76 vermelhos em 1103 (9 arquivos) | 77 vermelhos em 1390 (os mesmos 9 arquivos; `agentes-estado` oscila entre 9 e 11 na própria produção) |
| API | 297 vermelhos em 4250, 35 pulados | 269 vermelhos em 4754, 57 pulados |
| Isolamento (papel restrito) | não medida | 498/498 |
| Rotas públicas com RLS | não medida | 56/56 |
| Cofre com RLS | não medida | 97/97 |

**Nenhum vermelho é só da versão final e nenhum vem da política de conflito.** Todos os vermelhos restantes são do mesmo código e do mesmo teste da produção (classe a): permissão e symlink do Windows, as guardas de "acesso atual" e os dublês sem método do Pedro, a catraca de arquitetura com `contexto-movimento-explicito.service.ts` (que veio da produção), testes que pedem `ROOTOS_QA_PREVIEW=1` ou o clone local de QA. A versão final deixa verdes 8 casos que estão vermelhos na produção. Um defeito nosso foi achado e consertado: o `prisma format` tinha realinhado o bloco `PautaEpisodio`, e o teste da MD2 do Pedro confere o texto exato. Os testes novos da revisão: `tarefas-do-dia-cliente` 8/8, `ficha-revisao` 4/4, `destino-do-login` 7/7, `login-destino` 8/8, `nav` 46/46; work-*, tarefas*, caixa*, ficha*, checkout e comercial-seed 290 verdes.

**Conciliação provada** (Postgres descartável com a cópia 19b, depois da revisão): 8 tarefas com cliente → 6 convertidas e 2 sem cliente (citavam cartão em fase de lead; o organizador as leva ao funil), 4 `Partner` criados, nenhum fornecedor promovido, um cartão de título `---` convertido sem derrubar a migration; segunda passada do preparo e da conciliação sem mudança (md5 de tarefa e cliente igual, coluna mantida). A revisão adversarial provou também o ponto de partida da homologação (o vínculo nosso fica) e banco com duas empresas (cada uma com o seu `Partner`; cliente de outra empresa recusado pelo gatilho).
<!-- ORGANIZAR -->

## 5. Conflitos do merge (F1), arquivo a arquivo

`git merge -X ignore-space-at-eol lucas/tarefas` (o nosso lado tem arquivos com CRLF; sem a opção, o arquivo inteiro conflitava por fim de linha). 23 arquivos em conflito textual, mais 3 que quebraram só na compilação (marcados). Regra: no foco a nossa é a referência, com as exceções do roteiro; fora do foco vale a produção; nada do que a produção enxugou volta. Fonte: `homolog/final/conflitos.md`.

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

## 6. O enxugamento: o que a produção tirou, juntou ou renomeou, e o que ficou

Inventário completo, montado ANTES de resolver qualquer conflito: `homolog/final/enxugamento.md` (seções, itens do menu seção a seção, rotas, colisões de rota, snapshot do Pedro). Resumo:

| Item | main antiga (07/10) | Produção (Pedro 14/10 + Lucas) | Nossa | Ficou | Porquê |
|---|---|---|---|---|---|
| Seção Trabalho | 3ª, com itens | 3ª, **vazia** (tudo foi para Dia a dia › Tarefas/Operação) | 2ª, Tarefas · Implantação · Atas | a nossa | foco (F4): o Trabalho é a base nossa |
| Seção Contexto | 2ª | 2ª | 7ª | 7ª | mudança nossa documentada (RESULTADO-PAINEL P0, decisão do Rodrigo de 18/10) |
| Dia a dia › Visão geral `/dia-a-dia` | não existia | "Tarefas", 2º | não existia | **1º, "Visão geral"**, dash do Lucas por pasta e lista nossa | decisão do Rodrigo e decisão 4 |
| Dia a dia › Pendências `/caixa` | visível | **oculta** | visível, em abas | visível, 2º | o roteiro F3 manda Pendências na ordem (decisão explícita vence o enxugamento) |
| Dia a dia › Painel `/painel` | "Visão geral da empresa", 4º | idem, 1º | 4º | 5º, "Painel geral da empresa" | roteiro F3 |
| Dia a dia › Operação `/onboarding` | Implantação, no Trabalho | "Operação" (Implantação + Rodada da semana do Pedro) | redireciona à Implantação | oculta; a Rodada da semana virou aba da nossa Implantação, só para a ROOT; `/operacao` viva | foco Trabalho, sem perder a Rodada |
| Banco de ideias, Estratégia do mês | no Trabalho | **no Motor de Marketing** | ocultos no Trabalho | no Motor de Marketing | fora do foco: a forma deles |
| Marketing › Tarefas, Financeiro › Tarefas | não existiam | visíveis | não existiam | visíveis | fora do foco: sem mudança |
| Comercial › Painel geral `/comercial` | não existia | 1º | `/comercial` redirecionava ao Funil | 1º, layout do Lucas sobre os nossos dados | decisão do Rodrigo |
| Comercial › Leads `/leads` | "Leads" | "Leads" | oculto | "Lista de leads", 4º | decisão 2 |
| Comercial › Funil de vendas `/funil` | visível | visível | oculto | **oculto** + rota absorvida no Funil vivo | sai (vale o nosso) |
| Comercial › Clientes `/clientes`, Tarefas `/comercial/tarefas` | não existiam | visíveis | não existiam | **ocultos** + rota absorvida | saem (duplicados) |
| Propostas `/propostas` | não existia | página viva sem item | não existia | 3º no Comercial | decisão 1 |
| Rotas do web (`page`/`route`) | 64 | 77 | 80 | 92; todas as 77 da produção continuam (conferido por `comm`) | o enxugamento deles é de menu, não de rota |

## 7. O menu final completo, linha a linha, contra o da produção de hoje

Gerado do `NAV`/`SECOES` de `packages/shared/src/nav.ts` (HEAD) contra o de `lucas/tarefas` (o que roda em produção), só itens visíveis. Conferido também que **nenhuma chave de item da produção sumiu** do `NAV` (as diferenças são só acréscimos: os itens do cockpit, Implantação, Atas e Propostas).

| # | Menu final (seção · item) | Produção hoje | Diferença |
|---|---|---|---|
| | **Dia a dia** | | |
| 1 | Dia a dia · Visão geral (/dia-a-dia) | Dia a dia · Tarefas (/dia-a-dia) | mudou de nome |
| 2 | Dia a dia · Pendências (/caixa) | não está no menu | novo no menu |
| 3 | Dia a dia · Aprovações (/atendimento) | Dia a dia · Aprovações (/atendimento) | igual |
| 4 | Dia a dia · Agenda (/agenda) | Dia a dia · Agenda (/agenda) | igual |
| 5 | Dia a dia · Painel geral da empresa (/painel) | Dia a dia · Visão geral da empresa (/painel) | mudou de nome |
| | **Trabalho** | | |
| 6 | Trabalho · Tarefas (/trabalho) | não está no menu | novo no menu |
| 7 | Trabalho · Implantação de clientes (/trabalho/implantacao) | não está no menu | novo no menu |
| 8 | Trabalho · Atas (/trabalho/atas) | não está no menu | novo no menu |
| | **Motor de Marketing** | | |
| 9 | Motor de Marketing · Banco de ideias (/marketing/ideias) | Motor de Marketing · Banco de ideias (/marketing/ideias) | igual |
| 10 | Motor de Marketing · Estratégia do mês (/marketing/estrategia) | Motor de Marketing · Estratégia do mês (/marketing/estrategia) | igual |
| 11 | Motor de Marketing · Produção de conteúdo (/pauta) | Motor de Marketing · Produção de conteúdo (/pauta) | igual |
| 12 | Motor de Marketing · Referências (/referencias) | Motor de Marketing · Referências (/referencias) | igual |
| 13 | Motor de Marketing · Marketing (/marketing) | Motor de Marketing · Marketing (/marketing) | igual |
| 14 | Motor de Marketing · Performance (/marketing/performance) | Motor de Marketing · Performance (/marketing/performance) | igual |
| 15 | Motor de Marketing · Relatório do mês (/marketing/relatorio) | Motor de Marketing · Relatório do mês (/marketing/relatorio) | igual |
| 16 | Motor de Marketing · Instagram (/instagram) | Motor de Marketing · Instagram (/instagram) | igual |
| 17 | Motor de Marketing · Página de links (/bio) | Motor de Marketing · Página de links (/bio) | igual |
| 18 | Motor de Marketing · Campanhas (/campanhas) | Motor de Marketing · Campanhas (/campanhas) | igual |
| 19 | Motor de Marketing · Eventos do site (/pixels) | Motor de Marketing · Eventos do site (/pixels) | igual |
| 20 | Motor de Marketing · Tarefas (/marketing/tarefas) | Motor de Marketing · Tarefas (/marketing/tarefas) | igual |
| | **Motor Comercial** | | |
| 21 | Motor Comercial · Painel geral (/comercial) | Motor Comercial · Painel geral (/comercial) | igual |
| 22 | Motor Comercial · Funil vivo (/comercial/funil) | não está no menu | novo no menu |
| 23 | Motor Comercial · Propostas (/propostas) | não está no menu | novo no menu |
| 24 | Motor Comercial · Lista de leads (/leads) | Motor Comercial · Leads (/leads) | mudou de nome |
| 25 | Motor Comercial · Contratos vivos (/comercial/contratos) | não está no menu | novo no menu |
| 26 | Motor Comercial · Simulador de WhatsApp (/comercial/simulador) | não está no menu | novo no menu |
| 27 | Motor Comercial · Torre das automações (/comercial/torre) | não está no menu | novo no menu |
| 28 | Motor Comercial · Relatório da semana (/comercial/relatorio) | não está no menu | novo no menu |
| | **Motor Financeiro** | | |
| 29 | Motor Financeiro · Financeiro (/financeiro) | Motor Financeiro · Financeiro (/financeiro) | igual |
| 30 | Motor Financeiro · Tarefas (/financeiro/tarefas) | Motor Financeiro · Tarefas (/financeiro/tarefas) | igual |
| | **Motor de IA** | | |
| 31 | Motor de IA · Agentes de IA (/agentes) | Motor de IA · Agentes de IA (/agentes) | igual |
| 32 | Motor de IA · Rotinas automáticas (/rotinas) | Motor de IA · Rotinas automáticas (/rotinas) | igual |
| 33 | Motor de IA · Sessões de IA (/sessoes) | Motor de IA · Sessões de IA (/sessoes) | igual |
| 34 | Motor de IA · Processos (/fluxos) | Motor de IA · Processos (/fluxos) | igual |
| 35 | Motor de IA · Custos de IA (/painel/custo-ia) | Motor de IA · Custos de IA (/painel/custo-ia) | igual |
| | **Contexto** | | |
| 36 | Contexto · Conhecimento da empresa (/contexto) | Contexto · Conhecimento da empresa (/contexto) | igual |
| 37 | Contexto · Marca e pilares (/contexto/marca) | Contexto · Marca e pilares (/contexto/marca) | igual |
| | **Resultados** | | |
| 38 | Resultados · Relatórios (/relatorios) | Resultados · Relatórios (/relatorios) | igual |
| 39 | Resultados · Metas (/metas) | Resultados · Metas (/metas) | igual |
| | **Configurações da empresa** | | |
| 40 | Configurações da empresa · Equipe (/organograma) | Configurações da empresa · Equipe (/organograma) | igual |
| 41 | Configurações da empresa · Ferramentas disponíveis (/ferramentas) | Configurações da empresa · Ferramentas disponíveis (/ferramentas) | igual |
| 42 | Configurações da empresa · Integrações (/conexoes) | Configurações da empresa · Integrações (/conexoes) | igual |
| 43 | Configurações da empresa · Regras e permissões (/regua) | Configurações da empresa · Regras e permissões (/regua) | igual |
| 44 | Configurações da empresa · Cofre (/cofre) | Configurações da empresa · Cofre (/cofre) | igual |
| | **Registros** | | |
| 45 | Registros · Registro de ações (/rastro) | Registros · Registro de ações (/rastro) | igual |
| 46 | Registros · Atividade (/linha-do-tempo) | Registros · Atividade (/linha-do-tempo) | igual |
| | **Configurações da conta** | | |
| 47 | Configurações da conta · Configurações da conta (/config) | Configurações da conta · Configurações da conta (/config) | igual |

**Itens do menu da produção que não estão no menu final** (todos ocultos e com rota viva; nenhum `NavItem` apagado):

- Dia a dia · Operação (/onboarding)
- Motor Comercial · Funil de vendas (/funil)
- Motor Comercial · Clientes (/clientes)
- Motor Comercial · Tarefas (/comercial/tarefas)


## 8. A revisão adversarial e o que foi consertado

Laudo: `homolog/revisao/final-adversarial.md` (revisor sem permissão de escrita no código; Postgres descartável próprio). Veredito: **fecha com ressalvas**, nenhum achado bloqueia a virada. Todos os "corrigir antes do RESULTADO" foram tratados:

| # | Achado | O que foi feito |
|---|---|---|
| 1.1 | Cartão citado com nome que some na normalização (ex.: `---`) e sem CNPJ derrubava a conciliação | chave do grupo cai no id do cartão e o nome em "Cliente sem nome"; provado na cópia |
| 1.2 | A conciliação mudava o Financeiro: fornecedor de nome parecido virava cliente, e cartão ainda em fase de lead virava `Partner` cliente | pelo nome só casa quem já é cliente; só o CNPJ promove; cartão de lead não vira `Partner` (a tarefa fica sem cliente e o organizador decide pelos mapas) |
| 1.3 | Rodada por papel que não atravessa o RLS, a conciliação apagaria os vínculos em silêncio | recusa rodar sem superusuário ou BYPASSRLS, e confere a conta (convertidas + de lead = com cliente) antes do `DROP` |
| 1.4 | O preparo, reaplicado à mão depois da conciliação, tirava a coluna do esquema | só age enquanto a migration do Lucas (que cria `WorkArea`) não passou; provado |
| 1.7 | "Novo cliente" nas Tarefas do Financeiro, do Marketing e do Comercial criava cartão no CRM e a API respondia 400 | acha ou cria o `Partner` cliente pela regra do Trabalho; dois cliques, um cliente |
| 1.8 | A carga do ClickUp do Lucas gravaria o id do cartão como cliente e quebraria na chave nova | resolve o `Partner` cliente pelo nome ou deixa vazio; nunca cria nem grava cartão; aviso no VIRADA |
| 1.9 | Deduplicação por cliente comparava id de `Partner` com id de cartão | tirada |
| 2.1 | O login mandava ao Dia a dia quem não tem o módulo `trabalho` | só com `tarefas.ver` e o módulo; senão, a regra da produção |
| 2.2 | Sumiu a criação manual de trilho de onboarding (nenhuma tela chama mais a rota) | **[a decidir pelo Rodrigo]**: o caminho de hoje para cliente fechado fora do funil é "Registrar cliente já fechado" (rodada do Trabalho, T1b), que abre a implantação; empresa sem o módulo `leads` fica sem tela para abrir trilho. A rota da API segue viva |
| 2.5 | Comentários do menu descreviam o menu antigo | alinhados |
| 4.1, 4.2 | A neutralização não cobria a sala do cliente (cópia feita depois da virada) nem vencia aprovação pendente | cobre as duas |
| 5.1 | O organizador tratava falha ao listar `Partner` como lista vazia (cliente duplicado) | aborta antes de escrever |
| 5.2 | Tarefa nova fora dos mapas, numa lista movida, recebia o cliente da casa por suposição | só a tarefa dos mapas; a nova vira sobra "escolher à mão" |
| 5.3 | O organizador não conferia se a API já era a do merge | confere a API, a lista de `Partner` e que nenhuma tarefa aponta para cartão, antes de qualquer escrita |
| 5.4 | Pela rede interna da VPS a passada real escrevia sem `--producao` | escrever exige `--producao` ou `--homologacao`, em qualquer endereço |
| 6.1 | VIRADA contava 12 migrations e a tabela tinha 13 | 13 |
| 6.2 | A política ia à produção antes do ensaio das migrations | o passo 4 é o ensaio completo (política, migrations duas vezes, boot) num banco descartável; só o passo 5 escreve em produção |
| 6.3 | O passo 9 não tinha `--producao`, nem como passar senha, nem as contas exigidas | argumentos completos, senhas só na memória do terminal (`read -rs`, `unset` no fim), contas com senha e as permissões |
| 6.4 a 6.6 | Carga do ClickUp depois da virada; `PROPOSTAS_*` no compose; `IMG_ID` fora do bloco da sessão | aviso no passo 9; contagem (sem valor) no passo 0; `IMG_ID` no bloco da sessão |

**Ficaram registrados, sem conserto nesta rodada:**
- a chave nova `clienteId → Partner` é simples (a do Lucas era composta com `orgId`); o gatilho confere a tarefa, mas trocar o `orgId` de um `Partner` não é barrado pelo banco (1.5);
- as homologações antigas (`rootos-comercial`) vão acusar no `migrate status` migration "modificada" (`20261019100000`) e o nome novo `20261018221000_implantacao_card`: é esperado, ninguém "conserte" (1.6);
- Propostas passou a item do menu com `leads.ver`: quem na ROOT tinha só `dashboard.ver` deixa de ver o item (decisão 1; as do serviço seguem presas à sessão da plataforma) (2.3);
- a catraca de arquitetura vermelha por `contexto-movimento-explicito.service.ts`, que veio da produção igual: o dono da produção decide entre exceção com motivo e passar pela porta; a catraca não foi afrouxada (2.4);
- nas Tarefas do dia do Lucas (`/trabalho/todas`): a ordem manual não confere a versão porque a tela dele não a manda; `GET` e as rotas de áreas sem a guarda de acesso atual, e as áreas padrão criadas dentro de um `GET`; a estrutura do Trabalho devolve o e-mail da equipe toda a quem tem `tarefas.ver`. Nada disso vaza entre empresas; fica para a próxima rodada, com o Lucas;
- o organizador não é transacional (vai pela API, de propósito) e lê até 500 tarefas por lista; numa queda entre o pedido e a confirmação de um movimento de etapa sobra uma aprovação pendente (5.5).

## 9. O que apagar depois, no Predator (lista exata)

Ninguém apagou nada nesta rodada (regra da casa). Tudo abaixo tem dado real de cliente, credencial de homologação ou é sobra de construção. **Quem apaga é o Rodrigo**, depois de validar a versão final e de a virada estar feita. Ordem sugerida: stacks, depois arquivos.

**Stacks com dado real (containers e volumes):**

```bash
docker compose -p rootos-copia down -v   # rootos_copia_{db,staging,api,web,redis,asaas_mock,zapsign_mock}
                                         # volumes rootos-copia_rootos_copia_{db,staging,vault,asaas,zapsign}
docker compose -p rootos-final -f homolog/docker-compose.final.yml --env-file homolog/.env.final down -v
                                         # rootos_final_{db,api,web,redis,asaas_mock,zapsign_mock,propostas_mock}
                                         # volumes rootos-final_rootos_final_{db,vault,asaas,zapsign}
```

**Stack só com dado fictício (o seed), pode ir junto:** `docker compose -p rootos-final-seed -f homolog/docker-compose.final-seed.yml --env-file homolog/.env.final-seed down -v`.

**Imagens** (o contexto de construção fechava as pastas com dado real no `.dockerignore`, então nenhuma tem dado de cliente; são só espaço, 2,6 GB cada): `rootos-final-app:{f1,f2,final1-rollback,final2,final}`, `rootos-copia-app:trabalho-entrega-20261020`, `rootos-final-propostas-mock:latest`, `rootos-final-seed-propostas-mock:latest`.

**Arquivos com dado real de cliente:**

| Caminho | O que é |
|---|---|
| `C:\Users\User\dev\producao\producao-root-20261019.dump` | cópia da produção das 16h |
| `C:\Users\User\dev\producao\producao-root-20261019b.dump` | cópia da produção das 19h33 (a restaurada na `rootos-final`) |
| `C:\Users\User\dev\marketing-os\homolog\copia\` (a pasta inteira) | mapas, contagens, fotos e staging da rodada da cópia (fora do git) |
| `C:\Users\User\dev\marketing-os\homolog\organizar\`, **menos** `organizar.mjs`, `neutralizar-copia.mjs` e `README.md` (que estão no git) | `feito.md`, `sobras.md`, `plano.md`, `mapa-novos.json`, `_novos-detalhe.json`, `plano-esperado.json`, `neutralizacao.md`, `contagens-*.json`, `prova-final.json`, `restore.log`, `fotos/` |
| `C:\Users\User\dev\scratch-f5\` | rascunhos da lane D (`copia/`, `copia.tar`, `todas.json`, `neutralizado.json`, SQL de contagem) e o log de construção |
| `C:\Users\User\dev\scratch-e\` | rascunhos da lane E |

**Credenciais de homologação:** `homolog/.env.copia`, `homolog/.env.final`, `homolog/.env.final-seed` (fora do git).

**Bundles desta frente:** `C:\Users\User\dev\final.bundle` e `C:\Users\User\dev\rootos-final.bundle` (depois que a branch chegar ao GitHub pelo rito da quinta), `C:\Users\User\dev\copia-lucas.bundle`.

**Árvores de trabalho dos agentes e a linha de base:** `git worktree remove` em `C:\Users\User\dev\base-lucas` e em cada `marketing-os\.claude\worktrees\agent-*`; os bancos de teste `base_lucas_test` e `*_final_test` no Postgres da homologação (5440) são fictícios e podem ir com `DROP DATABASE`.
