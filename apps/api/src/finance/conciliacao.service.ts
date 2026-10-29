import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, FinanceTxType } from '@prisma/client';
import type { Conciliacao, AutoConciliarResult } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { travarFinanceiro, travarLancamentoFinanceiro, exigirNaoExercicio } from './financeiro-exercicio.service';

// Conciliação bancária por SCORE (enxerto do FinOps5.0 — executar_conciliacao_auto).
// Movimento = lançamento de origem bancária (ofx/pluggy/asaas, status realizado, ainda
// não conciliado). Título = lançamento previsto (conta a pagar/receber). A nota soma
// valor (50%) + data (30%) + tipo (20%); a partir de 0.50 vira sugestão, e uma pessoa
// confirma (29/10/2026: nada casa sozinho por nota; o Asaas casa pelo id no sync).
// Conciliar passa para o movimento a classificação E o contrato do título: é assim que
// o pagamento de uma conta recorrente fica preso ao contrato dela.
const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));

// O extrato do Asaas é movimento como o de OFX/Pluggy. As cobranças em aberto que o
// próprio sync do Asaas grava (source 'asaas', previsto) NÃO são título: o sync já as
// apaga quando saem do aberto, e consumi-las aqui faria o sync recriá-las.
const ORIGENS_DE_MOVIMENTO = ['ofx', 'pluggy', 'asaas'];

// pesos e limiares (defaults do FinOps; configuráveis por env)
const W_VALOR = 0.5;
const W_DATA = 0.3;
const W_TIPO = 0.2;
const THRESHOLD_SUGESTAO = Number(process.env.CONCIL_THRESHOLD_SUGESTAO ?? 0.5);
const JANELA_DIAS = Number(process.env.CONCIL_JANELA_DIAS ?? 7);

// `texto`: descrição, favorecido e parceiro do movimento. `nomes`: palavras que
// identificam quem é o título (parceiro, apelidos dos acordos dele, começo da descrição).
interface Mov { id: string; type: FinanceTxType; amount: number; date: Date; description: string; accountId: string; texto: string }
interface Tit { id: string; type: FinanceTxType; amount: number; date: Date; dueDate: Date | null; description: string; partnerName: string | null; nomes: string[] }

function scoreMatch(mov: Mov, tit: Tit): number {
  if (mov.type !== tit.type) return 0;
  const v = Math.max(mov.amount, 1);
  const valorScore = 1 - Math.min(Math.abs(mov.amount - tit.amount) / v, 1);
  const alvo = tit.dueDate ?? tit.date;
  const dias = Math.abs((mov.date.getTime() - alvo.getTime()) / 86400_000);
  const dataScore = Math.max(0, 1 - dias / JANELA_DIAS);
  return W_VALOR * valorScore + W_DATA * dataScore + W_TIPO; // tipo já bate (filtrado)
}

// TESE DO FINANCEIRO (29/10/2026): o que vem do Asaas casa sozinho pelo id da cobrança,
// no sync (`conciliarPeloId`). O resto o sistema só SUGERE e uma pessoa confirma: valor
// e data iguais não casam nada sozinhos. As taxas do Asaas (R$ 0,55, 0,99, 1,99) têm o
// valor de muita coisa, e em 29/10 a taxa de um boleto da ProMedical casou sozinha com
// a assinatura da ZapSign. Entre as sugestões, a que tem uma palavra do nome em comum
// vem antes.
const PALAVRAS_GENERICAS = new Set([
  'transacao', 'chave', 'para', 'cobranca', 'recebida', 'fatura', 'taxa', 'boleto', 'pagamento',
  'conta', 'mensal', 'assinatura', 'contrato', 'ltda', 'eireli', 'servicos', 'brasil', 'instituicao',
  'digital', 'parcela', 'parcelas', 'entrada', 'saida', 'code', 'efetuada', 'cartao', 'final',
  'notificacao', 'whatsapp', 'mensageria', 'restante', 'reembolso', 'previsto', 'promocional',
  'plano', 'anual', 'renovacao', 'comercio', 'industria', 'solucoes', 'root', 'operacao',
]);
export const palavras = (s: string | null | undefined): string[] =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p) && !PALAVRAS_GENERICAS.has(p));
const comecoDaDescricao = (s: string) => s.split(/\s[—–-]\s|\(|:/)[0];

function nomeBate(mov: Mov, tit: Tit): boolean {
  if (!tit.nomes.length) return false;
  const texto = new Set(palavras(mov.texto));
  return tit.nomes.some((p) => texto.has(p));
}

/** A sugestão de título para o movimento: com nome em comum vem antes, depois a maior nota. */
export function melhorTitulo(m: Mov, tits: Tit[], usados?: Set<string>) {
  let best: { tit: Tit; score: number; nome: boolean } | null = null;
  for (const t of tits) {
    if (usados?.has(t.id)) continue;
    const score = scoreMatch(m, t);
    if (score < THRESHOLD_SUGESTAO) continue;
    const nome = nomeBate(m, t);
    if (!best || (nome && !best.nome) || (nome === best.nome && score > best.score)) best = { tit: t, score, nome };
  }
  return best;
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
    const [legados, comerciais] = await Promise.all([
      this.prisma.financeExerciseObligation.findMany({ where: { orgId }, select: { transactionId: true } }),
      this.prisma.commercialExerciseObligation.findMany({ where: { orgId }, select: { transactionId: true } }),
    ]);
    const inscritos = [...legados, ...comerciais];
    const idsExercicio = inscritos.map(o => o.transactionId);
    const [movRows, titRows] = await Promise.all([
      this.prisma.financeTransaction.findMany({
        where: { orgId, ...accFilter, source: { in: ORIGENS_DE_MOVIMENTO }, status: 'realizado', matchType: null },
        include: { partner: { select: { razaoSocial: true } } },
        orderBy: [{ date: 'desc' }], take: 500,
      }),
      this.prisma.financeTransaction.findMany({
        where: { orgId, ...accFilter, status: 'previsto', source: { not: 'asaas' }, approvalStatus: { in: ['nao_requer', 'aprovado'] }, id: { notIn: idsExercicio } },
        include: { partner: { select: { razaoSocial: true, nomeFantasia: true, acordos: { select: { cliente: true, apelidos: true } } } } },
        orderBy: [{ dueDate: 'asc' }], take: 500,
      }),
    ]);
    return {
      movs: movRows.map((m) => ({
        id: m.id, type: m.type, amount: num(m.amount), date: m.date, description: m.description, accountId: m.accountId,
        texto: [m.description, m.counterparty, m.partner?.razaoSocial].filter(Boolean).join(' '),
      })),
      tits: titRows.map((t) => ({
        id: t.id, type: t.type, amount: num(t.amount), date: t.date, dueDate: t.dueDate, description: t.description, partnerName: t.partner?.razaoSocial ?? null,
        nomes: [...new Set([
          t.partner?.razaoSocial, t.partner?.nomeFantasia, t.counterparty, comecoDaDescricao(t.description),
          ...(t.partner?.acordos ?? []).flatMap((a) => [a.cliente, ...(a.apelidos ?? '').split(',')]),
        ].flatMap(palavras))],
      })),
    };
  }

  async status(orgId: string, accountId?: string): Promise<Conciliacao> {
    const { movs, tits } = await this.loadOpen(orgId, accountId);
    const movimentos = movs.map((m) => {
      const best = melhorTitulo(m, tits);
      return {
        id: m.id, date: m.date.toISOString(), type: m.type, amount: m.amount, description: m.description,
        sugestaoTituloId: best?.tit.id ?? null,
        sugestaoDescricao: best?.tit.description ?? null,
        sugestaoScore: best ? Math.round(best.score * 100) / 100 : 0,
        sugestaoAuto: false, // fora do Asaas nada casa sozinho
      };
    });
    return {
      movimentos,
      titulos: tits.map((t) => ({ id: t.id, type: t.type, amount: t.amount, dueDate: t.dueDate ? t.dueDate.toISOString() : null, description: t.description, partnerName: t.partnerName })),
      stats: { movimentosAbertos: movs.length, titulosAbertos: tits.length },
      source: this.meta(),
    };
  }

  /**
   * Antes casava sozinho todo par com nota ≥ 0,85. Desde a tese de 29/10/2026 só conta
   * as sugestões: o que vem do Asaas já casou pelo id no sync, e o resto uma pessoa confirma.
   */
  async auto(orgId: string, accountId: string | undefined, _actorId: string): Promise<AutoConciliarResult> {
    const { movs, tits } = await this.loadOpen(orgId, accountId);
    const sugestoes = movs.filter((m) => melhorTitulo(m, tits)).length;
    return { conciliados: 0, sugestoes, source: this.meta() };
  }

  async match(orgId: string, movimentoId: string, tituloId: string, actorId: string) {
    const mov = await this.prisma.financeTransaction.findFirst({ where: { id: movimentoId, orgId } });
    const tit = await this.prisma.financeTransaction.findFirst({ where: { id: tituloId, orgId } });
    if (!mov || !tit) throw new NotFoundException('Movimento ou título não encontrado');
    if (mov.matchType) throw new BadRequestException('Movimento já conciliado');
    if (tit.status !== 'previsto') throw new BadRequestException('O título precisa estar previsto');
    const score = scoreMatch(
      { id: mov.id, type: mov.type, amount: num(mov.amount), date: mov.date, description: mov.description, accountId: mov.accountId, texto: '' },
      { id: tit.id, type: tit.type, amount: num(tit.amount), date: tit.date, dueDate: tit.dueDate, description: tit.description, partnerName: null, nomes: [] },
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
      if (movId === titId || mov.matchType || mov.status !== 'realizado' || !ORIGENS_DE_MOVIMENTO.includes(mov.source) ||
          tit.status !== 'previsto' || tit.source === 'asaas' || !['nao_requer', 'aprovado'].includes(tit.approvalStatus))
        throw new BadRequestException('Movimento ou título não está disponível para conciliação.');
      await db.financeTransaction.update({ where: { id: movId }, data: {
        status: 'conciliado', matchScore: Math.round(score * 100) / 100, matchType: tipo, reconciledAt: new Date(),
        chartAccountId: mov.chartAccountId ?? tit.chartAccountId, categoryId: mov.categoryId ?? tit.categoryId,
        partnerId: mov.partnerId ?? tit.partnerId, departamentoId: mov.departamentoId ?? tit.departamentoId,
        projetoId: mov.projetoId ?? tit.projetoId, documentNumber: mov.documentNumber ?? tit.documentNumber,
        contractId: mov.contractId ?? tit.contractId,
      } });
      await db.financeTransaction.delete({ where: { id: titId } });
      // Título que era parcela de acordo "a gerar": o dinheiro entrou por fora do Asaas.
      if (tit.externalId?.startsWith('parc_')) {
        await db.acordoParcela.updateMany({
          where: { orgId, id: tit.externalId.slice('parc_'.length), pagaEm: null },
          data: { pagaEm: mov.date, recebimentoId: movId },
        });
      }
      await this.audit.log({
        orgId, actorId, actorType: 'user', action: 'finance.conciliacao.match',
        entityType: 'finance_transaction', entityId: movId, after: { tituloId: titId, score, tipo },
      }, db);
      await exigirAcessoAtual(db, orgId, actorId, ['financeiro.ver', 'financeiro.conciliar']);
    }, { timeout: 30000 });
  }
}
