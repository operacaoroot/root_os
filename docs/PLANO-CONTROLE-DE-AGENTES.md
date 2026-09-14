# O controle de agentes do ROOT OS — espelhando o Paperclip

> Decidido em 13/09/2026 com o Pedro: **módulo do produto desde já** (cliente usa) e
> **caminho A** — nada de código do Paperclip entra aqui; o que entra é o MODELO dele,
> construído nas telas que já existem, dentro do tenant, da porta, do cofre e do RASTRO.
>
> Plano vigente do produto: `docs/PLANO-CONTINUIDADE.md`. Este documento é uma frente
> dele, não um plano concorrente.

## Por que não é uma cópia

| | marketing-os | Paperclip (`paperclipai/paperclip`, MIT) |
|---|---|---|
| Código TS | 535 arquivos / ~150 mil linhas | ~4.700 arquivos / ~2 milhões de linhas |
| Banco | Prisma, 72 tabelas com RLS forçado | Drizzle, 266+ migrations |
| Front | Next 15 App Router | Vite + React Router + xterm |

O Paperclip é ~13x o OS inteiro, com outro ORM e outro roteador. Copiar o código
seria trocar de produto — e cada tabela deles que chegasse com `orgId` sem ligar o
isolamento por linha **derruba a API no arranque** (conferência final da migration
`20260911050000_isolamento_por_linha`). O que vale é o desenho: seis conceitos
(organização com meta, agentes, tarefas com checkout atômico, delegação,
heartbeats, governança) e uma navegação que já resolve o problema de tela.

## O que já é nosso, com outro nome

| Paperclip | Aqui hoje |
|---|---|
| Approvals / Decisions | `/atendimento` — fila de aprovação, com conteúdo exato e alçada (fatia 3.10) |
| Activity / Audit | `/rastro` — cadeia de hash, retenção por empresa (RF-R-06) |
| Org / OrgChart | `/organograma` — toda a gente da empresa, com papel e estado |
| Routines | `/rotinas` — estado declarado e histórico, por empresa |
| Agents | `/agentes` — catálogo, dono, capacidades declaradas |
| Connectors | `/conexoes` — contrato único, estado sondado, interruptor por empresa |
| Governance gates | a régua R0–R5 + a porta (`gateway/`), que o Paperclip não tem |
| Budget | `TetoDeCustoIa` / `GastoDeIaNoDia` — teto por empresa e por dia |
| Skills | `Sop` + o catálogo de capacidades (62) |

A nossa governança é mais forte que a deles (eles têm gate de aprovação; nós temos
régua classificando cada capacidade, retenção por nível, segunda pessoa em R3+,
reautenticação em R4/R5 e cadeia de hash). **Nada disso se afrouxa para o modelo
deles caber.**

## O que falta, e é o trabalho

1. **Submenu** — o menu tem um nível só. O Paperclip agrupa em seções colapsáveis
   (Work / Org / Organization) com sub-itens. É a "forma" que o Pedro pediu.
2. **Estado do agente** — ativo, ocioso, rodando, erro, pausado, encerrado. E o
   dono podendo pausar, retomar e encerrar. Hoje só existe o rebaixamento
   automático por erro (`ExecCtx.tetoDoAgente`), que é relógio, não botão.
3. **Custo por agente** — temos por empresa/dia. Falta por agente, com orçamento
   mensal. É também a chance de consertar a **mentira declarada**: `/agentes`
   publica horas "por semana" que são acumulado de vida inteira com as passagens
   que falharam dentro, contradizendo `/rotinas`.
4. **Tarefa com dono único** — `WorkTask` não tem agente responsável nem claim
   atômico. Sem isso, dois agentes fazem o mesmo trabalho e ninguém percebe.
5. **Meta da empresa e ancestralidade** — `GoalConfig`/`GoalWeek` é meta de
   marketing semanal, não "o motivo da empresa existir". Falta a linhagem que faz
   toda tarefa traçar até a meta, e que o Paperclip injeta no prompt como o "por quê".
6. **Heartbeat por evento** — o nosso tique é só cron (`rotinas.scheduler.ts`).
   Faltam os outros quatro gatilhos: atribuição, menção, manual ("Invocar") e
   resolução de aprovação.
7. **Caixa pessoal** — "o que precisa de mim": aprovações que EU posso assinar,
   menções e tarefas paradas, num lugar.
8. **Delegação** — o agente que quebra meta em tarefas e atribui, e contratar
   agente com aprovação do dono.

**Fora do escopo, de propósito:** Workspaces e Pipelines de código (não rodamos
build de cliente), Artifacts, Cases e o board-chat — o `ChatFlutuante` e `/sessoes`
já cobrem conversar e registrar.

## A forma: o menu ganha profundidade

Espelhando o agrupamento do Paperclip sobre o vocabulário que já é nosso
(`SECOES` em `packages/shared/src/nav.ts`), sem inventar palavra nova:

```
A central        Console · Contexto · Sessões · Caixa (novo)
Quem trabalha    Agentes ▸ Visão · Custos (novo) · Habilidades
                 Rotinas · Fluxos · Organograma
O controle       Aprovações · Régua · Rastro · Linha do tempo (novo)
A execução       Trabalho ▸ Tarefas · Projetos (novo) · Metas da empresa (novo)
```

Sub-item é `NavItem.pai?: string` (a `key` do pai) e a seção passa a ser
colapsável, com o estado aberto/fechado em `localStorage`. O filtro por permissão
e por módulo continua sendo o do `navPorSecao` — sub-item sem permissão some, e
pai que perdeu todos os filhos continua clicável se a tela dele existir.

**Isso é espinha, não módulo desligável** — a mesma decisão de `memoria`,
`rotinas` e `organograma`: um cliente que pudesse desligar o controle de agentes
ficaria com agentes rodando e nenhuma tela para vê-los. Rota nova = **declarar o
prefixo** em `apps/api/src/tenants/modulos.ts`; prefixo não declarado lança em
tempo de execução.

## As fatias, em ordem

| # | Fatia | Entrega | Risco | Estado (14/09/2026) |
|---|---|---|---|---|
| A1 | O menu ganha profundidade | submenu colapsável, sem API nova | baixo | na branch `root-os/controle-agentes` |
| A2 | Agente com estado e botão | pausar/retomar/encerrar + "Invocar" | médio | na branch |
| A3 | Custo por agente | tela de Custos, orçamento mensal, e o conserto das horas | médio | na branch |
| A4 | Tarefa com dono único | `agenteId` + checkout atômico (409 no conflito) | médio | na branch |
| A5 | Meta da empresa e linhagem | toda tarefa traça até a meta; o "porquê" no prompt | alto | **especificada**, decisões pendentes |
| A6 | Heartbeat por evento | atribuição, menção, manual, resolução de aprovação | alto | **especificada**, decisões pendentes |
| A7 | A caixa pessoal | o que precisa de mim, agregado | baixo | na branch |
| A8 | Delegação e contratação | o agente que reparte o trabalho | alto | **especificada**, decisões pendentes |
| A9 | Linha do tempo | lê do `EventLog`, sem fonte nova | baixo | na branch |

A1 primeiro porque é a forma que o Pedro pediu e não depende de nada. A2–A4 são
as três que fazem o painel deixar de ser vitrine. A5–A6 são o miolo do modelo
Paperclip, e é onde o desenho precisa de decisão de produto antes de código. A8
por último: ela muda quem manda.

## O que cada fatia tem de respeitar (a lista que custa tempo quando esquecida)

- **Base é a branch `root-os/frente-0`**, não a `main`. Nada disso entra na `main`
  antes do merge da fatia 0.1 — a `main` roda em produção e está 5 semanas atrás.
- **Migration que cria tabela com empresa liga o isolamento por linha**, com
  policy de leitura **e** de escrita separadas. Senão a conferência final aborta e,
  como `migrate deploy` roda no `command` do container, a API não sobe.
- **Permissão nova = três passos**: `pnpm --filter @mktos/shared build` →
  `db:sync-permissions` (não é aditivo) → todo mundo sai e entra (a permissão
  viaja no JWT).
- **Capacidade nova no catálogo = `db:seed:politica` ANTES da subida**, com
  assinatura de rebaixamento; o esquema do banco tem `additionalProperties: false`
  e campo que ele não conhece é recusado pela porta.
- **Variável nova = dois lugares**: o bloco `environment:` do serviço no
  `docker-compose.yml` **e** o `.env`. O container não lê arquivo `.env`.
- **O dono de um agente nunca sai de relação do Prisma** — os quatro lugares
  passam por `apps/api/src/agents/donos-da-casa.ts`.
- **Aprovação R3+ exige segunda pessoa** (invariante 7). "Contratar agente" e
  "aprovar estratégia" caem nisso: numa empresa de operador único ficam retidas
  até existir um segundo usuário com alçada. É decisão de operação, não defeito —
  mas precisa estar dito na tela antes do clique, como `/atendimento` já faz.
- **Script que depende do Nest roda compilado**, em `src/scripts/`. Nada sob `tsx`.
- **Convergir com a segunda base do ROOT OS** (o repo do Rodrigo) antes de abrir
  A5 — meta e tarefa são exatamente onde duas bases divergem sem volta.

## O que já está de pé, e onde (14/09/2026)

Branch **`root-os/controle-agentes`**, saída de `root-os/frente-0`. Nada commitado na `main`,
nada na VPS. Seis fatias dentro: A1 (o submenu), A2, A3, A4, A7 e A9.

Medido em série, por quem escreve esta linha, depois dos consertos abaixo:

| | antes | agora |
|---|---|---|
| `@mktos/api test` | 1488 passando, 37 arquivos | **1699 passando, 43 arquivos, 0 pulados** |
| `@mktos/web test` | 287 passando (1 vermelho conhecido) | **381 passando** (o mesmo 1 vermelho) |
| `@mktos/policy test` | 74 | 74 |
| typechecks | limpos | limpos, **`api typecheck:test` incluído** |
| migrations do zero | aplicam | aplicam (3 novas, nenhuma tabela nova) |

O vermelho do web é anterior e de outra sessão: `conexoes.test.tsx` espera `sondado há …` e o
fixture tem data fixa que passou de 48h, então a tela imprime a data.

### Os três consertos que a verificação adversarial obrigou

1. **`api typecheck:test` estava REPROVANDO** (`test/linha-do-tempo.test.ts`, TS2352). É passo da CI
   e o `vitest` não o pega — o esbuild apaga os tipos sem checá-los, então a suíte saía verde com o
   comando de CI vermelho. Quatro dos cinco relatórios declararam "typecheck limpo": era o outro
   comando. A conferência passou a ser por chave (`Object.keys(...)`), não por conversão de tipo.
2. **`agente.invocado` ia para o RASTRO antes de o agente existir.** `agentSlug` chega cru do
   `@Param('slug')`, então `POST /api/agents/qualquer-coisa/invocar` gravava na cadeia de hash uma
   linha sobre um agente que nunca houve, com texto escolhido por quem chamou. O agente passou a ser
   resolvido (empresa + slug) ANTES do registro.
3. **A dívida gêmea das horas sobrevivia na gaveta de rotina do mapa** (`/contexto`), sem período no
   rótulo: `minutosPorExecucao × execucoes`, com as falhas dentro, publicado como "tempo devolvido"
   ao lado de uma tela que chama o mesmo fato de "por semana". Virou "horas acumuladas · só as
   passagens boas", com a conta descontando as falhas.

### A armadilha que este trabalho descobriu, e que não é do produto

**Duas suítes da API rodando ao mesmo tempo contra o MESMO banco se destroem.** Medido de propósito:
duas execuções concorrentes quebram em `PolicyDecision_orgId_fkey`, `Approval_orgId_fkey`,
`Session_orgId_fkey`, `GastoDeIaNoDia (orgId, dia)` e contagens exatamente dobradas
(`expected 4 to be 2`) — porque os fixtures de cada arquivo usam ids fixos, e dois processos os
semeiam e apagam um debaixo do outro.

Isso explica o "19% de instabilidade" que a fase de verificação relatou: os **três verificadores
rodaram a suíte em paralelo**, no mesmo Postgres. Em série a suíte é determinística — 4 de 4 verdes
aqui, 1699/1699. A CI não corre esse risco (um job, um banco, uma execução), e **quem paralelizar
agente sobre este repositório precisa de um banco por execução**.

### O que ficou declarado e NÃO foi consertado

- **`/agentes` oferece "informar a linha de base" a quem a API recusa.** A tela mostra o botão com
  `automacoes.executar` sozinho; a rota exige `automacoes.executar` **e** `admin.usuarios`, e o
  `PermissionsGuard` é E-lógico. Hoje `admin.usuarios` só existe no `admin_master`. **É defeito
  anterior** (idêntico em `HEAD`), então ficou fora do escopo destas fatias.
- **Falhar ao gravar o evento de invocação não impede a passagem.** É coerente com o
  `@Optional()` do `EventLogService` (sete suítes montam o laço sem ele), mas a alternativa —
  recusar a passagem quando o rastro recusa a escrita — é mudança de comportamento e é decisão.

### A5, A6 e A8: especificação, não código

`docs/especificacoes/A5-meta-da-empresa.md`, `A6-heartbeat-por-evento.md` e
`A8-delegacao-e-contratacao.md`. São 22 decisões pendentes, cada uma com opções e recomendação, e
elas ficam pendentes de propósito: o CLAUDE.md é explícito em que mudar quem publica sozinho é
decisão do Pedro, não de agente. Três que mandam nas outras:

1. **Convergir com a segunda base do ROOT OS (o repo do Rodrigo) antes de A5.** Meta e tarefa são
   onde duas bases divergem sem volta — e agora plano de delegação é a terceira.
2. **Contratar agente é R3, R4 ou R5** — e se a proposta do agente conta como "primeira pessoa" para
   a invariante 7. Se contar, uma empresa de operador único contrata sozinha; se não contar, a
   contratação fica retida até existir um segundo usuário com alçada.
3. **O agente executa item R2 do plano sozinho?** É metade da promessa do Paperclip de um lado, e do
   outro o interruptor de aprovação de R2 que já existe resolve sem uma linha de código.
