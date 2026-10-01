# ClickUp dentro do mkt-os — módulo **Trabalho** (coordenadas)

> Pedido (31/07/2026): *"entenda cada detalhe de uso do nosso ClickUp — campo
> personalizado, marcações, etiquetas, comentários, ids, cada campo editável —
> e construa algo igual em termos de usabilidade dentro do marketing-os."*
> Construído a partir da **fotografia** do espaço `root` (workspace FullBPO):
> estrutura levantada em 07/07/2026 via API + retrato do sync de **25/07/2026
> 15:00** (último bom antes do token da API ser revogado).

## Onde está cada coisa (mapa rápido)

| Ponto do pedido | Modelo (Prisma) | API (rotas) | Tela | MCP |
|---|---|---|---|---|
| Hierarquia pastas → listas | `WorkFolder`, `WorkList` | `GET /trabalho/estrutura` · `POST/PATCH/DELETE /trabalho/pastas[/:id]` · `/trabalho/listas[/:id]` | `/trabalho` (árvore à esquerda, "+ nova lista") | `trabalho_estrutura` |
| Statuses por lista (pipeline, cor, tipo) | `WorkStatus` (`open/custom/closed` + cor hex) | `POST /trabalho/listas/:id/statuses` · `PATCH/DELETE /trabalho/statuses/:id` | board (colunas coloridas) + modal ⚙ "Configurar lista" | idem |
| **Campos personalizados** | `WorkField` (tipos `drop_down/texto/numero/data/checkbox/url/moeda`, este com o valor canônico `BRL 1500.00`; `listId` nulo = espaço todo) + `WorkFieldOption` (opções com cor) + `WorkFieldValue` (valor por tarefa) | `POST /trabalho/campos` · `PATCH/DELETE /trabalho/campos/:id` · `POST /trabalho/campos/:id/opcoes` · `PATCH/DELETE /trabalho/opcoes/:id` · valores via `PATCH /trabalho/tarefas/:id {campos}` | painel da tarefa (seção "Campos personalizados") + modal ⚙ (CRUD de campos e opções) + filtros por opção no topo | `trabalho_tarefas` (traz valores) |
| **Etiquetas** (tags do espaço) | `WorkTag` (nome + cor, por org) | `GET`(na estrutura) · `POST /trabalho/tags` · `PATCH/DELETE /trabalho/tags/:id` · anexar via `PATCH tarefa {tagIds}` | painel da tarefa (chips "+ etiqueta" cria e anexa na hora) | idem |
| **Comentários** | `WorkComment` (autor + texto + data) | `POST /trabalho/tarefas/:id/comentarios` · thread no `GET /trabalho/tarefas/:id` | painel da tarefa (thread, mais novo primeiro — como no ClickUp) | `trabalho_tarefa` |
| **Ids** | `id` interno (uuid) + `externalId` = **id da task/lista no ClickUp** (preservado na importação; `@@unique(orgId, externalId)`) | em toda resposta | rodapé do painel ("id interno / id ClickUp / abrir no ClickUp") | idem |
| Tarefas (CRUD, prioridade, responsável, prazos, subtarefas, arquivar) | `WorkTask` (prioridade `urgente/alta/normal/baixa`, `parentId` p/ subtarefa, `archived`) | `GET/POST /trabalho/tarefas` · `GET/PATCH/DELETE /trabalho/tarefas/:id` (DELETE = arquivar) | board (quick-add por coluna) + tabela + painel | `trabalho_tarefas`, `trabalho_tarefa` |
| Atividade (quem mexeu) | reusa `AuditLog` (`entityType='work_task'`) | embutido no detalhe | painel, seção "Atividade" | `trabalho_tarefa` |

## Arquivos (coordenadas exatas)

- **Modelo**: `apps/api/prisma/schema.prisma` → seção `---------- Trabalho`
  (9 modelos `Work*` + 3 enums). Migração: `apps/api/prisma/migrations/20260801012757_trabalho_clickup_like/`.
- **Seed da fotografia**: `apps/api/prisma/seed-trabalho.ts` (rodar: `pnpm --filter @mktos/api db:seed:trabalho`).
  Idempotente; importa os temas e tarefas do retrato preservando o id ClickUp.
- **API**: `apps/api/src/work/` (`work.controller.ts` = rotas `/api/trabalho/*`,
  `work.service.ts` = regras + auditoria, `work.module.ts`; registrado em `app.module.ts`).
- **Contratos** (Zod + DTOs): `packages/shared/src/schemas.ts` → seção `---------- Trabalho`.
- **Tela**: `apps/web/src/app/trabalho/page.tsx` (árvore + board + tabela +
  painel da tarefa + modal de configuração). Item no menu: `packages/shared/src/nav.ts` (key `trabalho`).
- **MCP** (read-only, p/ a IA): `packages/mcp/src/server.ts` → tools
  `trabalho_estrutura`, `trabalho_tarefas`, `trabalho_tarefa` (35 tools no total).
- **Permissões**: leitura `tarefas.ver`, escrita `tarefas.editar` (RBAC existente).
  Escritas são internas → **fora** do fluxo de approvals (que é para efeito externo);
  tudo cai no `AuditService`.

## O que veio da fotografia (dados REAIS semeados)

- **5 pastas / 11 listas** (07/07): Projeto Mkt (Gestão de Temas `901327640001`,
  Copy, Design & Gravação, Calendário de conteúdo, Análise, Tarefas Gerais),
  Adm (Atribuições, Demandas administrativas), Comercial (List),
  Contratos (Gestão de contratos), Projeto 2 (List).
- **Pipeline da Gestão de Temas** (união 07/07 + 25/07): `insights` (open) →
  `validar ideia` → `escrever roteiro` → `complete` (closed). Em 25/07,
  **106/107 temas estavam em `insights`** — o time reformulou o funil.
- **4 campos personalizados** (dropdown) com as opções reais:
  **Formato** {Reel 26×, Carrossel 6×} · **Eixo** {Mercado, Lifestyle, Cultura,
  Sua empresa, Case} · **Tipo** {Estudo de caso, Série, Bastidor, Esquetes,
  Entretenimento, Trend, Polêmico, React, Depoimento, Vlog} · **Fonte**
  {Referência, Própria}. Obs. de uso: 75/107 temas estavam com campos vazios.
- **107 temas** importados na Gestão de Temas (com valores dos campos) e
  **73 tarefas** na lista *"Importadas do ClickUp (realocar)"* — o retrato não
  dizia a lista de origem delas; realocar = mudar "Lista" no painel da tarefa.
- **Pessoas** vistas: Lucas Fernandes, Pedro Magnago, Rodrigo Saggioro.
  **Etiquetas**: nenhuma em uso no ClickUp até 25/07 (a feature existe aqui).

## Lacunas da fotografia (fechar quando houver token novo)

1. Statuses REAIS das outras 10 listas (semeadas com pipeline padrão A fazer /
   Em andamento / Concluída).
2. Definições oficiais dos campos no ClickUp (ids/cores das opções lá) e
   possíveis campos fora da Gestão de Temas.
3. Comentários históricos das tasks, checklists, anexos, relações e views.
4. A lista de origem das 73 tarefas "realocar".

**Coletor pronto**: `tools/clickup-inventario.py` (token via env/`.env`/
`~/.config/root/clickup.env`) puxa tudo isso da API v2. Depois, reconciliação
usa `WorkTask.externalId`/`WorkList.externalId`.

## Decisões de desenho

- **ClickUp deixou de ser obrigatório**: o módulo é fonte própria (`trabalho-interno`).
  O sync antigo (`clickup.service.ts` → `ContentItem`/`Task`) continua como
  ingestão; unificá-lo apontando para `WorkTask` é o próximo passo natural.
- DELETE de tarefa **arquiva** (auditoria preservada); pasta/lista só somem vazias;
  status só some sem tarefas; opção/campo somem em cascata com seus valores.
- Toda escrita audita (`work.*` no `AuditLog`) — a seção "Atividade" do painel lê daí.
