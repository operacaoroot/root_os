# FullBPO FinOps OS — Arquitetura do Sistema

## Visão Geral

O **FullBPO FinOps OS** é o Sistema Operacional Financeiro da PME.

**Objetivo:** Centralizar Comunicação + Execução + Controle + Governança em uma única plataforma — a **Single Source of Truth** do BPO Financeiro.

### Problema que resolve
| Antes (fragmentado) | Depois (FinOps OS) |
|---|---|
| WhatsApp → Comunicação | ✅ Inbox Omnichannel |
| ERP → Fiscal | ✅ Core Finance Engine |
| Planilhas → Controle | ✅ Dashboards e Relatórios |
| ClickUp → Tarefas | ✅ Operations Hub |
| Drive → Arquivos | ✅ DMS integrado |

---

## Diferencial Estratégico — Índice de Acuracidade

O sistema mede a **qualidade do BPO** através do Índice de Acuracidade:

```
Índice de Acuracidade = média ponderada de:
  - % Contas conciliadas
  - % Previsão vs Orçado  
  - % Bancos sem pendência
```

> Toda decisão arquitetural deve preservar essa métrica como ativo central.

**Faixas de referência:**
- 🟢 ≥ 90% — Excelente
- 🟡 70–89% — Atenção
- 🔴 < 70% — Crítico

---

## Arquitetura dos 5 Pilares

### 1️⃣ CLIENT EXPERIENCE (`/client`)
Portal do cliente final.
- Dashboard financeiro (saldos, índice de acuracidade, alertas)
- Aprovação de títulos
- Solicitações (tickets com SLA)
- Onboarding

**Acesso:** cliente

---

### 2️⃣ CORE FINANCE ENGINE (`/finance`)
Motor financeiro operado pelo BPO.
- Contas a Pagar (AP)
- Contas a Receber (AR)
- Contratos e Recorrência
- Compras
- Conciliação Bancária
- Plano de Contas
- Cadastro de Fornecedores e Clientes

**Acesso:** operador, supervisor, super_admin

---

### 3️⃣ OPERATIONS HUB (`/operations`)
Centro de comando da equipe FullBPO.
- Dashboard operacional com prioridades do dia
- Kanban de tarefas
- Rotinas cadenciadas (diária, semanal, mensal)
- Grid de status das empresas gerenciadas

**Acesso:** operador, supervisor, super_admin

---

### 4️⃣ INBOX OMNICHANNEL (`/inbox`)
Entrada unificada de documentos e demandas.
- Upload manual (drag-and-drop)
- Email
- WhatsApp
- DMS (Document Management System)
- Classificação automática por IA

**Acesso:** operador, supervisor, super_admin

---

### 5️⃣ GOVERNANÇA & ADMIN (`/admin`)
Gestão multiempresa e governança.
- Painel executivo do portfólio
- CRUD de empresas (tenants)
- Gestão de equipe e permissões
- Logs de auditoria imutáveis

**Acesso:** super_admin, admin_fullbpo

---

## Regra Absoluta de Domínios
> **Nunca misturar domínios.** Cada pilar tem seu namespace, componentes, hooks e páginas isolados.

---

## Stack Tecnológica

### Frontend
```
React 18 + TypeScript + Vite
Tailwind CSS (tokens customizados por módulo)
TanStack Query (React Query) — server state
Zustand — UI global apenas
React Hook Form + Zod — formulários e validação
React Router v6 — roteamento
```

### Backend
```
Supabase
  ├── PostgreSQL — banco de dados relacional
  ├── Auth — autenticação via email/senha
  ├── Storage — arquivos e documentos
  ├── Realtime — notificações em tempo real
  ├── Edge Functions (Deno) — IA, integrações e orquestração
  ├── pg_cron — disparo periódico de Edge Functions
  └── Vault — segredos (Omie, Evolution, Anthropic, etc.)
```

### Automação (sem n8n)

Toda automação é Edge Function + pg_cron + pg_net. Detalhe fluxo-a-fluxo em
[`05_AUTOMACOES_EDGE_FUNCTIONS.md`](05_AUTOMACOES_EDGE_FUNCTIONS.md).

Categorias principais:
- **Cadências** — `rotinas-worker`, `titulos-worker`, `cobranca-worker`, `reports-worker`.
- **Saúde financeira** — `financial-checks` (acuracidade, posição de caixa, alertas).
- **Comunicação WhatsApp** — `evolution-webhook`, `chat-send-message`, `chat-ai-triage`, `chat-ticket-agent` (+ worker), `chat-sla-escalation`, `chat-thread-compact`, `chat-thread-summary`, `transcribe-audio`, `classify-document`, `sentimento-worker`.
- **Bancos / ERP** — `pluggy-sync-item`, `omie-sync-job`.
- **Agente IA** — `ai-agent` + `mcp-server` (modo `sugerir` por padrão; auto-execução exige `ia_agent_policies` — Fase 4).

> ⚠️ `n8n` aparece na stack histórica da FullBPO (pré-sistema) e em `archive/legacy/05_N8N_WORKFLOWS.md`. **Nenhum código novo deve depender dele.**

---

## Design System

### Identidade Visual
- **Tipografia UI:** Inter
- **Tipografia numérica:** JetBrains Mono
- **Densidade:** Alta — tabelas compactas, máximo de informação por tela

### Cores por Módulo
```css
/* Client Experience */
--color-client: #3B82F6;  /* Azul */

/* Core Finance */
--color-finance: #10B981; /* Verde */

/* Operations Hub */
--color-operations: #F59E0B; /* Amarelo */

/* Inbox */
--color-inbox: #8B5CF6;   /* Roxo */

/* Admin */
--color-admin: #EF4444;   /* Vermelho */
```

### Componentes Obrigatórios
- Sidebar colapsável (240px expandida / 64px colapsada)
- Command Palette (`Ctrl+K` / `Cmd+K`)
- Toast notifications (verde/vermelho, canto inferior direito, auto-dismiss 4s)
- Skeleton loading em todos os widgets
- Header com bell icon (notificações) + avatar do usuário

---

## Segurança — Regras Absolutas

### Supabase Auth
- Supabase Auth é a **única** fonte de autenticação
- JWT tokens para todas as requisições
- Session timeout: 8h para operadores, 2h para clientes
- MFA disponível para admin e supervisor

### Multi-tenant via RLS
```sql
-- Função de segurança obrigatória
CREATE OR REPLACE FUNCTION user_can_access_company(uid UUID, company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = uid
    AND company_id = $2
    AND active = true
  )
$$ LANGUAGE sql SECURITY DEFINER;
```

- **RLS ativado em 100% das tabelas**
- Toda policy usa `user_can_access_company(uid, company_id)`
- Nenhuma tabela pode existir sem isolamento multi-tenant
- `user_roles` é a fonte única de verdade para permissões

### Matriz de Roles
| Role | Client | Finance | Operations | Inbox | Admin |
|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin_fullbpo | ✅ | ✅ | ✅ | ✅ | ✅ |
| supervisor | ❌ | ✅ | ✅ | ✅ | ❌ |
| operador | ❌ | ✅ | ✅ | ✅ | ❌ |
| cliente | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Jornadas Críticas

### 1. Auth Flow
```
Login → verificar email/senha → buscar role em user_roles 
→ redirect por role:
  - super_admin/admin → /admin
  - supervisor/operador → /operations
  - cliente → /client
```

### 2. Onboarding Wizard (6 steps)
```
1. Identidade (CNPJ + Razão Social + Logo)
2. Contatos (Email + Telefone + Endereço via ViaCEP)
3. Contas Bancárias (mínimo 1)
4. Plano de Contas (template ou CSV import)
5. Equipe Designada (read-only)
6. Revisão e Confirmação
→ company.status = 'ativo' + snapshot inicial de acuracidade
```

### 3. Finance Flow (AP)
```
Inbox → IA classifica → Operador valida 
→ Se valor > limite: Cliente aprova 
→ Baixa → Conciliação automática
```

### 4. Ops Flow
```
Dashboard operacional → Prioridades do dia 
→ Execução → Registro → Retorno ao cliente
```

---

## Estrutura de Pastas (Frontend)

```
src/
├── pages/
│   ├── client/          # CLIENT EXPERIENCE
│   ├── finance/         # CORE FINANCE ENGINE
│   ├── operations/      # OPERATIONS HUB
│   ├── inbox/           # INBOX OMNICHANNEL
│   └── admin/           # GOVERNANÇA & ADMIN
├── components/
│   ├── ui/              # Design System base
│   ├── layout/          # Sidebar, Header, Layout
│   └── shared/          # Componentes compartilhados
├── hooks/               # Custom hooks
├── lib/
│   ├── supabase.ts      # Cliente Supabase
│   └── utils.ts         # Utilitários
└── types/               # Tipos TypeScript (gerados do Supabase)
```

---

## Roadmap de Desenvolvimento

### Fase 1 — Fundação
- [ ] Router refactor com 5 módulos
- [ ] Schema completo Supabase + RLS
- [ ] Auth Flow completo
- [ ] Onboarding Wizard
- [ ] Client Dashboard v1

### Fase 2 — Motor Financeiro
- [ ] Contas a Pagar
- [ ] Contas a Receber
- [ ] Contratos e Recorrência
- [ ] Conciliação Bancária 2.0
- [ ] Operations Hub

### Fase 3 — IA & Escala
- [ ] Inbox com classificação por IA
- [ ] BI avançado e relatórios
- [ ] Notificações Realtime
- [ ] App mobile

---

## KPIs de Sucesso do Sistema

1. **Acuracidade Média do Portfólio** — target ≥ 90%
2. **Tempo médio de conciliação** — target < 30 min/dia/empresa
3. **SLA de aprovações de clientes** — target < 24h
4. **Tickets resolvidos no prazo** — target ≥ 95%
5. **Rotinas concluídas no dia** — target 100%

---

## Objetivo Final

Criar um ativo tecnológico que:
- **Escale o BPO sem escalar equipe**
- **Gere diferencial competitivo** mensurado pelo Índice de Acuracidade
- **Permita valuation de tecnologia**
- **Torne-se produto SaaS** no futuro
