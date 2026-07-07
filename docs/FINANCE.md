# Marketing OS — Módulo Financeiro (FinOps)

Área **exclusiva do financeiro**, no mesmo stack isolado do `root`. Nasceu para receber a
base do projeto **FinOps5.0** por cima, mas já sobe **de pé e funcional** por conta própria.

## Modelo de dados (Prisma — migration `add_finance`)
- **FinanceAccount** — conta (corrente/poupança/caixa/cartão/investimento). `openingBalance` +
  saldo derivado dos lançamentos efetivos. `provider` = manual | pluggy | ofx.
- **FinanceCategory** — plano de contas simples (`kind` = receita | despesa), único por `orgId+kind+name`.
- **FinanceTransaction** — lançamento. `amount` **sempre positivo**; o sinal vem de `type`
  (entrada | saida). `status`: `previsto` (conta a pagar/receber) → `realizado` (bateu no caixa)
  → `conciliado` (batido com o extrato). `externalId` único por conta (dedup de import).
- **BankConnection** — conexão bancária via Open Finance (Pluggy) ou OFX.

Toda tabela carrega `orgId` (multi-tenant-ready). Escrita gera `AuditLog`. Respostas trazem `source`.

## Endpoints (`/api/finance`)
| Método | Rota | Permissão |
|---|---|---|
| GET | `/summary` | financeiro.ver |
| GET | `/cashflow?from&to` | financeiro.ver |
| GET/POST | `/accounts` | ver / editar |
| GET/POST | `/categories` | ver / editar |
| GET | `/transactions?accountId&status&type&from&to&q&limit` | financeiro.ver |
| POST | `/transactions` · PATCH/DELETE `/transactions/:id` | financeiro.editar |
| GET | `/bank/connections` | financeiro.ver |
| POST | `/bank/pluggy/connect-token` · `/bank/pluggy/item` · `/bank/connections/:id/sync` | financeiro.conciliar |
| POST | `/import/ofx` (body `{ accountId, content }`) | financeiro.conciliar |

## Integração bancária
- **OFX (funciona já, sem credencial):** exporte o extrato `.ofx` do banco e faça upload na aba
  *Bancos*. Parser em `apps/api/src/finance/ofx.ts` (blocos `<STMTTRN>`, dedup por FITID).
- **Open Finance (Pluggy):** conector em `apps/api/src/finance/pluggy.service.ts`. Ligar:
  1. Crie a app no Pluggy e pegue `CLIENT_ID`/`CLIENT_SECRET`.
  2. `~/.config/root/pluggy.env`:
     ```
     PLUGGY_CLIENT_ID=...
     PLUGGY_CLIENT_SECRET=...
     ```
  3. `deploy/up.sh` (recarrega o env) e reinicie a API. A aba *Bancos* passa a oferecer
     **Conectar banco** (widget Pluggy Connect) → itemId → sync de contas + extrato.
  - NÃO guardamos senha de banco: o Pluggy detém as credenciais; guardamos só o `itemId`.

## MCP (read-only)
`get_finance_summary`, `list_finance_accounts`, `list_finance_transactions`, `get_cashflow`.
A conta de serviço `ia_servico` tem `financeiro.ver`.

## Seed
- `pnpm --filter @mktos/api db:seed` (instalação nova) já cria permissões, perfil **Financeiro**,
  categorias padrão e conta **Caixa**.
- `pnpm --filter @mktos/api db:seed:finance` — **idempotente e não-destrutivo**: sincroniza só
  permissões/perfis + categorias + caixa num banco que já existe (não apaga nada).

---

## Enxerto FinOps5.0 — etapas entregues
Domínio do FinOps5.0 (BPO FullBPO) portado do stack deles (Vite/React/Supabase) para o nosso (NestJS/Prisma/Next):

- **Plano de Contas + DRE ("Motor Vortex")** — `ChartAccount` (hierárquico) + `DreLine` (fórmulas); `GET /finance/{dre,chart-accounts}`. Seed `db:seed:finops`.
- **AP/AR** — `Partner`, `Departamento`, `Projeto`, `Contract` (recorrente), `TransactionSplit` (rateio). Aprovação por limite (`FINANCE_APPROVAL_LIMIT`, default 5000): saída prevista acima do limite exige aprovação antes da baixa. Rotas `/finance/{partners,departamentos,projetos,contracts,contracts/:id/gerar,payables,transactions/:id/approve}`. Rateio reflete no DRE (corte por departamento em `dre?departamentoId=`).
- **Conciliação bancária por score** — `GET /finance/conciliacao`, `POST /finance/conciliacao/{auto,match}`. Score = valor(50%)+data(30%)+tipo(20%); ≥0.85 auto, 0.50–0.84 sugestão (`CONCIL_THRESHOLD_AUTO/SUGESTAO`, `CONCIL_JANELA_DIAS`). Movimentos OFX/Pluggy entram `realizado`; ao casar com um título previsto, o título é consumido e o movimento vira `conciliado` (sem duplicar saldo).
- **Pluggy automático** — `FinanceService.onModuleInit` agenda o sync (`PLUGGY_SYNC_INTERVAL_MIN`, default 360 min; só com credencial).
- **KPIs** — `GET /finance/kpis`: margens (bruta/EBITDA/líquida do DRE), inadimplência (% a receber vencido), índice de acurácia (% de movimentos conciliados). Visão geral mostra os KPIs + gráfico de fluxo de caixa.

MCP financeiro: `get_finance_summary`, `list_finance_accounts`, `list_finance_transactions`, `get_cashflow`, `get_dre`, `list_chart_accounts`, `list_payables`, `get_conciliacao`, `get_finance_kpis`.

Falta (opcional): multi-empresa (BPO multi-cliente) e conector Omie — refs em `docs/finops-ref/`.

## Incorporar o FinOps5.0 (quando houver acesso)
O repo `pedromagnago/FinOps5.0` é privado. Para trazer a base:
1. **ZIP:** baixe *Code → Download ZIP* e solte em `~/marketing-os/_finops_import/` (pasta ignorada no git).
   _ou_ torne o repo público e me passe a URL.
2. Eu analiso a stack do FinOps e **grafo por cima desta base**:
   - Telas/fluxos → viram páginas em `apps/web/src/app/financeiro/*` (mantendo auth/tokens do projeto).
   - Regras/serviços → entram em `apps/api/src/finance/*` (mantendo Prisma + RBAC + auditoria).
   - Entidades novas → migrations Prisma adicionais (sem quebrar as existentes).
   - Nada do FinOps toca o escritório C&S nem outro stack — segue 100% isolado (ver `ISOLATION.md`).
