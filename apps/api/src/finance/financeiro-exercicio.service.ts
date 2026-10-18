import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FinanceExerciseDecision, type FinanceExerciseObligation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { comContexto } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../approvals/alcada';
import {
  FinanceiroSnapshotSchema, FinanceiroPedidoSchema, FinanceiroRespostaSchema, hashFinanceiro,
  type FinanceiroSnapshot, type FinanceiroPedido, type FinanceiroResposta, type FinanceiroDetalhe,
} from './financeiro-exercicio.contrato';

type Db = Prisma.TransactionClient;
export interface AtorFinanceiro { orgId: string; sub: string }
export function conflitoFinanceiro(code: string, message: string): never {
  throw new ConflictException({ error: code, code, message });
}
function inconsistente(): never {
  return conflitoFinanceiro('financeiro_exercicio_inconsistente', 'O registro do exercício está inconsistente.');
}
export async function exigirPessoaFinanceiraAtual(db: Db, orgId: string, actorId: string, decidir = false) {
  await exigirAcessoAtual(db, orgId, actorId, decidir ? ['financeiro.ver', 'financeiro.editar'] : ['financeiro.ver']);
  const u = await db.user.findFirst({ where: { id: actorId, orgId, isActive: true },
    select: { name: true, roles: { where: { orgId }, select: { key: true, permissions: { select: { key: true } } } } } });
  if (!u) throw new ForbiddenException('Acesso insuficiente.');
  const papeis = u.roles.map(r => r.key), alcada = alcadaDe(papeis);
  const permissions = new Set(u.roles.flatMap(r => r.permissions.map(p => p.key)));
  if (!permissions.has('financeiro.ver') || decidir && !permissions.has('financeiro.editar')) throw new ForbiddenException('Acesso insuficiente.');
  if (decidir && (temPapelDeMaquina(papeis) || !atendeAlcada('responsavel', alcada))) {
    throw new ForbiddenException('A decisão do registro previsto exige uma pessoa com alçada responsável.');
  }
  return { name: u.name, alcada, permissions, maquina: temPapelDeMaquina(papeis) };
}
export async function travarFinanceiro(db: Db, orgId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext('financeiro-exercicio'))`;
}
export async function travarLancamentoFinanceiro(db: Db, orgId: string, id: string) {
  await db.$queryRaw`SELECT "id" FROM "FinanceTransaction" WHERE "orgId"=${orgId} AND "id"=${id} FOR UPDATE`;
}
export async function exigirNaoExercicio(db: Db, orgId: string, transactionId: string) {
  if (await db.financeExerciseObligation.findFirst({ where: { orgId, transactionId }, select: { id: true } }) ||
      await db.commercialExerciseObligation.findFirst({ where: { orgId, transactionId }, select: { id: true } })) {
    conflitoFinanceiro('financeiro_exercicio_alterado', 'Abra o detalhe do exercício para conferir a decisão; o registro não aceita esta alteração.');
  }
}

// Usado pelo serviço e pelo script QA; não inscreve nem altera a fonte.
export async function construirSnapshotFinanceiro(db: Db, orgId: string, transactionId: string, lock = false): Promise<FinanceiroSnapshot> {
  if (lock) await travarLancamentoFinanceiro(db, orgId, transactionId);
  const t = await db.financeTransaction.findFirst({ where: { id: transactionId, orgId } });
  if (!t || !t.contractId || !t.dueDate || !t.partnerId || !t.chartAccountId ||
      t.source !== 'manual' || t.externalId || t.temRateio ||
      await db.transactionSplit.count({ where: { orgId, transactionId } })) inconsistente();
  if (lock) {
    await db.$queryRaw`SELECT "id" FROM "Contract" WHERE "id"=${t.contractId} AND "orgId"=${orgId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id"=${t.accountId} AND "orgId"=${orgId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "Partner" WHERE "id"=${t.partnerId} AND "orgId"=${orgId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "ChartAccount" WHERE "id"=${t.chartAccountId} AND "orgId"=${orgId} FOR SHARE`;
    if (t.projetoId) await db.$queryRaw`SELECT "id" FROM "Projeto" WHERE "id"=${t.projetoId} AND "orgId"=${orgId} FOR SHARE`;
    if (t.departamentoId) await db.$queryRaw`SELECT "id" FROM "Departamento" WHERE "id"=${t.departamentoId} AND "orgId"=${orgId} FOR SHARE`;
  }
  const [c, a, p, ch, projeto, departamento] = await Promise.all([
    db.contract.findFirst({ where: { id: t.contractId, orgId } }),
    db.financeAccount.findFirst({ where: { id: t.accountId, orgId } }),
    db.partner.findFirst({ where: { id: t.partnerId, orgId } }),
    db.chartAccount.findFirst({ where: { id: t.chartAccountId, orgId } }),
    t.projetoId ? db.projeto.findFirst({ where: { id: t.projetoId, orgId } }) : null,
    t.departamentoId ? db.departamento.findFirst({ where: { id: t.departamentoId, orgId } }) : null,
  ]);
  if (!c || !a || !p || !ch || (t.projetoId && !projeto) || (t.departamentoId && !departamento) ||
      a.provider !== 'manual' || !a.isActive || !p.ativo || !ch.ativo || !ch.permiteLancamento ||
      projeto?.ativo === false || departamento?.ativo === false || c.status !== 'ativo' ||
      c.accountId !== a.id || c.partnerId !== p.id || c.chartAccountId !== ch.id ||
      c.tipo !== t.type || !c.valor.eq(t.amount) || !t.amount.greaterThan(0) ||
      t.dueDate < c.dataInicio || c.dataFim && t.dueDate > c.dataFim) inconsistente();
  const result = FinanceiroSnapshotSchema.safeParse({
    schemaVersion: 1, modo: 'exercicio', orgId, transactionId, contractId: c.id,
    origem: { tipo: 'contrato_recorrente_qa', contractId: c.id, descricao: c.descricao,
      vencimentoGerado: t.dueDate.toISOString(), comercial: null },
    condicoes: {
      descricao: t.description, tipo: t.type, valorCanonico: a.currency + ' ' + t.amount.toFixed(2),
      currency: a.currency, competencia: t.date.toISOString(), vencimento: t.dueDate.toISOString(),
      conta: { id: a.id, nome: a.name, currency: a.currency, provider: a.provider, ativa: a.isActive },
      contrato: { id: c.id, descricao: c.descricao, tipo: c.tipo,
        valorCanonico: a.currency + ' ' + c.valor.toFixed(2), diaVencimento: c.diaVencimento,
        periodicidade: c.periodicidade, dataInicio: c.dataInicio.toISOString(),
        dataFim: c.dataFim?.toISOString() ?? null, status: c.status },
      contraparte: { id: p.id, razaoSocial: p.razaoSocial, ativo: p.ativo },
      classificacao: { id: ch.id, codigo: ch.codigo, nome: ch.nome, ativo: ch.ativo, permiteLancamento: ch.permiteLancamento },
      projetoFinanceiro: projeto ? { id: projeto.id, nome: projeto.nome, ativo: projeto.ativo } : null,
      departamento: departamento ? { id: departamento.id, nome: departamento.nome, ativo: departamento.ativo } : null,
      temRateio: false,
    },
  });
  if (!result.success) inconsistente();
  return result.data;
}

@Injectable()
export class FinanceiroExercicioService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  private ambiente() {
    if (process.env.ROOTOS_QA_PREVIEW !== '1') throw new NotFoundException('Obrigação de exercício não encontrada.');
  }
  private contexto<T>(a: AtorFinanceiro, fn: () => Promise<T>) {
    this.ambiente();
    return comContexto({ orgId: a.orgId, actorId: a.sub, actorType: 'user', correlationId: randomUUID(), origem: 'http' }, fn);
  }
  private snapshot(o: FinanceExerciseObligation): FinanceiroSnapshot {
    const r = FinanceiroSnapshotSchema.safeParse(o.snapshot);
    if (!r.success || r.data.orgId !== o.orgId || r.data.transactionId !== o.transactionId ||
        r.data.contractId !== o.contractId || hashFinanceiro(r.data) !== o.contentHash) inconsistente();
    return r.data;
  }
  private receipt(d: FinanceExerciseDecision): FinanceiroResposta {
    const r = FinanceiroRespostaSchema.safeParse(d.response);
    if (!r.success) inconsistente();
    const v = r.data;
    if (v.replayed || v.orgId !== d.orgId || v.decisionId !== d.id || v.decisao.id !== d.id ||
        v.versionId !== d.versionId || v.contentHash !== d.contentHash ||
        v.decisao.versionId !== d.versionId || v.decisao.contentHash !== d.contentHash ||
        v.decisao.requestId !== d.requestId || v.decisao.ator.id !== d.actorId ||
        v.decisao.aprovar !== d.aprovar || v.decisao.motivo !== d.motivo ||
        v.decisao.alcadaVerificada !== d.alcada || v.decisao.decididoEm !== d.createdAt.toISOString() ||
        v.resultado.approvalStatus !== (d.aprovar ? 'aprovado' : 'rejeitado') ||
        hashFinanceiro({ orgId: d.orgId, actorId: d.actorId, transactionId: v.transactionId,
          input: { requestId: d.requestId, versionId: d.versionId, contentHash: d.contentHash,
            expectedUpdatedAt: d.expectedUpdatedAt.toISOString(), aprovar: d.aprovar, motivo: d.motivo } }) !== d.fingerprint) inconsistente();
    return v;
  }
  private async inscricao(db: Db, orgId: string, transactionId: string) {
    const o = await db.financeExerciseObligation.findFirst({ where: { orgId, transactionId } });
    if (!o) throw new NotFoundException('Obrigação de exercício não encontrada.');
    return { o, snapshot: this.snapshot(o) };
  }
  async detalhe(a: AtorFinanceiro, transactionId: string): Promise<FinanceiroDetalhe> {
    return this.contexto(a, () => this.prisma.$transaction(async db => {
      const pessoa = await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub);
      const { o, snapshot } = await this.inscricao(db, a.orgId, transactionId);
      const t = await db.financeTransaction.findFirst({ where: { id: transactionId, orgId: a.orgId } });
      const d = await db.financeExerciseDecision.findFirst({ where: { orgId: a.orgId, obligationId: o.id } });
      const receipt = d ? this.receipt(d) : null;
      if (!t || t.contractId !== o.contractId || t.status !== 'previsto' || t.paidAt || t.reconciledAt ||
          (d && (t.approvalStatus !== receipt!.resultado.approvalStatus || t.approvedById !== d.actorId ||
            t.approvedAt?.toISOString() !== d.createdAt.toISOString() || receipt!.transactionId !== t.id)) ||
          (!d && (t.approvalStatus !== 'aguardando' || t.approvedById || t.approvedAt))) inconsistente();
      let alterada = false;
      try { alterada = hashFinanceiro(await construirSnapshotFinanceiro(db, a.orgId, transactionId)) !== o.contentHash; }
      catch (e) { if (e instanceof ConflictException) alterada = true; else throw e; }
      const current = await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub);
      const pode = current.permissions.has('financeiro.editar') && !current.maquina && atendeAlcada('responsavel', current.alcada);
      const impedimento = d ? 'Esta obrigação já tem uma decisão confirmada.' :
        alterada ? 'As condições atuais divergem do exercício. Confira a origem antes de decidir.' :
        !pode ? 'A decisão exige permissão de edição e alçada responsável vigentes.' : null;
      return {
        modo: 'exercicio', fonte: 'financeiro_local_qa', orgId: a.orgId, consultadoEm: new Date().toISOString(),
        transactionId, versionId: o.versionId, contentHash: o.contentHash, expectedUpdatedAt: t.updatedAt.toISOString(),
        valorCanonico: snapshot.condicoes.valorCanonico, currency: snapshot.condicoes.currency,
        tipo: snapshot.condicoes.tipo, status: 'previsto', approvalStatus: t.approvalStatus as FinanceiroDetalhe['approvalStatus'],
        paidAt: null, reconciledAt: null, conta: snapshot.condicoes.conta, origem: snapshot.origem, condicoes: snapshot.condicoes,
        decisao: receipt?.decisao ?? null, historico: receipt ? [receipt.decisao] : [],
        canDecide: !d && !alterada && pode, alcadaExigida: 'responsavel', alcadaAtual: current.alcada, impedimento,
      };
    }, { timeout: 30000 }));
  }
  async decidir(a: AtorFinanceiro, transactionId: string, body: unknown): Promise<FinanceiroResposta> {
    const input = FinanceiroPedidoSchema.parse(body);
    return this.contexto(a, () => this.prisma.$transaction(async db => {
      await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub, true);
      await travarFinanceiro(db, a.orgId);
      const pessoa = await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub, true);
      const fingerprint = hashFinanceiro({ orgId: a.orgId, actorId: a.sub, transactionId, input });
      const prior = await db.financeExerciseDecision.findFirst({ where: { orgId: a.orgId, requestId: input.requestId } });
      if (prior) {
        const r = this.receipt(prior);
        if (prior.actorId !== a.sub || r.transactionId !== transactionId || prior.fingerprint !== fingerprint) {
          conflitoFinanceiro('financeiro_exercicio_pedido_conflito', 'Este pedido já foi usado com outro conteúdo ou ator.');
        }
        await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub, true);
        return { ...r, replayed: true };
      }
      await travarLancamentoFinanceiro(db, a.orgId, transactionId);
      const { o } = await this.inscricao(db, a.orgId, transactionId);
      if (await db.financeExerciseDecision.findFirst({ where: { orgId: a.orgId, obligationId: o.id } })) {
        conflitoFinanceiro('financeiro_exercicio_ja_decidido', 'Esta obrigação já tem uma decisão confirmada.');
      }
      const t = await db.financeTransaction.findFirst({ where: { id: transactionId, orgId: a.orgId } });
      if (!t || t.contractId !== o.contractId || t.status !== 'previsto' || t.paidAt || t.reconciledAt ||
          t.approvalStatus !== 'aguardando' || t.approvedById || t.approvedAt) inconsistente();
      let atual: FinanceiroSnapshot;
      try { atual = await construirSnapshotFinanceiro(db, a.orgId, transactionId, true); }
      catch (e) {
        if (e instanceof ConflictException) conflitoFinanceiro('financeiro_exercicio_alterado', 'As condições da obrigação mudaram. Confira a origem antes de decidir.');
        throw e;
      }
      if (input.versionId !== o.versionId || input.contentHash !== o.contentHash ||
          input.expectedUpdatedAt !== t.updatedAt.toISOString() || hashFinanceiro(atual) !== o.contentHash) {
        conflitoFinanceiro('financeiro_exercicio_alterado', 'As condições da obrigação mudaram. Atualize o detalhe antes de decidir.');
      }
      const now = new Date(), id = randomUUID();
      const approvalStatus = input.aprovar ? 'aprovado' : 'rejeitado';
      const r: FinanceiroResposta = {
        modo: 'exercicio', orgId: a.orgId, transactionId, decisionId: id, versionId: o.versionId, contentHash: o.contentHash,
        decisao: { id, requestId: input.requestId, versionId: o.versionId, contentHash: o.contentHash,
          ator: { id: a.sub, nome: pessoa.name }, decididoEm: now.toISOString(), aprovar: input.aprovar,
          motivo: input.motivo, alcadaExigida: 'responsavel', alcadaVerificada: pessoa.alcada as 'responsavel' | 'titular' },
        resultado: { status: 'previsto', approvalStatus, paidAt: null, reconciledAt: null,
          pagamentoExecutado: false, cobrancaExecutada: false, conciliacaoExecutada: false }, replayed: false,
      };
      const changed = await db.financeTransaction.updateMany({ where: {
        id: transactionId, orgId: a.orgId, updatedAt: t.updatedAt, approvalStatus: 'aguardando',
        status: 'previsto', paidAt: null, reconciledAt: null, contractId: o.contractId,
      }, data: { approvalStatus, approvedById: a.sub, approvedAt: now } });
      if (changed.count !== 1) conflitoFinanceiro('financeiro_exercicio_alterado', 'A obrigação mudou durante a decisão.');
      await db.financeExerciseDecision.create({ data: {
        id, orgId: a.orgId, obligationId: o.id, requestId: input.requestId, actorId: a.sub, fingerprint,
        versionId: o.versionId, contentHash: o.contentHash, aprovar: input.aprovar, motivo: input.motivo,
        alcada: r.decisao.alcadaVerificada, expectedUpdatedAt: new Date(input.expectedUpdatedAt),
        response: r as unknown as Prisma.InputJsonValue, createdAt: now,
      } });
      await this.audit.log({ orgId: a.orgId, actorId: a.sub, action: 'finance.exercicio.decidir',
        entityType: 'finance_transaction', entityId: transactionId,
        after: { modo: 'exercicio', decisionId: id, requestId: input.requestId,
          versionId: o.versionId, contentHash: o.contentHash, approvalStatus, alcada: r.decisao.alcadaVerificada } }, db);
      const final = await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub, true);
      if (final.alcada !== pessoa.alcada) throw new ForbiddenException('A alçada mudou durante a decisão. Confira novamente.');
      return r;
    }, { timeout: 30000, maxWait: 10000 }));
  }
}
