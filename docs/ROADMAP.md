# Marketing OS — Roadmap por Fases

> Regra: **MVP funcional antes de avançar.** Cada fase entrega valor operacional real.

## Fase 0 — Planejamento técnico ✅ (esta entrega)
Requisitos mapeados · **isolamento definido** (`ISOLATION.md`) · stack definida · modelo de dados · conectores · escopo MVP · documentação (`docs/`).

> Todo o roadmap roda no **stack Docker isolado** do projeto `root`, sem qualquer contato com o escritório C&S.

## Fase 1 — Base do sistema ✅ (entregue)
Monorepo pnpm+Turborepo · Postgres+Redis+MinIO isolados via docker-compose · schema Prisma + migration `init` + seed · **auth JWT + RBAC** (26 permissões, 6 perfis) · layout principal (sidebar por permissão, tema escuro, busca global stub) · **dashboard com cards clicáveis (dados reais)** · **leads com drill-down** (lista → ficha) · ingestão de pixel `/api/events/track` (dedup) · auditoria de login · `/api/health`.
**Entregue:** logo (`admin@marketing-os.local`), navego, vejo números reais e clico até o detalhe do lead.
**Verificado:** API testada via curl (login/dashboard/leads/RBAC/pixel), web build + smoke test OK, stack Docker isolado no ar.
**Próximo increment:** containerizar api/web (Dockerfiles rascunhados) e endpoints de funil/campanhas/tarefas.

## Fase 2 — Eventos, leads e operação (o coração do MVP) ✅ (entregue)
- Endpoint `POST /api/events/track` + `pixel.js` (SDK leve) + captura de UTM · painel `/pixels` + `/vendas` + demo.
- Funil básico · módulo Leads (lista, ficha, drill-down) · Campanhas (+dossiê) · conversões.
- Módulo Tarefas unificado (ClickUp/Asana — conector real na Fase 3) · alertas de atraso.
- Relatório diário gerado por **IA** (`/relatorios`, `LlmProvider` → **OpenAI gpt-4o temporário**; meta = Claude) + **MCP read-only (10 tools)**.
- **Mensageria/entrega + validação do MCP via Telegram** (bot `apps/telegram`): pergunta em linguagem natural → IA usa as tools do MCP → responde; `/resumo` + **resumo diário agendado (08:00 BRT)**. _WhatsApp adiado p/ o app consolidado._
- **Tudo containerizado** (imagem única do monorepo + `docker-compose` isolado; `deploy/up.sh`).
**Entrega:** o "Sistema Operacional de Marketing" mínimo já responde "o que aconteceu hoje?" — inclusive pelo Telegram.
**Deploy atual:** roda 24/7 em containers no **OrbStack do Mac**. ⏳ _Roadmap: mover para uma **máquina dedicada do `root`** (a montar), isolada — nada do escritório C&S. Enquanto isso, fica no Mac._

## Fase 3 — Automações
Zapier + Apify · card "Automações com falha" · retry seguro · diagnóstico por IA. _(Zapier/Apify SUSPENSOS por ora — usando Telegram.)_
- ✅ **ClickUp** conectado de verdade (API v2 token; sync das tarefas reais → módulo Tarefas). Falta: agendar o sync, e Asana.

## Fase 4 — Conteúdo e Instagram
Instagram Graph API · módulo Conteúdo · métricas · análise de performance · sugestão de pauta.

## Fase 5 — Gmail, Drive e Obsidian
Gmail (classificação + resumo) · Drive (busca/anexos) · Obsidian (base de conhecimento + embeddings) · busca global completa.

## Fase 6 — Relatórios e WhatsApp completos
Relatório diário/semanal/mensal · envio por WhatsApp (write_sensitive c/ confirmação) · alertas críticos em tempo real · **comandos** por WhatsApp autenticados.

## Fase 7 — MCP / Hub completo p/ IA
Todas as tools · schemas · logs · permissões · fluxo de aprovação · integração testada com Claude.

## Fase 8 — IA avançada
Recomendações · diagnósticos · priorização · memória estruturada (pgvector) · agentes por módulo · relatórios inteligentes.

## Fase 9 — Escalabilidade
Cache · filas dimensionadas · monitoramento · backups · testes · multi-cliente ativado (popular `org_id`).

## Infra & Deploy (transversal)
- **Hoje:** containers no OrbStack do **Mac** (24/7 enquanto o Mac estiver ligado). Subir: `deploy/up.sh`.
- **⏳ Próximo (roadmap):** **máquina dedicada do `root`** (a montar pelo Rodrigo), isolada — **nada do escritório C&S**. Mesmo `deploy/up.sh`; expor via Tailscale/funnel próprio. Enquanto a máquina não existe, fica no Mac.

---

## MVP PRIORITÁRIO (Fases 1–2) — o corte que entrega valor rápido
1. Login + layout + tema escuro
2. Dashboard principal (cards clicáveis)
3. Modelo de dados (Prisma + migrations)
4. Pixel/eventos da página de vendas
5. Leads (lista → ficha → ação)
6. ClickUp/Asana (tarefas unificadas)
7. Relatório diário
8. WhatsApp de alerta (saída)
9. IA para resumo diário (read-only)
10. MCP básico com tools read-only

**Depois:** Instagram, Gmail, Drive, Obsidian, automações avançadas, comandos WhatsApp.

## Como cada fase reduz risco
- Fase 1–2 valida a espinha (ingest→normaliza→painel→IA) com **poucos** conectores.
- Só ampliamos conectores quando a espinha está sólida — evita "12 integrações meia-boca".
