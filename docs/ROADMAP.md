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

## Módulo Financeiro (FinOps) ✅ (de pé)
Área **exclusiva do financeiro**, isolada no mesmo stack. Base para incorporar o projeto **FinOps5.0**.
- **Modelo:** `FinanceAccount` (contas: corrente/poupança/caixa/cartão/investimento, saldo derivado), `FinanceCategory` (plano de contas receita/despesa), `FinanceTransaction` (lançamentos: previsto→realizado→conciliado; `amount` positivo + `type`), `BankConnection` (Open Finance/OFX). Migration `add_finance`.
- **API (`/api/finance/*`):** resumo (saldo total, resultado do mês, a pagar/receber inclusive vencidos), fluxo de caixa projetado dia a dia, CRUD de contas/categorias/lançamentos, tudo `orgId`-scoped + auditoria + envelope `source`.
- **Permissões:** `financeiro.ver | editar | conciliar` + perfil dedicado **Financeiro**. `ia_servico` ganha leitura.
- **Integração bancária:**
  - ✅ **OFX** — importação de extrato (upload `.ofx`), dedup por FITID. **Funciona sem nenhuma credencial.**
  - ✅ **Open Finance (Pluggy)** — conector pronto (auth clientId/secret → apiKey, connect-token p/ o widget, sync de contas + extrato, health no hub). Liga com `PLUGGY_CLIENT_ID/SECRET` em `~/.config/root/pluggy.env`.
- **Web:** `/financeiro` com abas Visão geral · Lançamentos · Contas · Bancos (gating por permissão).
- **MCP:** `get_finance_summary`, `list_finance_accounts`, `list_finance_transactions`, `get_cashflow` (read-only).
- ✅ **Enxerto FinOps5.0 (Vite/React/Supabase → nosso stack), etapas entregues:**
  - **Plano de Contas + DRE ("Motor Vortex")** — plano hierárquico FullBPO (105 contas) + linhas de DRE com fórmula; motor `calcular_dre` portado.
  - **AP/AR completo** — fornecedores/clientes, contratos recorrentes, rateio (dep/projeto, refletido no DRE), aprovação por limite.
  - **Conciliação bancária por score** — match extrato↔títulos (valor/data/tipo), auto ≥0.85 / sugestão, sem duplicar saldo.
  - **Pluggy automático** — sync agendado (Open Finance) + importação OFX.
  - **Dashboards/KPIs** — margens do DRE, inadimplência, índice de acurácia + fluxo de caixa. Ver `docs/FINANCE.md`.
  - ⏳ **Falta (opcional):** multi-empresa (BPO multi-cliente) e conector Omie. Refs em `docs/finops-ref/`.

## Fase 4 — Conteúdo e Instagram
Instagram Graph API · módulo Conteúdo · métricas · análise de performance · sugestão de pauta.
- ✅ **Metas (LucasCreator)** — painel `/metas` do sistema de métricas: marcos (1000 posts/20M views/1000 vendas), 11 taxas do funil com farol (janela 4 sem, piso/meta), fases (aquecimento→baseline→regime), escada de views por faixa, projeções dia 365 (views×[50,110]/M). Entrada semanal + "Puxar do Instagram" (alinha ao Meta) + tool `get_goals_panel` no MCP. Ver memória `marketing-os-metas`.

## Fase 5 — Gmail, Drive, Docs, Agenda e Obsidian
Gmail (classificação + resumo) · Drive (busca/anexos) · Docs · Agenda · Obsidian (base de conhecimento + embeddings) · busca global completa.
- ✅ **Obsidian** conectado de verdade: vault do root montada read-only, embeddings (pgvector/OpenAI), **busca semântica** + tools no MCP (a IA responde citando as notas).
- ✅ **Google — fundação + LEITURA no ar** (`c9d9821`): OAuth próprio do root (Gmail/Agenda/Docs/Drive num consentimento só, refresh automático), reads dos 4 serviços + 5 tools no MCP, página `/google`. Escopos já pedem read+write.
- ⏳ **Google — conectar (pendente):** a autorização OAuth foi **BLOQUEADA pelo Google** na 1ª tentativa (app em modo Teste / escopos sensíveis Gmail+Drive). **Resolver** (Rodrigo, quando voltar): tela de consentimento com a conta do root em *Usuários de teste* (e/ou publicar/verificar o app), confirmar redirect `http://localhost:4000/api/google/callback`, então **Conectar** em `/google`. Depois: verificar leitura real + habilitar **escrita com aprovação** (enviar email / criar evento / editar doc).
- ⏳ **Google Maps** — adiado (API key, uso a definir).

## Fase 6 — Relatórios e WhatsApp completos
Relatório diário/semanal/mensal · envio por WhatsApp (write_sensitive c/ confirmação) · alertas críticos em tempo real · **comandos** por WhatsApp autenticados.

## Fase 7 — MCP / Hub completo p/ IA
Todas as tools · schemas · logs · permissões · fluxo de aprovação · integração testada com Claude.
- ✅ **MCP standalone p/ VPS** (repo próprio `operacaoroot/marketing-os-mcp`, histórico preservado): transporte **HTTP streamable + Bearer token** (stdio mantido), Docker + Caddy/HTTPS, `deploy/prod.sh`. Hoje são **32 tools read-only**. Falta: lançar na VPS (junto do painel) e depois tools `write_*` c/ aprovação.

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
