<!-- rootos-autonomia-20261011 -->
## Autorização vigente — 11/10/2026

Leia [AGENTS.md](../AGENTS.md). Preserve dados, segredos e trabalho dos demais.

As descrições antigas de produção abaixo são históricas. Confira o ambiente efetivo conforme AGENTS.md antes de executar receitas de deploy. Nesta branch, a receita de subida em produção é `docs/comercial/VIRADA-PRODUCAO.md`.
<!-- /rootos-autonomia-20261011 -->

# Plano de continuidade de desenvolvimento — marketing-os → ROOT OS

> Escrito em 10/09/2026 a partir do repo (`main` + branch `root-os/frente-0`), do pacote `HANDOFF-DEV` do vault `Obsidian/Root`, das notas de oferta e inbox do vault, das memórias do Claude, da VPS e do grupo de WhatsApp "ROOT | Estratégia e Produto" (08/05→10/09). Revisado contra `02-CONSTRAINTS.md`, `06-ESTADO-DA-BASE.md` e o código da branch.
>
> **Como usar:** cada fatia vira uma tarefa no ClickUp (espaço root) com dono e o "pronto quando" copiado. Ao concluir, marcar ✅ aqui com data e commit. Este documento substitui `ROADMAP.md`. Cópia espelhada no vault: `Obsidian/Root/20-empresa/root-os/17 - Plano de continuidade (set-26).md` — a versão do repo é a canônica.

## 1. Contexto

O `marketing-os` nasceu em 06/07 como "sistema de marketing" da ROOT e em 17–20/08 virou a base do **ROOT OS**: plataforma multi-tenant de IA aplicada, vendida a R$ 3.000/12x como porta de entrada (degrau 1), com agentes por assinatura (degrau 2), implantação assistida (degrau 3) e crew (degrau 4). O pacote de handoff pede exatamente este documento: "um plano que uma pessoa com agentes de código consiga executar sem reabrir decisão a cada passo".

O que mudou desde o handoff e obriga a replanejar:
- Pedro codou a branch `root-os/frente-0` (27–31/08): régua R0–R5 em runtime, porta (gateway) em modo observar, runtime de agentes, sessões, chat, canal terminal, 65 testes na API. **Só local, sem push, sem merge, sem deploy.** Produção roda `main` de 03/08.
- Clientes pagantes definem o backlog real: ProMedical (R$ 12k, "instalação do OS + view de vendas"), Cartório de Descoberto (Rodrigo, VPS própria), cliente BSB (R$ 30k), Curral em uso real, Soberana e BRAM como leads.
- Rodrigo publicou `operacaoroot/root-os` em 01/09 — **uma segunda base do ROOT OS**.
- A VPS da FullBPO saturou em 09/09 (load 226, 19 serviços em 0/0). A Root comprou VPS própria (Hostinger KVM 8) no mesmo dia; destino do `marketing-os` indefinido.
- Dores repetidas no grupo: segurança como objeção nº 1 de venda, "muita ponta solta", tudo depende do Pedro para código e deploy, limites/custo de IA, ninguém consegue carregar contexto direito ("nosso OS tem que ter isso").

Resultado esperado: um documento único, versionado no repo e espelhado no vault, com fatias ordenadas por dependência, critério de pronto verificável, plano de migração sem derrubar produção, plano de testes, riscos e a lista de decisões humanas pendentes.

## 2. Fatos que ancoram o plano (verificados em 10/09)

| Fato | Evidência |
|---|---|
| `main` parado em 03/08 e **1 commit à frente de `origin/main`**; `root-os/frente-0` = 18 commits, 113 arquivos, +14.582 linhas, só local | `git branch -vv`, `git log main..root-os/frente-0` |
| A branch entrega: `@mktos/policy` (`escada.ts`, `verificacao.ts`, `politica-root.json` cópia byte a byte do anexo do vault, `politica-marketing-os.json` 51→60 capacidades); `gateway/` (ToolGateway, EventLog com pré-condição e advisory lock, validação de argumento, `acoes.service.ts` como segundo caminho de execução); `policy/` (sinais, `PolicyVersion` por org); `agents/` (runtime com teto por agente, sessão, SOP com escalação fixa, context-builder com `procedenciaExterna`, capacidades declaradas por agente **já recusadas na porta**); `llm/` (`step()` com tool-calling e custo, OpenRouter com `usage.cost`); telas `/painel /contexto /sessoes /agentes /regua /rastro /conexoes`; nav em dois eixos; migration `20260829161052_regua_porta_rastro` (RULEs no-update/no-delete no `EventLog`, `REVOKE` condicional para `mktos_app`) | `git diff --name-only main..root-os/frente-0`, revisão do Plan agent |
| Testes na branch: api 65 casos (tenant-isolation 14 — **fora do `pnpm test`**, porta 16 e runtime 9 — **pulados sem `TEST_DATABASE_URL`**, llm-step 10, validacao 9, env 7) + policy 19 + web nav 18. **Sem CI.** | `apps/api/vitest.config.ts`, `.github/` inexistente |
| RLS não pode ser ligado ainda: app conecta como dono (`DB_USER=mkt`), `prisma.service.ts` é um `PrismaClient` de 9 linhas sem `SET LOCAL`, rotas públicas da bio e `events.controller.ts:25` (`slug:'root'`) leem tenant sem contexto | branch, memória `root-os-produto` |
| ~~**Em `GATEWAY_MODO=observar` a porta executa escrita R3 sem aprovação**~~ (criava a aprovação, logava "TERIA RETIDO" e chamava `efeito()` assim mesmo; `whatsapp.mensagem.enviar` já tinha efeito ligado, então mandava mensagem em nome de quem nunca aprovou). **RESOLVIDO na onda 1 (10/09/2026, fatia 0.3a)**: observar afrouxa o REGISTRO, nunca o EFEITO — bloqueio de R5 e retenção por aprovação valem igual nos dois modos, e o `modo` só carimba a `PolicyDecision`. Fica registrado aqui porque é a origem da regra, não porque o furo siga aberto. | `gateway/tool-gateway.service.ts`, `agents/efeitos.service.ts`, `apps/api/test/porta.test.ts` |
| Menu da branch tem 5 telas sem página (`/rotinas /fluxos /organograma /atendimento /ferramentas`); `/atendimento` exige `whatsapp.enviar` na nav mas a API de aprovação exige `mcp.executar` | `nav.ts`, `approvals.controller.ts:34-73` |
| Produção (VPS FullBPO): `/srv/marketing-os` em `main`, sem `gateway/policy/agents`; containers de 01/09 na imagem marcada `rollback`; `.env` já tem `GATEWAY_MODO`, `OPENROUTER_*`, `LLM_PROVIDER`, `RASTRO_RETENCAO_DIAS=1825` no compose | ssh (só nomes de variáveis) |
| **Syncthing sincroniza o repo Mac↔VPS incluindo `.git` e `.env`** (`.stignore` só ignora `.env.bak.*`) | `.stignore` |
| Bloqueio externo único: Google OAuth (app em modo Teste, escopos sensíveis) | `docs/ROADMAP.md:59` |
| Docs desatualizados: `README.md` ("Fase 0 — sem código"), `ROADMAP.md` (Pauta 2/3 pendentes, entregues em 03/08), `MCP_TOOLS.md` (10 tools; são 35), `.env.example` sem `GATEWAY_MODO`/`OPENROUTER_*`/`TEST_DATABASE_URL`; **`docs/adr/` não existe** (ADR-001..008 vivem só no vault) | Explore, revisão |
| 13 modelos sem `orgId`; `BioVisitor` é **global por desenho** (mesmo browser visita páginas de orgs diferentes; `tenant-isolation.test.ts:50-53`) | `06-ESTADO-DA-BASE.md §5`, teste |
| ProMedical fica **fora** do marketing-os por ora (kit `~/dev/promedical-os`). Entra depois como primeiro tenant cliente. | Pedro, 10/09 |

O que o WhatsApp acrescenta (o que o handoff não sabia):
- **mai–jun:** pivô de arquitetura (Hermes na VPS abortado por custo → método no Claude Code + Obsidian); regra "custo < R$ 5/peça"; vault vetorizado + MCP como ideia mais citada; deploy só o Pedro sabe fazer.
- **jul:** "agora temos o produto" (09/07); modelo Lego (um produto replicado por nicho); oferta nunca embalada; Meta/Instagram como gargalo técnico; ClickUp como fonte única de tarefas pedido 4 vezes.
- **ago–set:** esteira de 17–18/08 (as decisões que valem); "degrau 1 não age"; zero manutenção como princípio; implantação em 1 dia; segurança como objeção nº 1 (auditoria do FinOps achou 20 Edge Functions com service_role); homologação × produção para equipes de cliente; "view de vendas / relatório vivo de leads do WhatsApp" é o pedido mais frequente (Soberana, ProMedical); contexto organizado dentro do OS é dor explícita do Pedro (21/08); Lucas disponível integral a partir de set; Rodrigo entrega sozinho o cartório.

## 3. Decisões que o plano assume

Já tomadas (não reabrir): ADR-001 evoluir o `marketing-os` · ADR-003 RLS por linha · ADR-004 gateway é a única porta · ADR-005 dois MCPs · ADR-006 núcleo fechado no V1 · ADR-008 ROOT é o tenant 001 · esteira de 17/08 · `02-CONSTRAINTS.md` prevalece (stack fixa: **cron próprio para rotina de tenant, dependência nova é decisão humana**).

Tomadas nesta sessão (Pedro, 10/09):
- **D-1 · `root-os/frente-0` é a base.** Merge em `main` + push é o passo 0.
- **D-2 · Plano mora nos dois lugares:** `docs/PLANO-CONTINUIDADE.md` (repo) + `Obsidian/Root/20-empresa/root-os/17 - Plano de continuidade (set-26).md`.
- **D-3 · ProMedical/Curral/Cartório são implantações fora do OS por ora.** Entram como *espec* do que o OS precisa oferecer para absorvê-las — não como dependência.
- **D-4 · Existe uma 2ª base (`operacaoroot/root-os`, Rodrigo).** Item de convergência na Fatia 0; recomendação: uma base só (esta), backlog do Rodrigo importado.

## 4. O plano — fatias em ordem de dependência

Convenção: **[P]** pequeno (≤ 1 dia de agente), **[M]** médio (2–4 dias), **[G]** grande (1–2 semanas). "Pronto" é sempre um teste, um número registrado ou um comportamento demonstrável. `RF-` referencia o PRD. Itens sem `RF-` são meta (infra, docs, decisão) e estão marcados como tal.

### Fatia 0 · CONSOLIDAR — *parar de perder trabalho* (antes de qualquer feature)

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 0.0 | **Tirar `.env` e `.git` do Syncthing** (`.stignore`) e decidir como o código chega na VPS (recomendação: `git pull` de `origin/main` ou rsync explícito no `deploy/up.sh`). Hoje um checkout no Mac altera a VPS e o `.env` de produção copia para o Mac (proibição 10 das constraints) | meta | — | `.stignore` com `.env` e `.git`; `deploy/up.sh` documenta o caminho | `.stignore`, `deploy/up.sh`, `docs/DEPLOY.md` (novo) | P |
| 0.1 | Merge `root-os/frente-0` → `main` (traz também o commit local `5072bfb`), push, tag `v0.2.0-root-os` | meta | 0.0 | `origin/main` contém 3da16c7; `pnpm typecheck && pnpm test` verdes | git | P |
| 0.2 | CI (GitHub Actions): typecheck + vitest (api, policy, web) com Postgres pgvector de serviço e `TEST_DATABASE_URL` (senão `porta`/`runtime` pulam ~25 casos) + job separado `test:isolamento` (`tenant-isolation` está fora do `pnpm test`) + `prisma migrate deploy` | RF-T-05, RF-P-08 | 0.1 | PR com teste quebrado fica vermelho; os 3 jobs aparecem | `.github/workflows/ci.yml`, `apps/api/package.json` | P |
| 0.3a | **Trava antes do deploy:** em `observar`, capacidade R3+ **retém** (cria aprovação e não executa); só R0–R2 passam observando. Superfície de agentes (`/agentes`, `agents/:slug/executar`, `stream`, chat) atrás de papel admin. Checklist OWASP mínimo executado (LLM01, LLM02, LLM05, LLM06 de `05-SEGURANCA-OWASP.md`) e registrado em `docs/AUDITORIA-SEGURANCA.md` | RF-G-03, RNF-08 | 0.1 | `porta.test`: R3 em observar não chama `efeito()`; checklist com 4 itens marcados e data | `gateway/tool-gateway.service.ts`, `agents/agents.controller.ts`, `docs/` | P |
| 0.3b | Deploy em produção com `GATEWAY_MODO=observar` (`up -d --no-build api web` após `docker compose build api` + smoke na imagem); confirmar se `/rastro` lê `EventLog` (se lê `AuditLog`, expor GET em `gateway/`) | meta | 0.3a | `os.operacaoroot.com/painel` com nav em dois eixos; `/rastro` mostra `EventLog`; `bio` e `/central` intactos; imagem anterior marcada `rollback` | compose (variáveis já existem) | P |
| 0.4 | Docs honestos: `README.md`; `ROADMAP.md` aposentado → aponta para este plano; `MCP_TOOLS.md` (35); `.env.example` completo; `docs/adr/` criado com ADR-001..008 trazidas do vault; `CLAUDE.md` com as armadilhas da branch (tsx/vitest sem decorator metadata, `docker compose build api`, `GATEWAY_MODO` lido no construtor → rollback só com `up -d --no-build`, migration falha = API fora porque `migrate deploy` roda no `command`) | meta | 0.1 | leitura sem contradição com o código | `docs/`, `README.md`, `CLAUDE.md`, `.env.example` | P |
| 0.5 | **Convergência com `operacaoroot/root-os`**: Pedro e Rodrigo abrem os dois repos lado a lado; decidir base única; importar o backlog do Rodrigo; migrations dele **não** entram sem renumerar (timestamp entre 03/08 e 29/08 colide com `regua_porta_rastro`) | meta | — | decisão escrita em `docs/adr/ADR-009-base-unica.md` + backlog importado | `docs/adr/` | P (reunião) |
| 0.6 | Backlog do produto no ClickUp (espaço root), uma lista por fase, cada fatia = tarefa com dono e "pronto quando" | meta | 0.5 | as tarefas deste plano existem lá | ClickUp (via MCP) | P |

Por quê: 14 mil linhas sem backup no remoto há 10 dias, produção 5 semanas atrás do código, um segundo repo nascendo, e a porta em observar executando R3 — nada que se planeje depois sobrevive a esses quatro.

### Fase 0 · O CHÃO — *isolamento antes de qualquer coisa* (RF-T)

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 1.1 | Decisão escrita dos 13 modelos sem `orgId`: `orgId` redundante em todo filho de tenant (`LeadEvent`, `BioLink`, `BioChallenge*`, `Work*`, `IntegrationHealth`); **globais declarados em lista versionada**: `Org`, `Permission`, `BioVisitor` (por desenho); coluna nullable → backfill pelo pai → NOT NULL | RF-T-01 | — | lista global em `packages/policy` ou `docs/adr/ADR-010`; migration `orgid_filhos` aplicada; `tenant-isolation.test` cobre os 13 | `schema.prisma`, migration, teste | M |
| 1.2 | Contexto de execução (`common/`): tenant + ator + correlação atravessam request → serviço → gateway **e o segundo caminho `gateway/acoes.service.ts`** (hoje `Efeito = (args, orgId)` sem ator); ausência de tenant é erro | RF-T-04, RNF-09 | 0.1 | teste: rota sem tenant devolve 4xx; efeito executado por aprovação carrega ator e `correlationId` no `EventLog` | `common/execution-context.ts`, `gateway/acoes.service.ts`, guards | M |
| 1.3 | Sessão de banco com tenant: role `mktos_app` NOBYPASSRLS (o `REVOKE` da migration `regua_porta_rastro` passa a valer); extension do Prisma faz `SET LOCAL app.org_id` em toda transação, **inclusive `$queryRawUnsafe` (`obsidian.service.ts`) e o `$transaction` do EventLog**; migração/seed com role dona separada; compose troca `DB_USER` | RF-T-02, RF-R-01 | 1.2 | `diagnóstico do banco` do teste reporta RLS disponível; produção funciona com FORCE desligado; `EventLog` sem UPDATE/DELETE para o app (teste) | `prisma.service.ts`, `deploy/`, compose | **G** |
| 1.4 | Rotas públicas sob RLS: `bio-public.controller`, `events.controller` (org por chave de pixel/domínio, não `slug:'root'`), `/central/r/:codigo` — cada uma resolve tenant explicitamente | RF-T-04 | 1.3 | isolamento com FORCE ligado passa nas rotas públicas | `bio/`, `events/`, `central` | M |
| 1.5 | Ligar RLS + `FORCE ROW LEVEL SECURITY` tabela a tabela com migration reversível, incluindo policy em `KnowledgeNote` (a busca vetorial já filtra `orgId` na consulta — `obsidian.service.ts:195`; o que falta é o banco garantir) | RF-T-02, RF-T-03 | 1.4 | suíte de isolamento inteira verde no job de CI, inclusive `busca vetorial cruzada` | migration `rls_on`, teste | M |
| 1.6 | `TenantModule`: campo de módulos habilitados em `Org` (**migration**), guard na API + filtro na nav (hoje só visual) | RF-T-06, ADR-002 | 1.2 | tenant novo vê só a espinha; ROOT vê tudo; rota de módulo desabilitado → 404 (teste) | `schema.prisma` (Org), `tenants/` novo, `nav.ts`, guard | M |
| 1.7 | Provisionamento idempotente de tenant (script compilado em `src/scripts/` + rota admin): Org, papel inicial, política padrão, contexto vazio. **Não reusa `db:seed`** (não é idempotente, commit `fe24ad7`) | RF-T-07 | 1.6 | rodar duas vezes não duplica; o segundo tenant vira fixture da suíte | `tenants/provisionar.ts` | P |

**Saída:** dois tenants semeados; nenhuma rota, tool MCP ou busca semântica devolve dado do outro; CI reprova regressão.

### Fase 1 · A RÉGUA — *fechar o que a branch abriu* (RF-P)

Já existe e não se reescreve: escada em runtime, catálogo delta, `PolicyVersion` por org (`policy.service.ts:recarregar(orgId)`), `verificarCatalogo()`, sinais, **capacidades declaradas por agente com recusa na porta** (`porta.test.ts:161`, `runtime.test.ts:218`). Falta:

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 2.1 | Sobrescrita por tenant com data, responsável e diff; rebaixar só por configuração escrita. **Pode correr em paralelo à Fase 0** (`PolicyVersion.orgId` já existe) | RF-P-04, RF-P-06 | 0.1 | teste: tenant sobrescreve uma capacidade e herda o resto; rebaixamento sem responsável é recusado | `policy/`, `PolicyVersion` | M |
| 2.2 | Lacuna normativa dos três "desfazer" pendurados (`clickup.tarefa.excluir`, `crm.lead.arquivar`, `agenda.evento.excluir`): ou entram no catálogo com efeito, ou as capacidades R2 viram `reversibilidade: manual`. **Editar `politica-root.json` exige editar `HANDOFF-DEV/anexos/politica-root.json` no mesmo commit** (cópia byte a byte, `packages/policy/src/index.ts:4-7`) | RF-P-02 | — | Set `DESFAZER_PENDURADO` em `packages/policy/test/politica.test.ts:53-57` vazio | `politica-root.json` (repo + vault) | P |
| 2.3 | Tela `/regua` completa (níveis, sinais, capacidades por agente, sobrescritas do tenant) + simulador | RF-P-09, RF-B-01 | 2.1 | operador submete ação hipotética e vê nível + gatilhos + exigência | `apps/web/src/app/regua` | M |

**Saída:** catálogo inteiro classifica igual ao declarado em CI; capacidade nova sem classificação é recusada (já vale hoje).

### Fase 2 · A PORTA — *ninguém age por fora* (RF-G, RF-A, RF-R)

Já existe: `ToolGateway`, `EventLog` como pré-condição (transação própria + advisory lock, `porta.test.ts:290`), RULEs de append-only, redação de args `restrita`, validação de argumento, teto por agente (`Agent.tetoCustoUsd/tetoSegundos`), custo real do OpenRouter, sinal `procedenciaExterna` de mão única. Falta:

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 3.1 | Relatório do modo observar: contagem em `PolicyDecision` (`modo='observar'`, `permitido=false`) por capacidade e nível, 2 semanas de produção; calibrar antes de impor (> 20% em R3+ trava a operação; quase tudo em R0/R1 é régua frouxa) | RF-P-03 | 0.3b | script produz a tabela; decisão de calibração escrita no ADR | `apps/api/src/scripts/relatorio-observar.ts` | P |
| 3.2 | **Teste de arquitetura**: nenhum módulo importa conector fora do gateway. Lista inicial de violações conhecidas que o teste deve pegar: `agents/efeitos.service.ts:3` (importa `EvolutionService` direto), `gateway/acoes.service.ts` (executa fora de `ToolGateway.executar`) | RF-G-01 | 0.2 | teste em CI com allowlist explícita; as duas violações resolvidas | `apps/api/test/arquitetura.test.ts`, `agents/efeitos.service.ts`, `gateway/acoes.service.ts` | M |
| 3.3 | Escritas existentes passam pelo gateway, uma por vez, cada uma com teste: Google (e-mail, evento, doc — hoje **sem aprovação nenhuma**), ClickUp (tarefa, status), Evolution (grupo), Bio (links), Finance (acima do limite). `@SensitiveWrite` manual some | RF-G-01, RF-A-01 | 3.2, 1.2 | `porta.test` cobre cada escrita; 3.2 verde | `google/`, `work/`, `pauta/`, `bio/`, `finance/` | G |
| 3.4 | Aprovação real por nível: R4 exige **reautenticação de verdade** (`approvals.service.ts:222` só grava `reautenticadoEm`) + motivo + **comparação de `alcadaMinima` com o papel do aprovador** (hoje armazenada, nunca comparada); R5 bloqueia e prepara material. Depende de RBAC (`auth/permissions.guard.ts`), não da régua | RF-A-01..04 | 1.2 | teste: R2 executa, R3 espera, R4 sem alçada é recusada, R5 nunca executa | `approvals/`, `auth/` | M |
| 3.5 | `EventLog` completo: campos por nível, hash para conteúdo `confidencial`, `AuditLog` escrevendo em paralelo até `/auditoria` ler do `EventLog`; retenção por tenant (`RASTRO_RETENCAO_DIAS` hoje é global no compose — **D-D já está de fato decidida em 1825 dias; confirmar**) | RF-R-03, RF-R-04, RF-R-06 | 1.3 | teste: evento R3 traz resumo/aprovador/canal; evento R0 traz pergunta/fontes/custo; conteúdo confidencial não aparece cru | `gateway/event-log.service.ts`, migration | M |
| 3.6 | Teto por **tenant e por dia** (o por agente/execução já existe), corte antes de estourar | RF-G-05, RNF-05 | 1.6 | teste: tenant no teto → execução recusada e registrada | `llm/`, `gateway/`, `Org` | P |
| 3.7 | Desligamento por conector e por tenant pelo painel, efeito em segundos | RF-G-06 | 1.6 | `/conexoes` desliga Google → próxima chamada recusada com motivo | `integrations/`, `/conexoes` | P |
| 3.8 | Testes adversariais (doc com instrução escondida, e-mail com rodapé malicioso, mensagem de cliente pedindo privilégio) sobre o sinal que já existe; portão OWASP completo (10 itens) rodado e registrado | RF-G-07, RNF-08 | 3.4 | 3 testes verdes; `docs/AUDITORIA-SEGURANCA.md` com os 10 itens | `apps/api/test/adversarial.test.ts`, `docs/` | M |
| 3.9 | `GATEWAY_MODO=impor` em produção, rollback = `up -d --no-build api` com `observar` | RF-G-03 | 3.1–3.8 | 7 dias com zero rotina travada medido em `PolicyDecision` (recusas com motivo, sem `erro`); `/rastro` mostra recusas | `.env` VPS | P |
| 3.10 | Tela `/atendimento` = fila de aprovação (espera, expirou, recusado); **alinhar permissão** (nav exige `whatsapp.enviar`, API exige `mcp.executar`) | RF-A-05 | 3.4 | aprovar pela tela executa e fecha o evento; usuário com a permissão da nav não recebe 403 | `apps/web/src/app/atendimento`, `nav.ts` ou `approvals.controller.ts` | M |

**Saída:** nenhum caminho de código alcança conector sem gateway (teste prova); toda execução tem evento.

### Fase 3 · O MAPA — *o contexto vira produto* (RF-M)

Responde à dor mais repetida no grupo ("como mandar contexto pra IA direito") e ao "graph ao vivo" da isca. Já existe: queda para busca textual (`obsidian.service.ts:184-212`), `Session.semProcedencia`.

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 4.1 | Decisão de desenho (N-5): MEMÓRIA versiona por **evento de mudança com projeção** (reaproveita `EventLog`) — permite RF-M-08 depois | RF-M-01 | 3.5 | `docs/adr/ADR-011-memoria.md` | `docs/adr/` | P |
| 4.2 | Módulo `memory/`: notas de contexto por tenant (regras da casa, dicionário, decisões) com versão, procedência e origem (Obsidian, upload, resposta promovida); `KnowledgeNote` migra sem perder embeddings | RF-M-01, RF-M-06 | 4.1, 1.5 | CRUD + histórico; contagem de embeddings antes = depois | `memory/`, migration | G |
| 4.3 | "Sem fonte é defeito": `llm-step`/`runtime` reprovam resposta sem procedência; `semProcedencia` vira sinal | RF-M-02, RNF-03 | 4.2 | teste vermelho quando a resposta não cita fonte | `agents/context-builder`, testes | P |
| 4.4 | `/contexto` vira o mapa navegável (notas, decisões, agentes, conexões) — tela principal | RF-M-04, RF-B-01 | 4.2 | clicar num nó abre o registro real; tenant vazio mostra o caminho de carga | `apps/web/src/app/contexto` | G |
| 4.5 | Carregamento guiado por assistente — versão interna primeiro: os sócios carregam o contexto da ROOT sem o Pedro | RF-M-05 | 4.3 | protocolo registrado: 10 perguntas com fonte, ≥ 9 certas, feito por Lucas; a 10ª vira regra | `agents/` (agente carregador), `/contexto` | G |
| 4.6 | Gerador de documentação: estado do tenant → markdown (`CLAUDE.md`/vault) com marcador de geração; usa o espelho Drive/local que a pauta já tem | RF-M-07 | 4.2 | arquivo editado à mão nunca é sobrescrito (teste) | `memory/exportar.ts` | M |

**Saída:** operador que nunca viu o sistema carrega o próprio contexto e recebe respostas com fonte.

### Fase 4 · A TRIPULAÇÃO — *o sistema trabalha* (RF-N, RF-C, RF-X)

Já existe: `Agent` (com `cron`, `tz`, `ativo`, `proximaExecucaoEm`, `execucoes`, `falhas`, `minutosPorExecucao`, `baselinePorId`, `rebaixadoAte`), `Sop` + `agents/sop.ts` (escalação constante), `Session`, runtime, `ChannelIdentity`, canal terminal, cron próprio (`pauta/cron.ts`, `pauta/scheduler.service.ts`). Falta:

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 5.1 | Rotinas por tenant **generalizando o cron próprio** (constraint de stack) sobre os campos que `Agent` já tem; estado explícito (rodando/aprendendo/planejada); histórico; a rotina da pauta migra. Fila com Redis/BullMQ **só se N-6 for decidida por humano** | RF-N-04 | 1.6 | `/rotinas` lista estado e histórico; `pauta/cron.ts` aposentado; `PAUTA_CRON=off` sem efeito colateral | `routines/` novo, `pauta/` | M |
| 5.2 | SOP com Zod dos 7 campos + tela `/agentes` editando; `/organograma` humanos + agentes por pilar | RF-N-01, RF-N-02, RF-N-06 | — | SOP sem os 7 campos é recusada (teste); escalação não editável (já) | `agents/sop.ts`, telas | M |
| 5.3 | **COFRE** primeiro: segredo por tenant e conector, chave fora do código, revogação imediata, **rotação com re-cifragem** (hoje trocar `ENCRYPTION_KEY` apaga tudo); o modelo nunca recebe credencial | RF-C-01..04 | 1.6 | teste: rotacionar mantém tokens legíveis; context-builder nunca inclui segredo (teste) | `cofre/` novo, `bio/credenciais`, `google/` | G |
| 5.4 | Contrato único de conector (autorizar, sincronizar, saúde, revogar) **sobre o COFRE**; `google`, `meta`, `obsidian`, `clickup`, `evolution` implementam; estado honesto em `/conexoes` | RF-X-01, RF-X-02, RF-X-06 | 5.3, 3.3 | conector fora do ar aparece vermelho e degrada só o que depende dele (teste) | `integrations/conector.ts`, cada conector | G |
| 5.5 | Aprovação por WhatsApp (Evolution, instância da ROOT) presa ao conteúdo exato e à `ChannelIdentity` | RF-A-06 | 3.10, 5.4 | aprovar no grupo executa a mesma ação da tela; identidade não cadastrada é ignorada (teste) | `gateway/canais/whatsapp.ts` | M |
| 5.6 | **Ligar** o rebaixamento: `impedimento()` (`agent-runtime.service.ts:339-349`) passa a ler `rebaixadoAte` (a escrita já existe em :378-381); horas devolvidas por rotina contra `baselinePorId` | RF-N-07, RF-N-05 | 5.1 | teste: agente rebaixado não executa R2+ por 24h; `/rotinas` mostra horas/semana | `agents/agent-runtime.service.ts`, `/rotinas` | P |
| 5.7 | Os 2–3 agentes do degrau 1 (**D-A pendente**; candidatos com ativo pronto: Pauta/roteiro, Conteúdo/carrossel, Relatório diário) em rotina no tenant ROOT | RF-N | 5.1–5.4 | 7 dias medidos em `EventLog`: execuções sem intervenção, zero `erro` em cascata ao derrubar um conector (teste de caos manual registrado) | `agents/roster/` | G |
| 5.8 | ~~`apps/telegram` (chama LLM/MCP fora da porta): migrar para canal do gateway ou desligar (**N-8**)~~ **FEITO em 11/09/2026 — APOSENTADO.** O bot já estava morto nesta branch: o laço de ação dele propunha e confirmava com a própria conta de máquina, e a fila de aprovação fechou os dois lados (a rota exige permissão que aquela conta não tem; o serviço recusa conta de máquina e recusa o proponente). Migrar seria reescrever do zero. Saiu do workspace e do compose; a catraca de arquitetura ganhou uma quinta frente que varre o monorepo inteiro. Perde-se o resumo diário agendado, que cabe nas rotinas da 5.1 | RF-G-01 | 3.2 | ✅ o app saiu do compose e do workspace, sem referência quebrada | `apps/telegram/` (removido), `docker-compose.yml`, `test/arquitetura.test.ts` | P |

### Fase 5 · A PORTA DE ENTRADA — *o cliente entra sozinho* (RF-O, RF-B)

| # | Entrega | RF | Depende | Pronto quando | Muda no repo | Tam. |
|---|---|---|---|---|---|---|
| 6.1 | Onboarding autônomo: cadastro → provisionamento (1.7) → conectar fontes (OAuth) → carga guiada (4.5) → primeira resposta com fonte; roteiro do Lucas como conteúdo | RF-O-01, RF-O-02 | 4.5, 5.4 | pessoa que a ROOT nunca viu chega à primeira resposta em < 1h sem falar com ninguém (teste com um aluno da imersão, cronometrado) | `onboarding/`, `/entrar` | G |
| 6.2 | Assinatura e cobrança (**D-C**: Asaas já integrado no `finance`) com suspensão sem apagar dado; credencial por tenant no COFRE | RF-O-03 | 6.1, 5.3 | inadimplente vê suspensão; dado intacto (teste) | `billing/` | M |
| 6.3 | Console da plataforma: saúde, uso e custo por tenant, **sem dado de tenant**; acesso de suporte autorizado, com prazo e registrado | RF-B-02 | 3.6 | operador da plataforma não abre registro de tenant (teste) | `/console-plataforma` | M |
| 6.4 | Painel de custo de IA por tenant/agente/dia com alerta (pílula "custo hoje · teto" da casca) | RF-B-03 | 3.6 | número bate com `usage.cost` somado | `/painel` | P |
| 6.5 | Landing + isca: graph ao vivo do tenant ROOT (subconjunto público), diagnóstico, repositório aberto (**O-5**) | meta (degrau 0) | 4.4 | `os.operacaoroot.com` mostra o mapa real | `apps/web/public/root-os.html` → página real | M |

### Transversal · O que os clientes pedem e onde entra

| Pedido (fonte) | Onde entra |
|---|---|
| "View de vendas" / relatório vivo de leads do WhatsApp (ProMedical, Soberana — 21 e 28/08) | Painéis por cliente = bloco "Os painéis" da casca. Módulo habilitável (1.6) com fonte por conector de carga (5.4); a carga do Protheus da ProMedical é o primeiro caso. Depois da Fase 2; até lá, kit `~/dev/promedical-os` |
| Homologação × produção para equipe de cliente (Cartório, 09/09) | Tenant de homologação = 1.7 + 1.6 + COFRE (5.3); sem acesso à produção "nem via MCP" = ADR-005 |
| Contexto organizado dentro do OS, `CLAUDE.md` (Pedro, 21/08) | Fase 3; 4.6 gera o `CLAUDE.md` |
| Segurança como objeção nº 1; prompt de auditoria em 5 categorias (28/08) | 0.3a (mínimo) + 3.8 (completo); o prompt vira `docs/AUDITORIA-SEGURANCA.md` e roda a cada release |
| Zero manutenção (20/08) | 5.4 estado honesto, 5.1 rotinas com estado, 5.6 rebaixamento |
| Onboarding em turma, forms pré-entrega (Lucas, 31/08) | 6.1 |
| Módulos internos não vazarem para cliente | 1.6 |

### Infra (paralelo, não bloqueia fatias de código)

| # | Entrega | Pronto quando |
|---|---|---|
| I.1 | **Decidir destino do `marketing-os`** (N-2). Recomendação: VPS da Root (KVM 8) — o produto da ROOT não pode cair porque o `vexa` da Full estourou CPU; `deploy/up.sh --vps` + easyPanel já são o padrão. Inclui instância Evolution da ROOT e domínios `os/bio.operacaoroot.com` | decisão em `docs/adr/`; se sim: domínios respondendo da VPS nova; `docs/DEPLOY.md` |
| I.2 | Backup automático do Postgres do mktos (hoje só dump manual em `/root/backups/mktos/`) | dump diário + restore testado uma vez |
| I.3 | Google OAuth (N-3): tela de consentimento com usuários de teste ou verificação — dono Rodrigo, prazo a combinar | `/google` conecta; espelho Drive da pauta funciona |
| I.4 | Excluir `root_bio`/`root_bio-db` no easyPanel (pendência de `DEPLOY_BIO.md`) e o `aportes.service` em crash loop | menos carga na VPS |

## 5. Ordem de ataque e paralelismo

```
Fatia 0: 0.0 → 0.1 → 0.2 → 0.3a → 0.3b → 0.4 ; 0.5/0.6 na mesma semana (reunião)
   │
   ├─ Fase 0: 1.1 e 1.2 em paralelo → 1.3 → 1.4 → 1.5 ; 1.6 → 1.7 a partir de 1.2
   ├─ Fase 1: 2.1 e 2.2 desde já (paralelo à Fase 0) ; 2.3 após 2.1
   ├─ Fase 2: 3.1 e 3.2 logo após 0.3b ; 3.4 após 1.2 ; 3.3 após 3.2+1.2 ; 3.5 após 1.3 ; 3.6/3.7 após 1.6 ; 3.8 → 3.9 → 3.10
   ├─ Infra I.1–I.4 em paralelo a tudo (Lucas/Rodrigo com o Pedro)
   ├─ Fase 3 após 3.5 e 1.5
   ├─ Fase 4: 5.2 e 5.8 cedo ; 5.3 (COFRE) → 5.4 → 5.5 ; 5.1 → 5.6 → 5.7
   └─ Fase 5 após 4.5 e 5.4
```

Por que esta ordem:
1. Fatia 0 antes de tudo: trabalho de agosto em risco físico, produção 5 semanas atrás, porta executando R3 em observar, e o Syncthing levando `.env` e `.git`.
2. Fase 0 antes de qualquer feature (regra do handoff): o que se constrói antes herda vazamento.
3. Fase 2 começa cedo em observar porque a calibração precisa de semanas de dado real.
4. COFRE antes do contrato de conector: construir "autorizar/revogar" sobre `ENCRYPTION_KEY` global é reescrever depois.
5. Fase 3 antes da 4 porque agente sem contexto versionado responde sem fonte e o graph é a prova de venda.
6. Fase 5 por último: onboarding autônomo pressupõe tudo acima sem gente.

Pode correr junto sem conflito: 1.6/1.7 com 1.3/1.4; 2.x com Fase 0; 3.1/3.2 com Fase 0; 5.2/5.8 com Fase 2; infra com qualquer fase; docs com tudo.

## 6. Plano de migração (produção viva, tenant ROOT)

- **Código → VPS:** enquanto 0.0 não fecha, nenhum checkout de branch no Mac (o Syncthing leva junto). Depois: `git pull`/rsync explícito no deploy.
- **RLS:** role + `SET LOCAL` (1.3) entram **sem** FORCE → produção igual. Rotas públicas (1.4). FORCE tabela a tabela (1.5) com `down` pronto; rollback = desligar FORCE. Migração/seed com role dona separada.
- **`orgId` nos filhos (1.1):** nullable → backfill pelo pai → NOT NULL em migration seguinte.
- **`AuditLog` → `EventLog`:** paralelo desde 3.5; aposentar só com `/auditoria` lendo do `EventLog` e uma semana de paridade.
- **Gateway:** 0.3a muda o comportamento de `observar` (R3+ retém) antes de ir ao ar; `impor` (3.9) é variável de ambiente lida no construtor → rollback com `up -d --no-build api`. Escritas migram uma por vez (3.3).
- **Cron da pauta → rotinas (5.1):** o novo nasce ao lado; a pauta é a primeira; `PAUTA_CRON=off` desliga o antigo.
- **Migrations:** `migrate deploy` roda no `command` do container — migration que falha derruba a API. Toda migration passa antes por `prisma migrate deploy` num Postgres descartável (procedimento já registrado em memória) e pelo job de CI.
- **Deploy:** `docker compose build api` + smoke na imagem + `up -d --no-build api web`; imagem anterior marcada `rollback`.

## 7. Plano de testes

Suítes que reprovam merge (CI desde 0.2):
1. **Isolamento entre tenants** — `tenant-isolation.test.ts` em job próprio com `TENANT_DATABASE_URL` (ganha os 13 modelos, rotas públicas, MCP tools).
2. **Arquitetura do gateway** — `arquitetura.test.ts` (3.2), allowlist explícita.
3. **Catálogo × classificador** — `packages/policy/test/politica.test.ts` (existe) com `DESFAZER_PENDURADO` vazio (2.2).
Complementares: `porta.test` (roteiro da demo, 16), `runtime.test` (9), `llm-step` (custo e procedência), `validacao`, `env`, adversariais (3.8), smoke na imagem (`pnpm --filter @mktos/api smoke`), web `nav.test`. Regra da branch: nada com injeção do Nest roda sob tsx/vitest — teste de boot é o smoke compilado. `porta`/`runtime` só contam com `TEST_DATABASE_URL` na CI.

## 8. Riscos de execução (além dos do PRD)

| Risco | Mitigação |
|---|---|
| Branch morrer no disco antes do merge | 0.1 hoje |
| Syncthing copiar `.env` de produção para o Mac e checkout no Mac alterar a VPS | 0.0 antes de qualquer checkout |
| Deploy da branch expor escrita R3 sem aprovação (observar executa) | 0.3a antes de 0.3b |
| Duas bases do ROOT OS divergindo (Pedro × Rodrigo); migrations do outro repo colidindo por timestamp | 0.5 na primeira semana; nenhuma migration importada sem renumerar |
| Ligar FORCE RLS e derrubar produção (queries sem `SET LOCAL`, `$queryRawUnsafe`) | ordem 1.3→1.4→1.5 rígida; 1.3 tratado como G |
| `impor` travar a rotina diária | 3.1 com duas semanas de dado; 3.9 só após 3.1–3.8 |
| Só o Pedro sabe deploy e código | 0.4 + `docs/DEPLOY.md`; Lucas assume infra (I.1); Rodrigo entra pelo backlog convergido (0.5) |
| VPS FullBPO saturar de novo | I.1 na primeira semana |
| Custo de IA (conta compartilhada, limites) | 3.6 antes de rotina com agente; OpenRouter com custo medido |
| Escopo crescer com pedido de cliente (view de vendas, painéis) | módulo habilitável depois da Fase 2; até lá, kits fora do OS (D-3) |
| Fases 3 e 4 grandes para uma pessoa | decisão de desenho (4.1, N-6) fechada antes de codar; fatias G em PRs por entrega |
| Migration que falha derruba a API (`migrate deploy` no `command`) | banco descartável + CI antes de qualquer deploy |

## 9. Decisões que precisam de gente

Do PRD (§12) e da nota de ofertas: **D-A** agentes do degrau 1 (trava 5.7) · **D-B** gestor de tarefas (ClickUp já pronto — confirmar) · **D-C** cobrança (Asaas?) · **D-D** retenção do rastro — **o compose já fixa 1825 dias; confirmar como padrão por tenant** · **D-E** núcleo aberto (adiado) · **D-F** quem entrega além do Pedro · **O-1..O-6**.

Novas:
- **N-1** Base única: `marketing-os` ou `operacaoroot/root-os`? Recomendação: esta; importar backlog. (0.5)
- **N-2** `marketing-os` migra para a VPS da Root? Recomendação: sim. (I.1)
- **N-3** Google OAuth: dono e prazo. (I.3)
- **N-4** `BioVisitor` — recomendação: **global**, declarado na lista versionada (é o desenho do teste). (1.1)
- **N-5** MEMÓRIA por evento (recomendado) ou documento com histórico. (4.1)
- **N-6** Rotinas: generalizar o cron próprio (recomendado, constraint de stack) ou introduzir fila Redis/BullMQ (dependência nova = decisão humana). (5.1)
- **N-7** ProMedical entra no OS quando? Proposta: primeiro tenant cliente após a Fase 2, carga do Protheus como primeiro conector de dados.
- ~~**N-8** `apps/telegram`: migrar para canal do gateway ou desligar. (5.8)~~ **DECIDIDO: aposentado** (11/09/2026). Ficam duas decisões menores no lugar dele: o conector `telegram` do catálogo passa a anunciar "configurado" para um transporte que não existe mais (marcar como sem transporte, ou tirar a linha), e a conta de máquina `ia-acao@` ficou sem cliente nenhum com seis permissões de escrita (apagar, ou fazer a semente criá-la sem senha utilizável).
- **N-9** Como o código chega na VPS depois de tirar `.git` do Syncthing: `git pull` ou rsync no `deploy/up.sh`. (0.0)

