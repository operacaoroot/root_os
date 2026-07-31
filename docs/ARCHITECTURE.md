# Marketing OS — Arquitetura

> **Produto do projeto `root`** (studio de IA/SaaS). **Não** pertence ao escritório Cardozo & Saggioro.
> **Nome do produto:** configurável via `APP_NAME` (padrão: "Marketing OS").
> **Status:** **as-built** — sistema no ar (Fases 1–5 entregues; ver `ROADMAP.md`). Este doc mistura princípios (ainda válidos) com o desenho atual.
> **Data:** 2026-07-21 (revisão as-built) · proposta original: 2026-07-06

> **Diagramas atualizados (archify, abrem no navegador, exportam PNG/SVG):**
> [`diagrams/system.architecture.html`](diagrams/system.architecture.html) · [`diagrams/ai-mcp.sequence.html`](diagrams/ai-mcp.sequence.html) · [`diagrams/domains.architecture.html`](diagrams/domains.architecture.html)
>
> **O que mudou do desenho original para o código real:**
> | Proposta 2026-07 | Implementação atual |
> |---|---|
> | WhatsApp como canal | **Telegram** (bot `apps/telegram`); WhatsApp adiado |
> | `packages/connectors/*` | conectores **inline** nos módulos (`finance`, `google`, `meta`, `obsidian`, `integrations`) |
> | Redis + **BullMQ** workers | **sem BullMQ**; sync inline nos services + cron in-process do bot |
> | Auth.js (sessão) | **JWT** próprio + RBAC em tabela |
> | Claude como padrão | **OpenAI gpt-4o** (bot chama direto; API tem `LlmProvider`, `AnthropicProvider` a implementar) |
> | MCP = Hub p/ qualquer IA | MCP **stdio**, subprocesso do bot (transporte HTTP/SSE pendente — Fase 7) |

---

## 0. Regra de isolamento (inegociável — leia primeiro)

Este projeto é **completamente isolado** do escritório C&S. Ver `ISOLATION.md` para os detalhes operacionais. Em uma frase:

> **Docker próprio, MCP próprio, credenciais próprias, dados próprios. Zero contato com a infraestrutura, o MCP (`cardozo-saggioro`), os containers ou os dados do escritório. Nada é puxado de lá.**

Toda decisão de arquitetura abaixo respeita isso.

---

## 1. Princípios que guiam todas as decisões

1. **Isolamento total.** O Marketing OS roda no seu próprio stack Docker (rede, volumes, portas e segredos próprios). Não compartilha banco, fila, storage, rede nem MCP com o escritório. É um mundo à parte, do `root`.
2. **Um dado, uma verdade.** Toda ferramenta externa é *fonte*, nunca *dona*. Ingerimos, normalizamos e guardamos localmente no **nosso** Postgres. O painel e a IA leem do nosso banco, não da API de terceiros em tempo de request.
3. **Clicável = navegável = acionável.** Todo número leva a uma lista → detalhe → ação → histórico → relatório/IA. Isso é regra de UX *e* de modelo de dados (toda métrica tem uma query de drill-down que a origina).
4. **A IA nunca inventa.** Toda resposta da IA cita a fonte interna. Sem dado → "não há dado suficiente". Ferramentas MCP são a única forma da IA tocar dados.
5. **Ação sensível exige gente.** Enviar e-mail/WhatsApp, alterar campanha, exportar dado pessoal → sempre confirmação humana, enforced no MCP (não só na UI).
6. **Incremental e desligável.** Cada conector é um plugin isolado com health próprio. Um conector fora do ar degrada só o card dele.

---

## 2. Decisões de stack (e o porquê)

| Camada | Escolha | Alternativa considerada | Porquê |
|---|---|---|---|
| **Linguagem** | TypeScript ponta-a-ponta | Python (FastAPI) no backend | Uma linguagem, tipos compartilhados (`packages/shared`) entre front, back e conectores. Menos context-switch. |
| **Frontend** | Next.js 15 (App Router) + Tailwind + shadcn/ui + TanStack Query + Recharts | Vite SPA | SSR/streaming p/ dashboards, ecossistema shadcn p/ drawers/tabelas, tema escuro trivial. |
| **Backend** | NestJS (REST + webhooks) + BullMQ workers | Express cru; Fastify | Estrutura modular, DI, guards de permissão como decorators — casa com "permissões por ação". |
| **Banco principal** | PostgreSQL 16 + extensão **pgvector** (instância PRÓPRIA) | Postgres + Pinecone/Qdrant à parte | Um banco só até doer. pgvector cobre embeddings no MVP; migra p/ Qdrant só se escalar. |
| **Cache / filas / cron** | Redis + BullMQ (instância PRÓPRIA) | RabbitMQ; cron do SO | Cache, fila de sync e jobs agendados num componente só. |
| **ORM / migrations** | Prisma | Drizzle | Migrations maduras + schema declarativo. |
| **Storage de arquivos** | MinIO (S3 compat.) PRÓPRIO | Cloudflare R2 | Relatórios/PDFs sem sair do nosso stack (LGPD). Interface S3 → troca por R2 num env var. |
| **Auth** | Auth.js (sessão) + RBAC próprio + API keys p/ serviços | Keycloak | Time pequeno não precisa de Keycloak. RBAC em tabela + guards. |
| **IA** | Anthropic SDK (Claude) atrás de interface `LLMProvider` | OpenAI direto | Claude como padrão; interface permite OpenAI/Gemini/local sem reescrever. |
| **MCP** | `@modelcontextprotocol/sdk` (TS) — **servidor PRÓPRIO** | Servir tools só via REST | MCP exclusivo do Marketing OS. **Não** é, nem fala com, o MCP do escritório. |
| **WhatsApp** | Interface `WhatsappProvider` + conta/canal **PRÓPRIOS** | Amarrar na Meta Cloud API; reusar canal do escritório | Provider genérico, credenciais próprias. Nunca acoplar a fornecedor nem ao canal do escritório. |
| **Observabilidade** | pino (logs estruturados) + tabela `integration_health` + `/health` + Sentry (opcional) | ELK stack | Suficiente p/ operação de time pequeno. |
| **Monorepo** | pnpm workspaces + Turborepo | Nx | Simples, rápido, cache de build. |
| **Empacotamento** | docker-compose **próprio** (`COMPOSE_PROJECT_NAME=marketing-os`, rede `marketing-os-net`, volumes e portas dedicados) | Rodar junto do stack do escritório | Isolamento físico. Ver `ISOLATION.md`. |

### Diagrama de alto nível

> ⚠️ O diagrama textual abaixo é o **histórico** (proposta 2026-07): mostra WhatsApp/BullMQ que **não** são o desenho atual. O as-built é [`diagrams/system.architecture.html`](diagrams/system.architecture.html) (ver a tabela de divergências no topo). A regra de isolamento (sem contato com o MCP/infra do escritório C&S) permanece.

```
   ┌─────────────────────────  STACK ISOLADO  (marketing-os-net)  ────────────────────────┐
   │                                                                                        │
   Navegador (time)  ──────►│  apps/web  (Next.js)                                          │
   WhatsApp próprio         │  dashboard clicável, drawers, gráficos                        │
        │                   └───────────────┬────────────────────────────────────────────  │
        │                                   │ REST / SSE                                    │
        ▼                                   ▼                                               │
 ┌──────────────┐          ┌────────────────────────────────────────────┐                  │
 │ WhatsApp     │◄────────►│  apps/api  (NestJS)                         │                  │
 │ Provider     │  alertas │  routes · webhooks · auth/RBAC · audit      │                  │
 │ (conta       │  relat.  └────┬───────────────┬───────────────────────┘                  │
 │  própria)    │               │               │                                          │
 └──────────────┘          ┌────▼──────────┐ ┌──▼───────────┐                              │
                           │ Connectors     │ │ BullMQ jobs  │                              │
   Ferramentas externas ──►│ (plugins)      │ │ sync · cron  │                              │
   Zapier/Apify/ClickUp    │ auth·rate·log  │ └──────┬───────┘                              │
   Asana/Gmail/IG/Drive    └────────┬───────┘        │                                      │
   Obsidian/Pixel/Vendas            ▼                ▼                                      │
                           ┌────────────────────┐  ┌──────────────┐                        │
                           │ PostgreSQL+pgvector │  │ Redis        │  ┌──────────────┐      │
                           │ (PRÓPRIO)           │  │ (PRÓPRIO)    │  │ MinIO(PRÓPRIO)│     │
                           └─────────┬──────────┘  └──────────────┘  └──────────────┘      │
                                     │ (só via tools)                                       │
                           ┌─────────▼──────────────────────────────┐                      │
                           │  packages/mcp  (MCP Server PRÓPRIO)     │                      │
                           │  tools tipadas · permissões · audit     │                      │
                           └─────────┬──────────────────────────────┘                      │
                                     ▼                                                      │
   └───────────────────── Claude / OpenAI / Gemini / cliente MCP ──────────────────────────┘

   ✗ SEM conexão com o MCP `cardozo-saggioro`, banco, rede ou containers do escritório C&S.
```

---

## 3. Os 14 blocos arquiteturais → onde vivem

| # | Bloco | Local no repo |
|---|---|---|
| 1 | Frontend / Painel | `apps/web` |
| 2 | Backend principal | `apps/api` |
| 3 | Banco operacional (próprio) | Postgres + `data/migrations` (Prisma) |
| 4 | Camada de integrações | `packages/connectors/*` + `apps/api/src/connectors` |
| 5 | Camada de eventos | `apps/api/src/webhooks` + tabelas `pixel_events` / `lead_events` |
| 6 | Camada de métricas | `apps/api/src/services/metrics` + tabelas `*_metrics` |
| 7 | Camada de automações | conectores `zapier`/`apify` + `jobs` |
| 8 | Camada de IA | `apps/api/src/services/ai` + `packages/shared/prompts` |
| 9 | MCP Server próprio | `packages/mcp` |
| 10 | Alertas | `apps/api/src/services/alerts` |
| 11 | Relatórios | `apps/api/src/services/reports` |
| 12 | Permissões | `apps/api/src/permissions` (RBAC guards) |
| 13 | Auditoria | `apps/api/src/audit` + tabela `audit_logs` |
| 14 | Observabilidade | pino + `integration_health` + `/health` |

---

## 4. Fluxo de dados (pipeline canônico)

```
COLETA           NORMALIZAÇÃO          ARMAZENAMENTO        ANÁLISE          APRESENTAÇÃO      AÇÃO
─────            ────────────          ─────────────        ───────          ────────────      ────
API pull    ┐                     ┌─► raw_events        ┌─► KPIs         ┌─► dashboard    ┌─► criar tarefa
webhook     ├─► limpar/padronizar ├─► normalized (leads,├─► funis        ├─► relatórios   ├─► enviar alerta
pixel       │   datas · UTM ·      │   campaigns, ...)   ├─► comparativos ├─► WhatsApp     ├─► gerar relatório
import CSV  │   dedup lead ·       └─► *_metrics (agreg.)├─► scores       └─► IA (via MCP) └─► abrir investig.
sync cron   ┘   vincular campanha                        └─► alertas
```

**Regra de ouro:** guardamos o **raw** (auditoria/reprocessamento) *e* o **normalizado** (consumo). Métricas agregadas são materializadas por job, não calculadas a cada request pesado.

---

## 5. Ingestão de eventos (o coração do funil)

- **Endpoint:** `POST /api/events/track` (público, rate-limit + validação de `event_id` p/ dedup).
- **SDK:** `pixel.js` servido em `/pixel.js` (~3KB, sem dependências). Gera `anonymous_id`, captura UTMs, respeita consentimento (LGPD), envia `page_view` + eventos custom, evita duplicidade via `event_id`.
- **Do evento ao lead:** `form_submit`/`lead` → cria/atualiza `leads`, casa `anonymous_id` → `lead` (stitching de identidade), amarra UTMs e campanha.

Ver `INTEGRATIONS.md §Pixel` e `DATA_MODEL.md`.

---

## 6. Camada de IA

- **`LLMProvider`** — interface única (`complete`, `stream`, `tool_use`). Implementações: `AnthropicProvider` (padrão, Claude), `OpenAIProvider`, `LocalProvider`. Modelo/temperatura por prompt.
- **A IA só toca dados via MCP tools próprias.** Nunca faz SQL direto, nunca fala com o MCP do escritório. Permissão, log e "não inventar" de graça.
- **Prompts versionados** — `packages/shared/prompts/<nome>.<versão>.ts`. Toda chamada gera linha em `ai_runs` + `ai_tool_calls`.
- **Memória estruturada** — decisões, aprendizados, campanhas vencedoras/ruins, personas, ofertas, copys (tabelas + embeddings pgvector). Consultável/atualizável **só com autorização**.
- **Aprovação humana (enforced no backend)** — a IA **não** escreve pelo MCP (só-leitura). Ação sensível segue: (1) a IA chama `propose_*` (só registra a intenção); (2) o bot cria a aprovação em `POST /approvals` (status `pending`) e devolve um `approval_token`; (3) o humano confirma no Telegram → `POST /approvals/:id/confirm`; (4) a escrita real (`PATCH /leads|tasks|campaigns|content`) só passa carregando o header `x-approval-token` — o **`ApprovalGuard`** valida na API: confirmado, no prazo (TTL 10 min), **single-use** e casando o recurso + a mudança exata (hash canônico). Sem token válido → 403. Duas contas de serviço: `mcp@` (só-leitura) e `ia-acao@` (só `*.editar`). Todo o ciclo entra em `audit_logs` (`approval.propose|confirm|reject|consume`).
  - **Resíduo conhecido:** o `/confirm` hoje é chamado pela conta de ação (mediado pelo bot), não por uma identidade humana autenticada na API. Fecha bugs do laço de IA, escrita acidental/duplicada e replay; **não** blinda 100% contra roubo da credencial de ação. Fechar de vez exige mapear o usuário do Telegram → identidade da API (futuro).

---

## 7. Segurança e multi-tenant (resumo — detalhe em `SECURITY.md`)

- Toda tabela de domínio carrega `org_id` (single-tenant hoje, 1 org default; multi-cliente é só popular o campo depois — **sem migração dolorosa**).
- Tokens de integração **criptografados** (AES-GCM, chave em env/secret próprio), nunca no frontend, nunca no git.
- Refresh tokens (Google/Instagram) renovados por job; falha → `integration_health = degraded` + alerta.
- Todo acesso e toda ação da IA em `audit_logs`.

---

## 8. O que explicitamente **não** fazemos no MVP

- Não tocar em nada do escritório (infra, MCP, dados, containers). Ver `ISOLATION.md`.
- Não integrar as ferramentas todas de uma vez (ver `ROADMAP.md` — MVP são 6).
- Não construir DMs do Instagram (restrição de API + risco).
- Não deixar a IA executar ação sensível sem humano.
- Não guardar dado pessoal sem base legal (ver `SECURITY.md §LGPD`).
- Não amarrar em fornecedor único (WhatsApp, LLM, storage são interfaces).
