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

## Incorporar o FinOps5.0 (quando houver acesso)
O repo `pedromagnago/FinOps5.0` é privado. Para trazer a base:
1. **ZIP:** baixe *Code → Download ZIP* e solte em `~/marketing-os/_finops_import/` (pasta ignorada no git).
   _ou_ torne o repo público e me passe a URL.
2. Eu analiso a stack do FinOps e **grafo por cima desta base**:
   - Telas/fluxos → viram páginas em `apps/web/src/app/financeiro/*` (mantendo auth/tokens do projeto).
   - Regras/serviços → entram em `apps/api/src/finance/*` (mantendo Prisma + RBAC + auditoria).
   - Entidades novas → migrations Prisma adicionais (sem quebrar as existentes).
   - Nada do FinOps toca o escritório C&S nem outro stack — segue 100% isolado (ver `ISOLATION.md`).
