# Asaas — cobranças + conta digital (financeiro)

Integração via **API oficial** do Asaas. Puxa **tudo** da conta para o módulo financeiro:
extrato (caixa realizado), cobranças em aberto (contas a receber) e o saldo real.
Segue o mesmo padrão isolado do Pluggy — nenhum segredo no repositório.

## 1. Pegar a chave (2 min)

1. Entre no painel do Asaas → **Configurações → Integrações → API**.
2. Copie a **API Key**. O prefixo já diz o ambiente:
   - `$aact_prod_...` → **produção** (`https://api.asaas.com/v3`)
   - `$aact_hmlg_...` → **sandbox** (`https://sandbox.asaas.com/api/v3`)
   - O sistema **detecta sozinho** pela chave; não precisa configurar a base.

## 2. Colar a chave (ambiente já preparado)

Arquivo já criado, só preencher:

```bash
# ~/.config/root/asaas.env   (permissão 600, fora do repo)
ASAAS_API_KEY=$aact_prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
ASAAS_SYNC_INTERVAL_MIN=360      # auto-sync a cada 6h (0 desliga)
# ASAAS_BASE_URL=...            # opcional, só p/ forçar a base
```

Depois:

```bash
deploy/up.sh        # rebuild + up dos containers (injeta o asaas.env)
```

> Em dev local (sem container): `deploy/up.sh` também serve, ou `pnpm --filter @mktos/api dev`
> — o `main.ts` carrega `~/.config/root/asaas.env` automaticamente.

## 3. Conectar e sincronizar

No painel: **/financeiro → aba Bancos → Asaas → "Conectar e sincronizar"**.
Feito isso, o auto-sync roda a cada `ASAAS_SYNC_INTERVAL_MIN` minutos.
Também dá pra disparar pelo MCP (tool read-only `list_bank_connections` mostra o status).

## O que é puxado e como mapeia

| Origem no Asaas | Endpoint | Vira no financeiro |
|---|---|---|
| Extrato financeiro | `GET /financialTransactions` | Lançamentos **realizados** (caixa), `source=asaas`, dedup por `fin_<id>` |
| Cobranças em aberto (PENDING/OVERDUE/CONFIRMED/AWAITING) | `GET /payments?status=` | **A receber** (previsto entrada), dedup por `pay_<id>`, vencimento = `dueDate` |
| Clientes | `GET /customers` | Nome do pagador (`counterparty`) das cobranças |
| Saldo | `GET /finance/balance` | Ajusta o `openingBalance` da conta p/ o saldo exibido **bater** com o do Asaas |

**Sem contagem em dobro:** o caixa realizado sai do extrato; as cobranças entram só
como *previsto*. Quando uma cobrança é paga, ela sai do "aberto" e a de previsto é
removida no próximo sync (o valor já aparece no extrato como realizado).

Tudo cai em `FinanceTransaction`, então **DRE, fluxo de caixa, KPIs, conciliação,
resumo e as tools de MCP** já enxergam os dados do Asaas sem mudança extra.

## Arquivos

- `apps/api/src/finance/asaas.service.ts` — client HTTP (balance, extrato, cobranças, clientes)
- `apps/api/src/finance/finance.service.ts` — `connectAsaas` / `syncAsaasConnection` + auto-sync agendado
- `apps/api/src/finance/finance.controller.ts` — `POST /finance/bank/asaas/connect`
- `apps/web/src/app/financeiro/page.tsx` — card Asaas na aba Bancos
- `packages/mcp/src/server.ts` — tool `list_bank_connections`
- `~/.config/root/asaas.env` — a chave (fora do repo)
