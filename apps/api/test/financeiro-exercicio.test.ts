import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AcessoAtualGuard } from '../src/memory/acesso-atual.guard';
import { FinanceController } from '../src/finance/finance.controller';
import { FinanceiroExercicioService } from '../src/finance/financeiro-exercicio.service';
import { FinopsService } from '../src/finance/finops.service';
import { AuditService } from '../src/audit/audit.service';
import { AprService, idDoLancamentoDeContrato } from '../src/finance/apr.service';
import { FinanceService } from '../src/finance/finance.service';
import { ConciliacaoService } from '../src/finance/conciliacao.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55582' ||
      !/rootos_.*(write|test|dev|local)/.test(u.pathname)) {
    throw new Error('F08 exige clone descartável próprio e porta local autorizada.');
  }
}
const db = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
const org = 'qa-f08-' + randomUUID();
const otherOrg = 'qa-f08-vizinha-' + randomUUID();
let actor: string, operator: string, reader: string, actor2: string;
let roleResponsible: string;
const prisma = db as unknown as PrismaService;
const audit = new AuditService(prisma);
const apr = new AprService(prisma, audit);
const finance = new FinanceService(prisma, audit,
  { configured: false } as never, { configured: false } as never);
const concil = new ConciliacaoService(prisma, audit);
const due = new Date('2026-11-10T00:00:00.000Z');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function hash(v: unknown) { return createHash('sha256').update(canonical(v)).digest('hex'); }
async function statusOf(p: Promise<unknown>): Promise<number | null> {
  try { await p; return null; }
  catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; }
}
async function fixture(exercise = false) {
  const account = await db.financeAccount.create({ data: {
    orgId: org, name: 'Conta sintética F08', type: 'corrente', currency: 'BRL', provider: 'manual',
  } });
  const partner = await db.partner.create({ data: {
    orgId: org, razaoSocial: 'Fornecedor sintético F08', isFornecedor: true,
  } });
  const chart = await db.chartAccount.create({ data: {
    orgId: org, codigo: randomUUID(), nome: 'Classificação sintética F08',
    tipo: 'despesa', nivel: 3, permiteLancamento: true,
  } });
  const contract = await db.contract.create({ data: {
    orgId: org, accountId: account.id, partnerId: partner.id, chartAccountId: chart.id,
    tipo: 'saida', descricao: 'Contrato recorrente sintético F08', valor: '6000.00',
    diaVencimento: 10, periodicidade: 'mensal', dataInicio: new Date('2026-10-01T00:00:00.000Z'),
    proximoVencimento: new Date('2026-12-10T00:00:00.000Z'),
  } });
  const tx = await db.financeTransaction.create({ data: {
    id: idDoLancamentoDeContrato(org, contract.id, due),
    orgId: org, accountId: account.id, partnerId: partner.id, chartAccountId: chart.id,
    contractId: contract.id, type: 'saida', status: 'previsto', description: contract.descricao,
    amount: '6000.00', date: due, dueDate: due, source: 'manual', approvalStatus: 'aguardando',
  } });
  const snapshot = {
    schemaVersion: 1, modo: 'exercicio', orgId: org, transactionId: tx.id, contractId: contract.id,
    origem: { tipo: 'contrato_recorrente_qa', contractId: contract.id,
      descricao: contract.descricao, vencimentoGerado: due.toISOString(), comercial: null },
    condicoes: {
      descricao: tx.description, tipo: tx.type, valorCanonico: 'BRL 6000.00', currency: 'BRL',
      competencia: tx.date.toISOString(), vencimento: due.toISOString(),
      conta: { id: account.id, nome: account.name, currency: account.currency, provider: 'manual', ativa: account.isActive },
      contrato: { id: contract.id, descricao: contract.descricao, tipo: contract.tipo,
        valorCanonico: 'BRL 6000.00', diaVencimento: contract.diaVencimento,
        periodicidade: contract.periodicidade, dataInicio: contract.dataInicio.toISOString(),
        dataFim: null, status: contract.status },
      contraparte: { id: partner.id, razaoSocial: partner.razaoSocial, ativo: partner.ativo },
      classificacao: { id: chart.id, codigo: chart.codigo, nome: chart.nome,
        ativo: chart.ativo, permiteLancamento: chart.permiteLancamento },
      projetoFinanceiro: null, departamento: null, temRateio: false,
    },
  };
  const obligation = exercise ? await db.financeExerciseObligation.create({ data: {
    orgId: org, transactionId: tx.id, contractId: contract.id, versionId: randomUUID(),
    contentHash: hash(snapshot), snapshot: snapshot as Prisma.InputJsonValue, createdById: actor,
  } }) : null;
  return { tx, account, contract, partner, chart, snapshot, obligation };
}

describe.skipIf(!url)('F08 PG próprio', () => {
  beforeAll(async () => {
    await db.org.create({ data: { id: org, slug: org, name: 'QA F08 própria' } });
    await db.org.create({ data: { id: otherOrg, slug: otherOrg, name: 'QA F08 vizinha própria' } });
    const perms = await db.permission.findMany({ where: { key: { in: ['financeiro.ver', 'financeiro.editar', 'financeiro.conciliar'] } } });
    expect(perms).toHaveLength(3);
    const responsible = await db.role.create({ data: {
      orgId: org, key: 'financeiro', name: 'QA F08 responsável',
      permissions: { connect: perms.map(p => ({ id: p.id })) },
    } });
    roleResponsible = responsible.id;
    const op = await db.role.create({ data: {
      orgId: org, key: 'analista', name: 'QA F08 operador com editar',
      permissions: { connect: perms.map(p => ({ id: p.id })) },
    } });
    const ro = await db.role.create({ data: {
      orgId: org, key: 'consulta_limitada', name: 'QA F08 leitor',
      permissions: { connect: perms.filter(p => p.key === 'financeiro.ver').map(p => ({ id: p.id })) },
    } });
    async function user(role: string, name: string) {
      return (await db.user.create({ data: {
        orgId: org, name, email: randomUUID() + '@qa.invalid', passwordHash: 'fixture-sem-login',
        roles: { connect: { id: role } },
      } })).id;
    }
    actor = await user(responsible.id, 'QA F08 responsável');
    actor2 = await user(responsible.id, 'QA F08 responsável B');
    operator = await user(op.id, 'QA F08 operador');
    reader = await user(ro.id, 'QA F08 leitor');
  });
  afterAll(async () => { await db.$disconnect(); });

  describe('RED legado — reproduzir antes do reparo', () => {
    it('R01 bool legado não decide inscrição sem versão/pedido', async () => {
      const f = await fixture(true);
      expect(await statusOf(apr.approve(org, f.tx.id, true, actor))).toBe(409);
      expect((await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } })).approvalStatus).toBe('aguardando');
    });
    it('R02 operador com editar não tem alçada para approve', async () => {
      const f = await fixture();
      expect(await statusOf(apr.approve(org, f.tx.id, true, operator))).toBe(403);
    });
    it('R03 mesmo ator revogado não decide via serviço legado', async () => {
      const f = await fixture();
      await db.user.update({ where: { id: actor }, data: { roles: { disconnect: { id: roleResponsible } } } });
      try { expect(await statusOf(apr.approve(org, f.tx.id, true, actor))).toBe(403); }
      finally { await db.user.update({ where: { id: actor }, data: { roles: { connect: { id: roleResponsible } } } }); }
    });
    it('R04 falha de audit não deixa approve gravado', async () => {
      const f = await fixture();
      const broken = new AprService(prisma, { log: async () => { throw new Error('QA audit recusado'); } } as unknown as AuditService);
      await expect(broken.approve(org, f.tx.id, true, actor)).rejects.toThrow('QA audit recusado');
      expect((await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } })).approvalStatus).toBe('aguardando');
    });
    it('R05 negativa não é baixada por PATCH direto', async () => {
      const f = await fixture();
      await db.financeTransaction.update({ where: { id: f.tx.id }, data: { approvalStatus: 'rejeitado' } });
      expect(await statusOf(finance.updateTransaction(org, f.tx.id, { status: 'realizado' }, actor))).toBe(400);
      const t = await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } });
      expect(t.status).toBe('previsto'); expect(t.paidAt).toBeNull();
    });
    it('R06 PATCH não altera inscrição imutável de exercício', async () => {
      const f = await fixture(true);
      expect(await statusOf(finance.updateTransaction(org, f.tx.id, { amount: 7000 }, actor))).toBe(409);
    });
    it('R07 conciliação manual não consome título rejeitado', async () => {
      const f = await fixture();
      await db.financeTransaction.update({ where: { id: f.tx.id }, data: { approvalStatus: 'rejeitado' } });
      const mov = await db.financeTransaction.create({ data: {
        orgId: org, accountId: f.account.id, type: 'saida', status: 'realizado',
        source: 'ofx', description: 'Movimento sintético F08', amount: '6000.00', date: due,
      } });
      expect(await statusOf(concil.match(org, mov.id, f.tx.id, actor))).toBe(400);
      expect(await db.financeTransaction.count({ where: { id: f.tx.id } })).toBe(1);
      expect((await db.financeTransaction.findUniqueOrThrow({ where: { id: mov.id } })).status).toBe('realizado');
    });
    it('R08 valor novo não conserva aprovação antiga', async () => {
      const f = await fixture();
      await db.financeTransaction.update({ where: { id: f.tx.id }, data: { approvalStatus: 'aprovado', approvedById: actor, approvedAt: new Date() } });
      expect(await statusOf(finance.updateTransaction(org, f.tx.id, { amount: 7000 }, actor))).toBe(400);
      expect((await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } })).amount.toFixed(2)).toBe('6000.00');
    });
  });

  describe('Exercício versionado', () => {
    const svc = new FinanceiroExercicioService(prisma, audit);
    const a = () => ({ orgId: org, sub: actor });
    async function pedido(f: Awaited<ReturnType<typeof fixture>>, aprovar = true) {
      const d = await svc.detalhe(a(), f.tx.id);
      return { requestId: randomUUID(), versionId: d.versionId, contentHash: d.contentHash,
        expectedUpdatedAt: d.expectedUpdatedAt, aprovar, motivo: 'Decisão sintética conferida no QA' };
    }
    async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
      expect(await db.financeExerciseDecision.count({ where: { orgId: org, obligationId: f.obligation!.id } })).toBe(0);
      const t = await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } });
      expect(t.approvalStatus).toBe('aguardando'); expect(t.status).toBe('previsto');
      expect(t.approvedAt).toBeNull(); expect(t.paidAt).toBeNull();
    }
    it('P01 leitor encontra origem/moeda/versão mas não ganha decisão', async () => {
      const f = await fixture(true);
      const d = await svc.detalhe({ orgId: org, sub: reader }, f.tx.id);
      expect(d).toMatchObject({ orgId: org, transactionId: f.tx.id, versionId: f.obligation!.versionId,
        contentHash: f.obligation!.contentHash, valorCanonico: 'BRL 6000.00', currency: 'BRL',
        status: 'previsto', paidAt: null, canDecide: false, alcadaAtual: null,
        origem: { contractId: f.contract.id, comercial: null } });
      expect(d.condicoes).toEqual(f.snapshot.condicoes);
    });
    it('P02 aprovação/receipt/audit confirmam sem alterar saldo ou DRE', async () => {
      const f = await fixture(true), p = await pedido(f);
      const line = await db.dreLine.create({ data: { orgId: org, codigo: 'QA' + randomUUID(), nome: 'Linha DRE sintética', tipo: 'origem', ordem: 1 } });
      await db.chartAccount.update({ where: { id: f.chart.id }, data: { dreLineId: line.id } });
      await db.financeTransaction.create({ data: { orgId: org, accountId: f.account.id, chartAccountId: f.chart.id, type: 'saida', status: 'realizado', source: 'ofx', description: 'Controle efetivo sintético DRE', amount: '1.00', date: due } });
      const before = await finance.summary(org);
      const dre = new FinopsService(prisma, audit);
      const beforeDre = await dre.dre(org, { month: '2026-11' });
      const r = await svc.decidir(a(), f.tx.id, p);
      expect(r).toMatchObject({ modo: 'exercicio', orgId: org, transactionId: f.tx.id, replayed: false,
        decisao: { ator: { id: actor }, alcadaExigida: 'responsavel', alcadaVerificada: 'responsavel' },
        resultado: { status: 'previsto', approvalStatus: 'aprovado', paidAt: null, reconciledAt: null,
          pagamentoExecutado: false, cobrancaExecutada: false, conciliacaoExecutada: false } });
      expect(await db.auditLog.count({ where: { orgId: org, entityId: f.tx.id, action: 'finance.exercicio.decidir' } })).toBe(1);
      const after = await finance.summary(org);
      expect(after.saldoTotal).toBe(before.saldoTotal); expect(after.mes).toEqual(before.mes);
      const afterDre = await dre.dre(org, { month: '2026-11' });
      expect(beforeDre.lines).toHaveLength(1);
      expect(beforeDre.lines[0].valor).not.toBe(0);
      expect(afterDre.lines).toEqual(beforeDre.lines);
      const d = await svc.detalhe(a(), f.tx.id);
      expect(d.historico).toHaveLength(1); expect(d.decisao!.id).toBe(r.decisionId); expect(d.canDecide).toBe(false);
    });
    it('P03 cinco chamadas concorrentes dão uma decisão e um audit', async () => {
      const f = await fixture(true), p = await pedido(f);
      const responses = await Promise.all(Array.from({ length: 5 }, () => svc.decidir(a(), f.tx.id, p)));
      expect(new Set(responses.map(r => r.decisionId)).size).toBe(1);
      expect(responses.filter(r => !r.replayed)).toHaveLength(1);
      expect(await db.financeExerciseDecision.count({ where: { orgId: org, obligationId: f.obligation!.id } })).toBe(1);
      expect(await db.auditLog.count({ where: { orgId: org, entityId: f.tx.id, action: 'finance.exercicio.decidir' } })).toBe(1);
    });
    it('P04 replay confirmado antecede fonte alterada; pedido novo não herda decisão', async () => {
      const f = await fixture(true), p = await pedido(f);
      const r = await svc.decidir(a(), f.tx.id, p);
      await db.contract.update({ where: { id: f.contract.id }, data: { valor: '7000.00' } });
      const replay = await svc.decidir(a(), f.tx.id, p);
      expect(replay).toEqual({ ...r, replayed: true });
      expect(await statusOf(svc.decidir(a(), f.tx.id, { ...p, requestId: randomUUID() }))).toBe(409);
      const d = await svc.detalhe(a(), f.tx.id);
      expect(d.valorCanonico).toBe('BRL 6000.00'); expect(d.decisao!.id).toBe(r.decisionId);
    });
    it('P05 negativo preserva previsto; approve/PATCH/delete/conciliação não contornam', async () => {
      const f = await fixture(true), p = await pedido(f, false);
      const r = await svc.decidir(a(), f.tx.id, p);
      expect(r.resultado.approvalStatus).toBe('rejeitado');
      expect(await statusOf(apr.approve(org, f.tx.id, true, actor))).toBe(409);
      expect(await statusOf(finance.updateTransaction(org, f.tx.id, { status: 'realizado' }, actor))).toBe(409);
      expect(await statusOf(finance.deleteTransaction(org, f.tx.id, actor))).toBe(409);
      const mov = await db.financeTransaction.create({ data: {
        orgId: org, accountId: f.account.id, type: 'saida', source: 'ofx', status: 'realizado',
        description: 'Movimento sintético', amount: '6000.00', date: due,
      } });
      expect(await statusOf(concil.match(org, mov.id, f.tx.id, actor))).toBe(409);
      const t = await db.financeTransaction.findUniqueOrThrow({ where: { id: f.tx.id } });
      expect(t.status).toBe('previsto'); expect(t.paidAt).toBeNull(); expect(t.reconciledAt).toBeNull();
      expect((await db.financeTransaction.findUniqueOrThrow({ where: { id: mov.id } })).status).toBe('realizado');
      expect((await concil.status(org, f.account.id)).titulos.some(t => t.id === f.tx.id)).toBe(false);
    });
    it('P06 AP/AR identifica pela inscrição, nunca por descrição', async () => {
      const f = await fixture(true), normal = await fixture();
      await db.financeTransaction.update({ where: { id: normal.tx.id }, data: { description: f.tx.description } });
      const rows = (await apr.payables(org, undefined, actor)).items;
      expect(rows.find(r => r.id === f.tx.id)?.exercicioFinanceiro).toBe(true);
      expect(rows.find(r => r.id === normal.tx.id)?.exercicioFinanceiro).toBe(false);
    });
    it.each(['hash', 'versao', 'updatedAt'] as const)('N01 pedido com %s divergente não tem efeito', async field => {
      const f = await fixture(true), p = await pedido(f);
      const altered = { ...p, ...(field === 'hash' ? { contentHash: 'f'.repeat(64) } :
        field === 'versao' ? { versionId: randomUUID() } : { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }) };
      expect(await statusOf(svc.decidir(a(), f.tx.id, altered))).toBe(409); await unchanged(f);
    });
    it.each(['valor', 'moeda', 'conta_inativa', 'origem'] as const)('N02 fonte %s alterada recusa nova decisão', async field => {
      const f = await fixture(true), p = await pedido(f);
      if (field === 'valor') await db.contract.update({ where: { id: f.contract.id }, data: { valor: '7000.00' } });
      if (field === 'moeda') await db.financeAccount.update({ where: { id: f.account.id }, data: { currency: 'USD' } });
      if (field === 'conta_inativa') await db.financeAccount.update({ where: { id: f.account.id }, data: { isActive: false } });
      if (field === 'origem') await db.contract.update({ where: { id: f.contract.id }, data: { descricao: 'Condição diferente' } });
      const d = await svc.detalhe(a(), f.tx.id); expect(d.canDecide).toBe(false);
      expect(d.valorCanonico).toBe('BRL 6000.00');
      expect(await statusOf(svc.decidir(a(), f.tx.id, p))).toBe(409); await unchanged(f);
    });
    it('N03 cross-org e não inscrito recebem 404 sem fonte', async () => {
      const f = await fixture(true), p = await pedido(f);
      const outsider = await db.user.create({ data: {
        orgId: otherOrg, name: 'QA fora', email: randomUUID() + '@qa.invalid', passwordHash: 'fixture',
      } });
      const ps = await db.permission.findMany({ where: { key: { in: ['financeiro.ver', 'financeiro.editar'] } } });
      const role = await db.role.create({ data: { orgId: otherOrg, key: 'financeiro', name: 'QA fora',
        users: { connect: { id: outsider.id } }, permissions: { connect: ps.map(p => ({ id: p.id })) } } });
      expect(role.orgId).toBe(otherOrg);
      expect(await statusOf(svc.detalhe({ orgId: otherOrg, sub: outsider.id }, f.tx.id))).toBe(404);
      expect(await statusOf(svc.decidir({ orgId: otherOrg, sub: outsider.id }, f.tx.id, p))).toBe(404);
      const normal = await fixture();
      expect(await statusOf(svc.detalhe(a(), normal.tx.id))).toBe(404); await unchanged(f);
    });
    it('N04 operador/leitor não decide', async () => {
      const f = await fixture(true), p = await pedido(f);
      expect(await statusOf(svc.decidir({ orgId: org, sub: operator }, f.tx.id, p))).toBe(403);
      expect(await statusOf(svc.decidir({ orgId: org, sub: reader }, f.tx.id, p))).toBe(403); await unchanged(f);
    });
    it('N05 inativação recusa leitura e replay confirmado', async () => {
      const f = await fixture(true), p = await pedido(f), r = await svc.decidir(a(), f.tx.id, p);
      await db.user.update({ where: { id: actor }, data: { isActive: false } });
      try {
        expect(await statusOf(svc.detalhe(a(), f.tx.id))).toBe(403);
        expect(await statusOf(svc.decidir(a(), f.tx.id, p))).toBe(403);
      } finally { await db.user.update({ where: { id: actor }, data: { isActive: true } }); }
      expect((await svc.detalhe(a(), f.tx.id)).decisao!.id).toBe(r.decisionId);
    });
    it('N06 permissão revogada recusa GET, replay e guard AP/AR com claims antigos', async () => {
      const f = await fixture(true), p = await pedido(f); await svc.decidir(a(), f.tx.id, p);
      await db.user.update({ where: { id: actor }, data: { roles: { disconnect: { id: roleResponsible } } } });
      try {
        expect(await statusOf(svc.detalhe(a(), f.tx.id))).toBe(403);
        expect(await statusOf(svc.decidir(a(), f.tx.id, p))).toBe(403);
        const guard = new AcessoAtualGuard(prisma, new Reflector());
        const ctx = { getHandler: () => FinanceController.prototype.payables, getClass: () => FinanceController,
          switchToHttp: () => ({ getRequest: () => ({ user: { orgId: org, sub: actor, permissions: ['financeiro.ver', 'financeiro.editar'] } }) }) };
        expect(await statusOf(guard.canActivate(ctx as never))).toBe(403);
      } finally { await db.user.update({ where: { id: actor }, data: { roles: { connect: { id: roleResponsible } } } }); }
    });
    it.each(['ator', 'payload', 'objeto'] as const)('N07 requestId não é herdado por %s diferente', async field => {
      const f = await fixture(true), p = await pedido(f); await svc.decidir(a(), f.tx.id, p);
      const target = field === 'objeto' ? (await fixture(true)).tx.id : f.tx.id;
      const who = field === 'ator' ? { orgId: org, sub: actor2 } : a();
      expect(await statusOf(svc.decidir(who, target, field === 'payload' ? { ...p, aprovar: false } : p))).toBe(409);
      expect(await db.financeExerciseDecision.count({ where: { orgId: org, requestId: p.requestId } })).toBe(1);
    });
    it('N08 falha de audit reverte decisão, projeção e receipt', async () => {
      const f = await fixture(true), p = await pedido(f);
      const broken = new FinanceiroExercicioService(prisma, { log: async () => { throw new Error('Audit QA falhou'); } } as unknown as AuditService);
      await expect(broken.decidir(a(), f.tx.id, p)).rejects.toThrow('Audit QA falhou'); await unchanged(f);
      const r = await svc.decidir(a(), f.tx.id, p); expect(r.replayed).toBe(false);
    });
    it('N09 revogação confirmada após audit antes do commit reverte tudo', async () => {
      const f = await fixture(true), p = await pedido(f);
      const revoke = { log: async (input: Parameters<AuditService['log']>[0], tx: Prisma.TransactionClient) => {
        await audit.log(input, tx);
        await db.user.update({ where: { id: actor }, data: { roles: { disconnect: { id: roleResponsible } } } });
      } } as unknown as AuditService;
      try { expect(await statusOf(new FinanceiroExercicioService(prisma, revoke).decidir(a(), f.tx.id, p))).toBe(403); }
      finally { await db.user.update({ where: { id: actor }, data: { roles: { connect: { id: roleResponsible } } } }); }
      await unchanged(f);
      expect(await db.auditLog.count({ where: { orgId: org, entityId: f.tx.id, action: 'finance.exercicio.decidir' } })).toBe(0);
    });
    it('N10 registros históricos não aceitam UPDATE ou DELETE', async () => {
      const f = await fixture(true), p = await pedido(f), r = await svc.decidir(a(), f.tx.id, p);
      await expect(db.financeExerciseObligation.update({ where: { id: f.obligation!.id }, data: { contentHash: 'f'.repeat(64) } })).rejects.toThrow();
      await expect(db.financeExerciseObligation.delete({ where: { id: f.obligation!.id } })).rejects.toThrow();
      await expect(db.financeExerciseDecision.update({ where: { id: r.decisionId }, data: { motivo: 'alterado' } })).rejects.toThrow();
      await expect(db.financeExerciseDecision.delete({ where: { id: r.decisionId } })).rejects.toThrow();
      expect((await svc.detalhe(a(), f.tx.id)).decisao!.id).toBe(r.decisionId);
    });
    it('N11 falha de inserção do receipt reverte a projeção', async () => {
      const f = await fixture(true), p = await pedido(f);
      const wrap = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (fn: (t: Prisma.TransactionClient) => unknown, options: unknown) =>
          target.$transaction(tx => fn(new Proxy(tx, { get(t, k) {
            if (k === 'financeExerciseDecision') return new Proxy(t.financeExerciseDecision, { get(m, op) {
              if (op === 'create') return async () => { throw new Error('Receipt QA falhou'); };
              const value = Reflect.get(m, op); return typeof value === 'function' ? value.bind(m) : value;
            } });
            const value = Reflect.get(t, k); return typeof value === 'function' ? value.bind(t) : value;
          } })), options as never);
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
      await expect(new FinanceiroExercicioService(wrap, audit).decidir(a(), f.tx.id, p)).rejects.toThrow('Receipt QA falhou');
      await unchanged(f);
    });
    it('N12 conta de máquina com permissões não tem alçada humana', async () => {
      const ps = await db.permission.findMany({ where: { key: { in: ['financeiro.ver', 'financeiro.editar'] } } });
      const role = await db.role.create({ data: { orgId: org, key: 'ia_servico', name: 'QA máquina', permissions: { connect: ps.map(p => ({ id: p.id })) } } });
      const machine = await db.user.create({ data: {
        orgId: org, name: 'QA máquina', email: randomUUID() + '@qa.invalid', passwordHash: 'fixture',
        roles: { connect: { id: role.id } },
      } });
      const f = await fixture(true), p = await pedido(f);
      expect(await statusOf(svc.decidir({ orgId: org, sub: machine.id }, f.tx.id, p))).toBe(403); await unchanged(f);
    });
    it('N13 snapshot adulterado na inscrição não é servido', async () => {
      const f = await fixture();
      await db.financeExerciseObligation.create({ data: {
        orgId: org, transactionId: f.tx.id, contractId: f.contract.id, versionId: randomUUID(),
        contentHash: 'f'.repeat(64), snapshot: f.snapshot as Prisma.InputJsonValue, createdById: actor,
      } });
      expect(await statusOf(svc.detalhe(a(), f.tx.id))).toBe(409);
    });
    it('N14 corpo não aceita valor alternativo ou baixa', async () => {
      const f = await fixture(true), p = await pedido(f);
      await expect(svc.decidir(a(), f.tx.id, { ...p, amount: 1, status: 'realizado' })).rejects.toThrow();
      await expect(svc.decidir(a(), f.tx.id, { ...p, motivo: '   ' })).rejects.toThrow();
      await unchanged(f);
    });
    it('N15 concorrência oposta grava um sentido e recusa o outro', async () => {
      const f = await fixture(true), p = await pedido(f);
      const rs = await Promise.allSettled([
        svc.decidir(a(), f.tx.id, p),
        svc.decidir(a(), f.tx.id, { ...p, requestId: randomUUID(), aprovar: false }),
      ]);
      expect(rs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = rs.find(r => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason.getStatus()).toBe(409);
      expect(await db.financeExerciseDecision.count({ where: { orgId: org, obligationId: f.obligation!.id } })).toBe(1);
    });
    it('N16 baixa por paidAt também recusa negativa comum', async () => {
      const f = await fixture();
      await db.financeTransaction.update({ where: { id: f.tx.id }, data: { approvalStatus: 'rejeitado' } });
      expect(await statusOf(finance.updateTransaction(org, f.tx.id, { paidAt: new Date().toISOString() }, actor))).toBe(400);
    });
    it('N17 cursor da recorrência não substitui condições nem cria parcela na decisão', async () => {
      const f = await fixture(true), p = await pedido(f);
      await db.contract.update({ where: { id: f.contract.id }, data: { proximoVencimento: new Date('2027-01-10T00:00:00.000Z') } });
      const count = await db.financeTransaction.count({ where: { orgId: org, contractId: f.contract.id } });
      await svc.decidir(a(), f.tx.id, p);
      expect(await db.financeTransaction.count({ where: { orgId: org, contractId: f.contract.id } })).toBe(count);
    });

    it('N18 APAR revogado durante leitura não recebe DTO tardio', async () => {
      await fixture(true);
      const wrapped = new Proxy(prisma, { get(target, key) {
        if (key === 'financeExerciseObligation') return new Proxy(target.financeExerciseObligation, { get(model, method) {
          if (method === 'findMany') return async (args: unknown) => {
            const rows = await model.findMany(args as never);
            await db.user.update({ where: { id: actor }, data: { roles: { disconnect: { id: roleResponsible } } } });
            return rows;
          };
          const value = Reflect.get(model, method); return typeof value === 'function' ? value.bind(model) : value;
        } });
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
      try { expect(await statusOf(new AprService(wrapped, audit).payables(org, undefined, actor))).toBe(403); }
      finally { await db.user.update({ where: { id: actor }, data: { roles: { connect: { id: roleResponsible } } } }); }
    });

    it('N19 leitor interno sem pessoa não encontra inscrição QA nem suas contagens', async () => {
      const f = await fixture(true), normal = await fixture();
      const rows = await apr.payables(org);
      expect(rows.items.some(r => r.id === f.tx.id)).toBe(false);
      expect(rows.items.some(r => r.id === normal.tx.id)).toBe(true);
      expect(rows.items.every(r => r.exercicioFinanceiro === false)).toBe(true);
      expect(rows.total).toBe(rows.items.length);
    });
  });
});
