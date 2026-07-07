import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, FinanceTxType, FinanceTxStatus, FinanceAccountType } from '@prisma/client';
import type {
  FinanceSummary,
  FinanceAccountList,
  FinanceCategoryList,
  FinanceTransactionList,
  Cashflow,
  BankConnectionList,
  OfxImportResult,
  CreateFinanceAccountInput,
  CreateFinanceCategoryInput,
  CreateFinanceTransactionInput,
  UpdateFinanceTransactionInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PluggyService } from './pluggy.service';
import { parseOfx } from './ofx';

// status que efetivamente movem o caixa (contam no saldo)
const EFFECTIVE: FinanceTxStatus[] = ['realizado', 'conciliado'];
const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));

function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new BadRequestException(`Data inválida: ${s}`);
  return d;
}
function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pluggy: PluggyService,
  ) {}

  private meta() {
    return { tool: 'banco-interno', generatedAt: new Date().toISOString() };
  }

  // ---------- Saldos ----------
  /** Saldo por conta = openingBalance + entradas − saídas (status efetivo). */
  private async balancesByAccount(orgId: string): Promise<Map<string, number>> {
    const grouped = await this.prisma.financeTransaction.groupBy({
      by: ['accountId', 'type'],
      where: { orgId, status: { in: EFFECTIVE } },
      _sum: { amount: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) {
      const cur = map.get(g.accountId) ?? 0;
      const v = num(g._sum.amount);
      map.set(g.accountId, cur + (g.type === 'entrada' ? v : -v));
    }
    return map;
  }

  // ---------- Contas ----------
  async listAccounts(orgId: string): Promise<FinanceAccountList> {
    const [accounts, balances] = await Promise.all([
      this.prisma.financeAccount.findMany({ where: { orgId }, orderBy: [{ createdAt: 'asc' }] }),
      this.balancesByAccount(orgId),
    ]);
    return {
      items: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        institution: a.institution,
        currency: a.currency,
        provider: a.provider,
        isActive: a.isActive,
        openingBalance: num(a.openingBalance),
        balance: num(a.openingBalance) + (balances.get(a.id) ?? 0),
        createdAt: a.createdAt.toISOString(),
      })),
      total: accounts.length,
      source: this.meta(),
    };
  }

  async createAccount(orgId: string, input: CreateFinanceAccountInput, actorId: string) {
    const acc = await this.prisma.financeAccount.create({
      data: {
        orgId,
        name: input.name,
        type: (input.type ?? 'corrente') as FinanceAccountType,
        institution: input.institution ?? null,
        openingBalance: input.openingBalance != null ? new Prisma.Decimal(input.openingBalance) : new Prisma.Decimal(0),
        provider: 'manual',
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'finance.account.create', entityType: 'finance_account', entityId: acc.id,
      after: { name: acc.name, type: acc.type },
    });
    return { ok: true, id: acc.id };
  }

  // ---------- Categorias ----------
  async listCategories(orgId: string): Promise<FinanceCategoryList> {
    const rows = await this.prisma.financeCategory.findMany({
      where: { orgId }, orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return {
      items: rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color })),
      total: rows.length,
      source: this.meta(),
    };
  }

  async createCategory(orgId: string, input: CreateFinanceCategoryInput, actorId: string) {
    const cat = await this.prisma.financeCategory.upsert({
      where: { orgId_kind_name: { orgId, kind: input.kind, name: input.name } },
      update: { color: input.color ?? undefined },
      create: { orgId, name: input.name, kind: input.kind, color: input.color ?? null },
    });
    await this.audit.log({
      orgId, actorId, action: 'finance.category.create', entityType: 'finance_category', entityId: cat.id,
      after: { name: cat.name, kind: cat.kind },
    });
    return { ok: true, id: cat.id };
  }

  // ---------- Lançamentos ----------
  async listTransactions(
    orgId: string,
    filter: { accountId?: string; status?: string; type?: string; categoryId?: string; from?: string; to?: string; q?: string; limit?: number },
  ): Promise<FinanceTransactionList> {
    const where: Prisma.FinanceTransactionWhereInput = { orgId };
    if (filter.accountId) where.accountId = filter.accountId;
    if (filter.status) where.status = filter.status as FinanceTxStatus;
    if (filter.type) where.type = filter.type as FinanceTxType;
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.q) where.description = { contains: filter.q, mode: 'insensitive' };
    if (filter.from || filter.to) {
      where.date = {};
      if (filter.from) (where.date as Prisma.DateTimeFilter).gte = parseDate(filter.from);
      if (filter.to) (where.date as Prisma.DateTimeFilter).lte = parseDate(filter.to);
    }
    const take = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const rows = await this.prisma.financeTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take,
      include: { account: { select: { name: true } }, category: { select: { name: true } } },
    });
    let entradas = 0;
    let saidas = 0;
    for (const r of rows) {
      const v = num(r.amount);
      if (r.type === 'entrada') entradas += v;
      else saidas += v;
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        accountName: r.account?.name ?? null,
        categoryId: r.categoryId,
        categoryName: r.category?.name ?? null,
        type: r.type,
        status: r.status,
        description: r.description,
        amount: num(r.amount),
        date: r.date.toISOString(),
        dueDate: iso(r.dueDate),
        paidAt: iso(r.paidAt),
        counterparty: r.counterparty,
        documentNumber: r.documentNumber,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      })),
      total: rows.length,
      totals: { entradas, saidas, saldo: entradas - saidas },
      source: this.meta(),
    };
  }

  async createTransaction(orgId: string, input: CreateFinanceTransactionInput, actorId: string) {
    const account = await this.prisma.financeAccount.findFirst({ where: { id: input.accountId, orgId } });
    if (!account) throw new NotFoundException('Conta não encontrada');
    if (input.categoryId) {
      const cat = await this.prisma.financeCategory.findFirst({ where: { id: input.categoryId, orgId } });
      if (!cat) throw new NotFoundException('Categoria não encontrada');
    }
    const tx = await this.prisma.financeTransaction.create({
      data: {
        orgId,
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        type: input.type as FinanceTxType,
        status: (input.status ?? 'realizado') as FinanceTxStatus,
        description: input.description,
        amount: new Prisma.Decimal(input.amount),
        date: parseDate(input.date),
        dueDate: input.dueDate ? parseDate(input.dueDate) : null,
        paidAt: (input.status ?? 'realizado') === 'realizado' ? new Date() : null,
        counterparty: input.counterparty ?? null,
        documentNumber: input.documentNumber ?? null,
        notes: input.notes ?? null,
        source: 'manual',
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'finance.tx.create', entityType: 'finance_transaction', entityId: tx.id,
      after: { type: tx.type, amount: num(tx.amount), status: tx.status },
    });
    return { ok: true, id: tx.id };
  }

  async updateTransaction(orgId: string, id: string, input: UpdateFinanceTransactionInput, actorId: string) {
    const tx = await this.prisma.financeTransaction.findFirst({ where: { id, orgId } });
    if (!tx) throw new NotFoundException('Lançamento não encontrado');
    const data: Prisma.FinanceTransactionUpdateInput = {};
    if (input.status !== undefined) {
      data.status = input.status as FinanceTxStatus;
      if (input.status === 'realizado' && !tx.paidAt) data.paidAt = new Date();
    }
    if (input.categoryId !== undefined) {
      if (input.categoryId) {
        const cat = await this.prisma.financeCategory.findFirst({ where: { id: input.categoryId, orgId } });
        if (!cat) throw new NotFoundException('Categoria não encontrada');
        data.category = { connect: { id: input.categoryId } };
      } else {
        data.category = { disconnect: true };
      }
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.amount !== undefined) data.amount = new Prisma.Decimal(input.amount);
    if (input.date !== undefined) data.date = parseDate(input.date);
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? parseDate(input.dueDate) : null;
    if (input.paidAt !== undefined) data.paidAt = input.paidAt ? parseDate(input.paidAt) : null;
    if (input.counterparty !== undefined) data.counterparty = input.counterparty;

    const updated = await this.prisma.financeTransaction.update({ where: { id }, data });
    await this.audit.log({
      orgId, actorId, action: 'finance.tx.update', entityType: 'finance_transaction', entityId: id,
      before: { status: tx.status, amount: num(tx.amount) },
      after: { status: updated.status, amount: num(updated.amount) },
    });
    return { ok: true, id, status: updated.status };
  }

  async deleteTransaction(orgId: string, id: string, actorId: string) {
    const tx = await this.prisma.financeTransaction.findFirst({ where: { id, orgId } });
    if (!tx) throw new NotFoundException('Lançamento não encontrado');
    await this.prisma.financeTransaction.delete({ where: { id } });
    await this.audit.log({
      orgId, actorId, action: 'finance.tx.delete', entityType: 'finance_transaction', entityId: id,
      before: { type: tx.type, amount: num(tx.amount), description: tx.description },
    });
    return { ok: true };
  }

  // ---------- Resumo (cards do dashboard financeiro) ----------
  async summary(orgId: string): Promise<FinanceSummary> {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const [accounts, balances, monthGroup, previstoGroup, previstoVencido, topCats, connections] = await Promise.all([
      this.prisma.financeAccount.findMany({ where: { orgId }, select: { id: true, name: true, openingBalance: true } }),
      this.balancesByAccount(orgId),
      this.prisma.financeTransaction.groupBy({
        by: ['type'], where: { orgId, status: { in: EFFECTIVE }, date: { gte: monthStart } }, _sum: { amount: true },
      }),
      this.prisma.financeTransaction.groupBy({
        by: ['type'], where: { orgId, status: 'previsto' }, _sum: { amount: true },
      }),
      this.prisma.financeTransaction.groupBy({
        by: ['type'], where: { orgId, status: 'previsto', dueDate: { lt: now } }, _sum: { amount: true },
      }),
      this.prisma.financeTransaction.groupBy({
        by: ['categoryId', 'type'], where: { orgId, status: { in: EFFECTIVE }, date: { gte: monthStart } }, _sum: { amount: true },
      }),
      this.prisma.bankConnection.findMany({ where: { orgId }, select: { status: true } }),
    ]);

    const sumByType = (g: Array<{ type: FinanceTxType; _sum: { amount: Prisma.Decimal | null } }>, t: FinanceTxType) =>
      num(g.find((x) => x.type === t)?._sum.amount);

    const saldoTotal = accounts.reduce((s, a) => s + num(a.openingBalance) + (balances.get(a.id) ?? 0), 0);

    // top categorias do mês (nomes)
    const catIds = [...new Set(topCats.map((c) => c.categoryId).filter((x): x is string => !!x))];
    const cats = catIds.length
      ? await this.prisma.financeCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, kind: true } })
      : [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const topCategorias = topCats
      .filter((c) => c.categoryId)
      .map((c) => ({
        name: catById.get(c.categoryId!)?.name ?? '—',
        kind: catById.get(c.categoryId!)?.kind ?? (c.type === 'entrada' ? 'receita' : 'despesa'),
        total: num(c._sum.amount),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    return {
      saldoTotal,
      contas: accounts.length,
      mes: {
        entradas: sumByType(monthGroup, 'entrada'),
        saidas: sumByType(monthGroup, 'saida'),
        resultado: sumByType(monthGroup, 'entrada') - sumByType(monthGroup, 'saida'),
      },
      aReceber: sumByType(previstoGroup, 'entrada'),
      aPagar: sumByType(previstoGroup, 'saida'),
      aReceberVencido: sumByType(previstoVencido, 'entrada'),
      aPagarVencido: sumByType(previstoVencido, 'saida'),
      byAccount: accounts.map((a) => ({ id: a.id, name: a.name, balance: num(a.openingBalance) + (balances.get(a.id) ?? 0) })),
      topCategorias,
      bancos: {
        conexoes: connections.length,
        conectados: connections.filter((c) => c.status === 'connected').length,
        pluggyConfigurado: this.pluggy.configured,
      },
      source: this.meta(),
    };
  }

  // ---------- Fluxo de caixa (projeção dia a dia, com previstos) ----------
  async cashflow(orgId: string, range: { from?: string; to?: string }): Promise<Cashflow> {
    const from = range.from ? startOfDay(parseDate(range.from)) : startOfDay(new Date());
    const to = range.to ? startOfDay(parseDate(range.to)) : startOfDay(new Date(from.getTime() + 30 * 86400_000));

    // saldo de abertura da janela = openingBalance das contas + realizados antes de `from`
    const [accounts, realizedBefore, windowTx] = await Promise.all([
      this.prisma.financeAccount.aggregate({ where: { orgId }, _sum: { openingBalance: true } }),
      this.prisma.financeTransaction.groupBy({
        by: ['type'], where: { orgId, status: { in: EFFECTIVE }, date: { lt: from } }, _sum: { amount: true },
      }),
      this.prisma.financeTransaction.findMany({
        where: {
          orgId,
          OR: [
            { status: { in: EFFECTIVE }, date: { gte: from, lte: to } },
            { status: 'previsto', dueDate: { gte: from, lte: to } },
            { status: 'previsto', dueDate: null, date: { gte: from, lte: to } },
          ],
        },
        select: { type: true, amount: true, status: true, date: true, dueDate: true },
      }),
    ]);

    const sumB = (t: FinanceTxType) => num(realizedBefore.find((x) => x.type === t)?._sum.amount);
    const openingBalance = num(accounts._sum.openingBalance) + sumB('entrada') - sumB('saida');

    // bucket por dia
    const buckets = new Map<string, { entradas: number; saidas: number }>();
    for (const tx of windowTx) {
      const eff = tx.status === 'previsto' ? (tx.dueDate ?? tx.date) : tx.date;
      const key = startOfDay(eff).toISOString().slice(0, 10);
      const b = buckets.get(key) ?? { entradas: 0, saidas: 0 };
      const v = num(tx.amount);
      if (tx.type === 'entrada') b.entradas += v;
      else b.saidas += v;
      buckets.set(key, b);
    }

    const days: Cashflow['days'] = [];
    let acumulado = openingBalance;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400_000)) {
      const key = d.toISOString().slice(0, 10);
      const b = buckets.get(key) ?? { entradas: 0, saidas: 0 };
      const resultado = b.entradas - b.saidas;
      acumulado += resultado;
      days.push({ date: key, entradas: b.entradas, saidas: b.saidas, resultado, acumulado });
    }

    return {
      window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      openingBalance,
      days,
      source: this.meta(),
    };
  }

  // ---------- Bancos (Open Finance / Pluggy) ----------
  async listBankConnections(orgId: string): Promise<BankConnectionList> {
    const rows = await this.prisma.bankConnection.findMany({
      where: { orgId }, orderBy: [{ createdAt: 'desc' }], include: { _count: { select: { accounts: true } } },
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        provider: c.provider,
        institutionName: c.institutionName,
        status: c.status,
        lastSyncAt: iso(c.lastSyncAt),
        lastError: c.lastError,
        accounts: c._count.accounts,
        createdAt: c.createdAt.toISOString(),
      })),
      total: rows.length,
      pluggyConfigurado: this.pluggy.configured,
      source: this.meta(),
    };
  }

  async pluggyConnectToken(itemId?: string): Promise<{ accessToken: string }> {
    return this.pluggy.connectToken(itemId);
  }

  /** Registra um item Pluggy (após o widget) e já sincroniza contas + extrato. */
  async registerPluggyItem(orgId: string, itemId: string, actorId: string) {
    const meta = await this.pluggy.getItem(itemId).catch(() => ({ institution: null, status: null }));
    const existing = await this.prisma.bankConnection.findFirst({ where: { orgId, provider: 'pluggy', externalId: itemId } });
    const conn = existing
      ? await this.prisma.bankConnection.update({
          where: { id: existing.id },
          data: { institutionName: meta.institution, status: 'connected' },
        })
      : await this.prisma.bankConnection.create({
          data: { orgId, provider: 'pluggy', externalId: itemId, institutionName: meta.institution, status: 'connected' },
        });
    await this.audit.log({
      orgId, actorId, action: 'finance.bank.connect', entityType: 'bank_connection', entityId: conn.id,
      after: { itemId, institution: meta.institution },
    });
    const synced = await this.syncBankConnection(orgId, conn.id, actorId);
    return { ok: true, connectionId: conn.id, ...synced };
  }

  async syncBankConnection(orgId: string, connectionId: string, actorId?: string): Promise<{ accounts: number; transactions: number }> {
    const conn = await this.prisma.bankConnection.findFirst({ where: { id: connectionId, orgId } });
    if (!conn) throw new NotFoundException('Conexão bancária não encontrada');
    if (conn.provider !== 'pluggy' || !conn.externalId) {
      throw new BadRequestException('Conexão sem item Pluggy para sincronizar.');
    }
    try {
      const pgAccounts = await this.pluggy.listAccounts(conn.externalId);
      let txCount = 0;
      const since = new Date(Date.now() - 365 * 86400_000).toISOString();
      for (const pa of pgAccounts) {
        const account = await this.upsertBankAccount(orgId, conn.id, pa);
        const pgTx = await this.pluggy.listTransactions(pa.id, since);
        for (const t of pgTx) {
          const type: FinanceTxType = (t.type === 'DEBIT' || t.amount < 0) ? 'saida' : 'entrada';
          await this.prisma.financeTransaction.upsert({
            where: { orgId_accountId_externalId: { orgId, accountId: account.id, externalId: t.id } },
            update: { amount: new Prisma.Decimal(Math.abs(t.amount)), description: t.description ?? 'Lançamento', date: new Date(t.date) },
            create: {
              orgId, accountId: account.id, type, status: 'conciliado',
              description: t.description ?? 'Lançamento', amount: new Prisma.Decimal(Math.abs(t.amount)),
              date: new Date(t.date), source: 'pluggy', externalId: t.id,
            },
          });
          txCount++;
        }
      }
      await this.prisma.bankConnection.update({
        where: { id: conn.id }, data: { status: 'connected', lastSyncAt: new Date(), lastError: null },
      });
      await this.markHealth('ok', null);
      await this.audit.log({
        orgId, actorId, actorType: actorId ? 'user' : 'system', action: 'finance.bank.sync',
        entityType: 'bank_connection', entityId: conn.id, after: { accounts: pgAccounts.length, transactions: txCount },
      });
      return { accounts: pgAccounts.length, transactions: txCount };
    } catch (e) {
      await this.prisma.bankConnection.update({
        where: { id: conn.id }, data: { status: 'error', lastError: (e as Error).message },
      }).catch(() => {});
      await this.markHealth('down', (e as Error).message).catch(() => {});
      throw e;
    }
  }

  private mapAccountType(pa: PluggyAccountLike): FinanceAccountType {
    const st = (pa.subtype ?? '').toUpperCase();
    if (st.includes('SAVINGS')) return 'poupanca';
    if (st.includes('CREDIT') || (pa.type ?? '').toUpperCase() === 'CREDIT') return 'cartao';
    return 'corrente';
  }

  private async upsertBankAccount(orgId: string, connectionId: string, pa: PluggyAccountLike) {
    const existing = await this.prisma.financeAccount.findFirst({ where: { orgId, provider: 'pluggy', externalId: pa.id } });
    const data = {
      name: pa.name || pa.number || 'Conta bancária',
      type: this.mapAccountType(pa),
      institution: pa.name ?? null,
      currency: pa.currencyCode || 'BRL',
    };
    if (existing) {
      return this.prisma.financeAccount.update({ where: { id: existing.id }, data });
    }
    return this.prisma.financeAccount.create({
      data: { orgId, provider: 'pluggy', externalId: pa.id, connectionId, ...data },
    });
  }

  private async markHealth(health: 'ok' | 'down', lastError: string | null) {
    const org = await this.prisma.org.findFirst({ where: { slug: 'root' } });
    if (!org) return;
    const status = health === 'ok' ? 'connected' : 'error';
    const acc = await this.prisma.integrationAccount.findFirst({ where: { orgId: org.id, key: 'pluggy' } });
    const account = acc
      ? await this.prisma.integrationAccount.update({ where: { id: acc.id }, data: { status, connectedAt: health === 'ok' ? new Date() : acc.connectedAt } })
      : await this.prisma.integrationAccount.create({ data: { orgId: org.id, key: 'pluggy', label: 'Bancos (Pluggy)', status, connectedAt: new Date() } });
    await this.prisma.integrationHealth.upsert({
      where: { accountId: account.id },
      update: { status: health, lastSyncAt: new Date(), lastError },
      create: { accountId: account.id, status: health, lastSyncAt: new Date(), lastError },
    });
  }

  // ---------- Importação de extrato OFX ----------
  async importOfx(orgId: string, accountId: string, content: string, actorId: string): Promise<OfxImportResult> {
    const account = await this.prisma.financeAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException('Conta não encontrada');
    const txs = parseOfx(content);
    if (!txs.length) throw new BadRequestException('Nenhum lançamento (STMTTRN) encontrado no arquivo OFX.');

    let imported = 0;
    let skipped = 0;
    for (const t of txs) {
      const dup = await this.prisma.financeTransaction.findFirst({
        where: { orgId, accountId, externalId: t.externalId },
        select: { id: true },
      });
      if (dup) { skipped++; continue; }
      await this.prisma.financeTransaction.create({
        data: {
          orgId, accountId, type: t.type as FinanceTxType, status: 'conciliado',
          description: t.description, amount: new Prisma.Decimal(t.amount), date: t.date,
          source: 'ofx', externalId: t.externalId,
        },
      });
      imported++;
    }
    await this.audit.log({
      orgId, actorId, action: 'finance.ofx.import', entityType: 'finance_account', entityId: accountId,
      after: { imported, skipped },
    });
    return { imported, skipped, accountId, source: this.meta() };
  }
}

// tipo estrutural leve p/ o mapeamento de contas Pluggy (evita import circular)
interface PluggyAccountLike {
  id: string;
  type?: string;
  subtype?: string;
  name?: string;
  number?: string;
  currencyCode?: string;
}
