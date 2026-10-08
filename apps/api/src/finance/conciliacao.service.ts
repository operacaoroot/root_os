import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, FinanceTxType } from '@prisma/client';
import type { Conciliacao, AutoConciliarResult } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { travarFinanceiro, travarLancamentoFinanceiro, exigirNaoExercicio } from './financeiro-exercicio.service';

// Conciliação bancária por SCORE (enxerto do FinOps5.0 — executar_conciliacao_auto).
// Movimento = lançamento de origem bancária (ofx/pluggy, status realizado, ainda não
// conciliado). Título = lançamento previsto (conta a pagar/receber). O match casa os
// dois por valor (50%) + data (30%) + tipo (20%); ≥0.85 auto, 0.50–0.84 sugestão.
const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));

// pesos e limiares (defaults do FinOps; configuráveis por env)
const W_VALOR = 0.5;
const W_DATA = 0.3;
const W_TIPO = 0.2;
const THRESHOLD_AUTO = Number(process.env.CONCIL_THRESHOLD_AUTO ?? 0.85);
const THRESHOLD_SUGESTAO = Number(process.env.CONCIL_THRESHOLD_SUGESTAO ?? 0.5);
const JANELA_DIAS = Number(process.env.CONCIL_JANELA_DIAS ?? 7);

interface Mov { id: string; type: FinanceTxType; amount: number; date: Date; description: string; accountId: string }
interface Tit { id: string; type: FinanceTxType; amount: number; date: Date; dueDate: Date | null; description: string; partnerName: string | null }

function scoreMatch(mov: Mov, tit: Tit): number {
  if (mov.type !== tit.type) return 0;
  const v = Math.max(mov.amount, 1);
  const valorScore = 1 - Math.min(Math.abs(mov.amount - tit.amount) / v, 1);
  const alvo = tit.dueDate ?? tit.date;
  const dias = Math.abs((mov.date.getTime() - alvo.getTime()) / 86400_000);
  const dataScore = Math.max(0, 1 - dias / JANELA_DIAS);
  return W_VALOR * valorScore + W_DATA * dataScore + W_TIPO; // tipo já bate (filtrado)
}

@Injectable()
export class ConciliacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private meta() {
    return { tool: 'banco-interno', generatedAt: new Date().toISOString() };
  }

  private async loadOpen(orgId: string, accountId?: string): Promise<{ movs: Mov[]; tits: Tit[] }> {
    const accFilter = accountId ? { accountId } : {};
    const inscritos = await this.prisma.financeExerciseObligation.findMany({ where: { orgId }, select: { transactionId: true } });
    const idsExercicio = inscritos.map(o => o.transactionId);
    const [movRows, titRows] = await Promise.all([
      this.prisma.financeTransaction.findMany({
        where: { orgId, ...accFilter, source: { in: ['ofx', 'pluggy'] }, status: 'realizado', matchType: null },
        orderBy: [{ date: 'desc' }], take: 500,
      }),
      this.prisma.financeTransaction.findMany({
        where: { orgId, ...accFilter, status: 'previsto', approvalStatus: { in: ['nao_requer', 'aprovado'] }, id: { notIn: idsExercicio } },
        include: { partner: { select: { razaoSocial: true } } },
        orderBy: [{ dueDate: 'asc' }], take: 500,
      }),
    ]);
    return {
      movs: movRows.map((m) => ({ id: m.id, type: m.type, amount: num(m.amount), date: m.date, description: m.description, accountId: m.accountId })),
      tits: titRows.map((t) => ({ id: t.id, type: t.type, amount: num(t.amount), date: t.date, dueDate: t.dueDate, description: t.description, partnerName: t.partner?.razaoSocial ?? null })),
    };
  }

  async status(orgId: string, accountId?: string): Promise<Conciliacao> {
    const { movs, tits } = await this.loadOpen(orgId, accountId);
    const movimentos = movs.map((m) => {
      let best: { tit: Tit; score: number } | null = null;
      for (const t of tits) {
        const s = scoreMatch(m, t);
        if (s >= THRESHOLD_SUGESTAO && (!best || s > best.score)) best = { tit: t, score: s };
      }
      return {
        id: m.id, date: m.date.toISOString(), type: m.type, amount: m.amount, description: m.description,
        sugestaoTituloId: best?.tit.id ?? null,
        sugestaoDescricao: best?.tit.description ?? null,
        sugestaoScore: best ? Math.round(best.score * 100) / 100 : 0,
        sugestaoAuto: best ? best.score >= THRESHOLD_AUTO : false,
      };
    });
    return {
      movimentos,
      titulos: tits.map((t) => ({ id: t.id, type: t.type, amount: t.amount, dueDate: t.dueDate ? t.dueDate.toISOString() : null, description: t.description, partnerName: t.partnerName })),
      stats: { movimentosAbertos: movs.length, titulosAbertos: tits.length },
      source: this.meta(),
    };
  }

  /** Auto-concilia: casa automaticamente pares com score ≥ limiar. */
  async auto(orgId: string, accountId: string | undefined, actorId: string): Promise<AutoConciliarResult> {
    const { movs, tits } = await this.loadOpen(orgId, accountId);
    const usados = new Set<string>();
    let conciliados = 0;
    let sugestoes = 0;
    for (const m of movs) {
      let best: { tit: Tit; score: number } | null = null;
      for (const t of tits) {
        if (usados.has(t.id)) continue;
        const s = scoreMatch(m, t);
        if (s >= THRESHOLD_SUGESTAO && (!best || s > best.score)) best = { tit: t, score: s };
      }
      if (best && best.score >= THRESHOLD_AUTO) {
        await this.applyMatch(orgId, m.id, best.tit.id, best.score, 'automatico', actorId);
        usados.add(best.tit.id);
        conciliados += 1;
      } else if (best) {
        sugestoes += 1;
      }
    }
    return { conciliados, sugestoes, source: this.meta() };
  }

  async match(orgId: string, movimentoId: string, tituloId: string, actorId: string) {
    const mov = await this.prisma.financeTransaction.findFirst({ where: { id: movimentoId, orgId } });
    const tit = await this.prisma.financeTransaction.findFirst({ where: { id: tituloId, orgId } });
    if (!mov || !tit) throw new NotFoundException('Movimento ou título não encontrado');
    if (mov.matchType) throw new BadRequestException('Movimento já conciliado');
    if (tit.status !== 'previsto') throw new BadRequestException('O título precisa estar previsto');
    const score = scoreMatch(
      { id: mov.id, type: mov.type, amount: num(mov.amount), date: mov.date, description: mov.description, accountId: mov.accountId },
      { id: tit.id, type: tit.type, amount: num(tit.amount), date: tit.date, dueDate: tit.dueDate, description: tit.description, partnerName: null },
    );
    await this.applyMatch(orgId, movimentoId, tituloId, score, 'manual', actorId);
    return { ok: true, score: Math.round(score * 100) / 100 };
  }

  // Enriquece o movimento com a classificação do título e consome o título (previsto).
  private async applyMatch(orgId: string, movId: string, titId: string, score: number, tipo: string, actorId: string) {
    await this.prisma.$transaction(async db => {
      await exigirAcessoAtual(db, orgId, actorId, ['financeiro.ver', 'financeiro.conciliar']);
      await travarFinanceiro(db, orgId);
      for (const id of [...new Set([movId, titId])].sort()) {
        await travarLancamentoFinanceiro(db, orgId, id);
        await exigirNaoExercicio(db, orgId, id);
      }
      const [mov, tit] = await Promise.all([
        db.financeTransaction.findFirst({ where: { id: movId, orgId } }),
        db.financeTransaction.findFirst({ where: { id: titId, orgId } }),
      ]);
      if (!mov || !tit) throw new NotFoundException('Movimento ou título não encontrado');
      if (movId === titId || mov.matchType || mov.status !== 'realizado' || !['ofx', 'pluggy'].includes(mov.source) ||
          tit.status !== 'previsto' || !['nao_requer', 'aprovado'].includes(tit.approvalStatus))
        throw new BadRequestException('Movimento ou título não está disponível para conciliação.');
      await db.financeTransaction.update({ where: { id: movId }, data: {
        status: 'conciliado', matchScore: Math.round(score * 100) / 100, matchType: tipo, reconciledAt: new Date(),
        chartAccountId: mov.chartAccountId ?? tit.chartAccountId, categoryId: mov.categoryId ?? tit.categoryId,
        partnerId: mov.partnerId ?? tit.partnerId, departamentoId: mov.departamentoId ?? tit.departamentoId,
        projetoId: mov.projetoId ?? tit.projetoId, documentNumber: mov.documentNumber ?? tit.documentNumber,
      } });
      await db.financeTransaction.delete({ where: { id: titId } });
      await this.audit.log({
        orgId, actorId, actorType: 'user', action: 'finance.conciliacao.match',
        entityType: 'finance_transaction', entityId: movId, after: { tituloId: titId, score, tipo },
      }, db);
      await exigirAcessoAtual(db, orgId, actorId, ['financeiro.ver', 'financeiro.conciliar']);
    }, { timeout: 30000 });
  }
}
