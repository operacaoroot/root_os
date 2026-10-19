import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, FinanceTxStatus } from '@prisma/client';
import type { ChartAccountList, Dre, DreLineResult, CreateChartAccountInput, UpdateChartAccountInput, Kpis } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Enxerto do FinOps5.0: Plano de Contas (hierárquico) + DRE ("Motor Vortex").
// O DRE é dirigido por template de linhas (dre_lines) com fórmulas — porte do
// RPC `calcular_dre` do FinOps (soma com sinal → resolve conta→linha → fórmulas).

const EFFECTIVE: FinanceTxStatus[] = ['realizado', 'conciliado'];
const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Avalia a fórmula de uma linha DRE substituindo códigos por valores. Só aritmética. */
function evalFormula(formula: string, values: Record<string, number>): number | null {
  let expr = formula;
  const codes = Object.keys(values).sort((a, b) => b.length - a.length);
  for (const c of codes) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(c)}(?![A-Za-z0-9_])`, 'g');
    expr = expr.replace(re, `(${values[c]})`);
  }
  if (!/^[0-9.\-+*/()\s]+$/.test(expr)) return null; // sobrou código não resolvido
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict";return (${expr});`)() as number;
    return Number.isFinite(v) ? v : 0;
  } catch {
    return null;
  }
}

@Injectable()
export class FinopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private meta() {
    return { tool: 'banco-interno', generatedAt: new Date().toISOString() };
  }

  // ---------- Plano de Contas ----------
  async listChartAccounts(orgId: string): Promise<ChartAccountList> {
    const rows = await this.prisma.chartAccount.findMany({
      where: { orgId },
      orderBy: [{ codigo: 'asc' }],
      include: { dreLine: { select: { codigo: true } } },
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        codigo: c.codigo,
        nome: c.nome,
        tipo: c.tipo,
        nivel: c.nivel,
        permiteLancamento: c.permiteLancamento,
        dreLineId: c.dreLineId,
        dreCodigo: c.dreLine?.codigo ?? null,
        ativo: c.ativo,
        custoFixo: c.custoFixo,
        natureza: c.natureza,
      })),
      total: rows.length,
      source: this.meta(),
    };
  }

  async createChartAccount(orgId: string, input: CreateChartAccountInput, actorId: string) {
    let parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.prisma.chartAccount.findFirst({ where: { id: parentId, orgId } });
      if (!parent) throw new NotFoundException('Conta-pai não encontrada');
    }
    let dreLineId: string | null = null;
    if (input.dreCodigo) {
      const line = await this.prisma.dreLine.findFirst({ where: { orgId, codigo: input.dreCodigo } });
      dreLineId = line?.id ?? null;
    }
    const exists = await this.prisma.chartAccount.findFirst({ where: { orgId, codigo: input.codigo } });
    if (exists) throw new BadRequestException(`Já existe conta com código ${input.codigo}`);
    const acc = await this.prisma.chartAccount.create({
      data: {
        orgId, parentId, codigo: input.codigo, nome: input.nome, tipo: input.tipo,
        nivel: input.nivel, permiteLancamento: input.permiteLancamento ?? input.nivel === 3, dreLineId,
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'finance.chart.create', entityType: 'chart_account', entityId: acc.id,
      after: { codigo: acc.codigo, nome: acc.nome },
    });
    return { ok: true, id: acc.id };
  }

  async updateChartAccount(orgId: string, id: string, input: UpdateChartAccountInput, actorId: string) {
    const antes = await this.prisma.chartAccount.findFirst({ where: { id, orgId } });
    if (!antes) throw new NotFoundException('Conta não encontrada');
    // Escolher a natureza também acerta custoFixo, que a imagem anterior ainda lê.
    const data: Prisma.ChartAccountUpdateInput = {};
    if (input.natureza !== undefined) {
      data.natureza = input.natureza;
      if (input.natureza) data.custoFixo = input.natureza === 'fixo';
    }
    if (input.custoFixo !== undefined) data.custoFixo = input.custoFixo;
    const depois = await this.prisma.chartAccount.update({ where: { id }, data });
    await this.audit.log({
      orgId, actorId, action: 'finance.chart.update', entityType: 'chart_account', entityId: id,
      before: { codigo: antes.codigo, custoFixo: antes.custoFixo, natureza: antes.natureza },
      after: { codigo: antes.codigo, custoFixo: depois.custoFixo, natureza: depois.natureza },
    });
    return { ok: true, id };
  }

  // ---------- DRE (Motor Vortex) ----------
  async dre(orgId: string, range: { from?: string; to?: string; month?: string; departamentoId?: string }): Promise<Dre> {
    let from: Date;
    let to: Date;
    if (range.month && /^\d{4}-\d{2}$/.test(range.month)) {
      const [y, m] = range.month.split('-').map(Number);
      from = new Date(y, m - 1, 1);
      to = new Date(y, m, 0, 23, 59, 59, 999);
    } else {
      from = range.from ? new Date(range.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      to = range.to ? new Date(range.to) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
    }
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new BadRequestException('Período inválido');

    const lines = await this.prisma.dreLine.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }] });
    if (!lines.length) {
      return { period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: this.label(from) }, lines: [], source: this.meta() };
    }

    // 1) soma com sinal por linha de origem (entrada +, saída −), via conta→dreLine.
    //    Rateio: quando há splits, usa cada split (COALESCE(valor_rateado, valor) do FinOps).
    const dep = range.departamentoId;
    const txs = await this.prisma.financeTransaction.findMany({
      where: {
        orgId, status: { in: EFFECTIVE }, date: { gte: from, lte: to },
        OR: [{ chartAccountId: { not: null } }, { temRateio: true }],
      },
      select: {
        type: true, amount: true, temRateio: true, departamentoId: true,
        chartAccount: { select: { dreLine: { select: { codigo: true } } } },
        splits: { select: { valor: true, departamentoId: true, chartAccount: { select: { dreLine: { select: { codigo: true } } } } } },
      },
    });
    const signed: Record<string, number> = {};
    const add = (code: string | undefined | null, valor: number) => {
      if (!code) return;
      signed[code] = (signed[code] ?? 0) + valor;
    };
    for (const t of txs) {
      const sign = t.type === 'entrada' ? 1 : -1;
      if (t.temRateio && t.splits.length) {
        for (const s of t.splits) {
          if (dep && s.departamentoId !== dep) continue;
          add(s.chartAccount?.dreLine?.codigo, num(s.valor) * sign);
        }
      } else {
        if (dep && t.departamentoId !== dep) continue;
        add(t.chartAccount?.dreLine?.codigo, num(t.amount) * sign);
      }
    }

    // 2) valores por código: origem = magnitude (natureza da linha); resto via fórmula
    const values: Record<string, number> = {};
    for (const l of lines) {
      if (l.tipo === 'origem') values[l.codigo] = Math.abs(signed[l.codigo] ?? 0);
    }
    // 3) resolve calculado/grupo/indicador em até 10 passes
    const pending = lines.filter((l) => l.tipo !== 'origem');
    for (let pass = 0; pass < 10 && pending.some((l) => values[l.codigo] === undefined); pass++) {
      for (const l of pending) {
        if (values[l.codigo] !== undefined) continue;
        if (!l.formula) { values[l.codigo] = 0; continue; }
        const r = evalFormula(l.formula, values);
        if (r !== null) values[l.codigo] = r;
      }
    }
    for (const l of lines) if (values[l.codigo] === undefined) values[l.codigo] = 0;

    const result: DreLineResult[] = lines.map((l) => ({
      codigo: l.codigo,
      nome: l.nome,
      operador: l.operador,
      tipo: l.tipo,
      ordem: l.ordem,
      visivel: l.visivel,
      valor: Math.round((values[l.codigo] ?? 0) * 100) / 100,
      isPercent: l.tipo === 'indicador',
    }));

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: this.label(from) },
      lines: result,
      source: this.meta(),
    };
  }

  private label(d: Date): string {
    return `${MONTHS[d.getMonth()]}/${d.getFullYear()}`;
  }

  // ---------- KPIs (painel de indicadores) ----------
  async kpis(orgId: string): Promise<Kpis> {
    const now = new Date();
    const dre = await this.dre(orgId, {}); // mês corrente
    const v: Record<string, number> = {};
    for (const l of dre.lines) v[l.codigo] = l.valor;

    const [recAgg, recVencAgg, bankTotal, bankConc] = await Promise.all([
      this.prisma.financeTransaction.aggregate({ where: { orgId, status: 'previsto', type: 'entrada' }, _sum: { amount: true } }),
      this.prisma.financeTransaction.aggregate({ where: { orgId, status: 'previsto', type: 'entrada', dueDate: { lt: now } }, _sum: { amount: true } }),
      this.prisma.financeTransaction.count({ where: { orgId, source: { in: ['ofx', 'pluggy'] } } }),
      this.prisma.financeTransaction.count({ where: { orgId, source: { in: ['ofx', 'pluggy'] }, status: 'conciliado' } }),
    ]);
    const aReceber = num(recAgg._sum.amount);
    const aReceberVencido = num(recVencAgg._sum.amount);
    const round1 = (x: number) => Math.round(x * 10) / 10;

    return {
      mes: dre.period.label,
      dre: { fb: v.FB ?? 0, fl: v.FL ?? 0, mc: v.MC ?? 0, ebitda: v.EBITDA ?? 0, ll: v.LL ?? 0 },
      margens: { bruta: round1(v.MC_PCT ?? 0), ebitda: round1(v.EBITDA_PCT ?? 0), liquida: round1(v.LL_PCT ?? 0) },
      inadimplencia: round1(aReceber > 0 ? (aReceberVencido / aReceber) * 100 : 0),
      aReceberVencido,
      acuracidade: round1(bankTotal > 0 ? (bankConc / bankTotal) * 100 : 100),
      bankTotal,
      bankConciliado: bankConc,
      source: this.meta(),
    };
  }
}
