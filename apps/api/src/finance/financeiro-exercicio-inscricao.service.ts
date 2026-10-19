import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Contract, type FinanceExerciseObligation } from '@prisma/client';
import {
  FinanceiroGeracaoEntradaSchema, FinanceiroGeracaoPedidoSchema, FinanceiroGeracaoPreviaSchema,
  FinanceiroGeracaoRespostaSchema, FinanceiroGeracaoRecuperacaoSchema, type FinanceiroGeracaoRecuperacao,
  type FinanceiroGeracaoEntrada, type FinanceiroGeracaoPedido,
  type FinanceiroGeracaoPrevia, type FinanceiroGeracaoResposta,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { comContexto } from '../common/contexto-execucao';
import { construirSnapshotFinanceiro, conflitoFinanceiro, exigirPessoaFinanceiraAtual, travarFinanceiro,
  type AtorFinanceiro } from './financeiro-exercicio.service';
import { FinanceiroSnapshotSchema, hashFinanceiro } from './financeiro-exercicio.contrato';
import { gerarPrevistoDeContratoNoTx, idDoLancamentoDeContrato, proximoVencimentoDoContrato } from './apr.service';

type Db = Prisma.TransactionClient;
const ORIGEM_MUDOU = 'As condições do contrato mudaram. Confira outra prévia antes de gerar.';
function inconsistente(): never {
  return conflitoFinanceiro('financeiro_exercicio_recibo_inconsistente', 'O recibo da geração não pôde ser conferido.');
}
const fingerprint = (a: AtorFinanceiro, input: FinanceiroGeracaoPedido) =>
  hashFinanceiro({ operation: 'financeiro_exercicio_gerar', orgId: a.orgId, actorId: a.sub, input });

@Injectable()
export class FinanceiroExercicioInscricaoService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private contexto<T>(a: AtorFinanceiro, fn: () => Promise<T>) {
    if (process.env.ROOTOS_QA_PREVIEW !== '1') throw new NotFoundException('Geração de exercício não encontrada.');
    return comContexto({ orgId: a.orgId, actorId: a.sub, actorType: 'user', correlationId: randomUUID(), origem: 'http' }, fn);
  }
  private async pessoa(db: Db, a: AtorFinanceiro) {
    const pessoa = await exigirPessoaFinanceiraAtual(db, a.orgId, a.sub);
    if (!pessoa.permissions.has('financeiro.editar')) throw new ForbiddenException('Acesso insuficiente.');
    return pessoa;
  }

  private async construirPrevia(db: Db, a: AtorFinanceiro, input: FinanceiroGeracaoEntrada, lock: boolean):
    Promise<{ contrato: Contract; previa: FinanceiroGeracaoPrevia }> {
    const pessoa = await this.pessoa(db, a);
    if (lock) await db.$queryRaw`SELECT "id" FROM "Contract" WHERE "orgId"=${a.orgId} AND "id"=${input.contractId} FOR UPDATE`;
    else await db.$queryRaw`SELECT "id" FROM "Contract" WHERE "orgId"=${a.orgId} AND "id"=${input.contractId} FOR SHARE`;
    const c = await db.contract.findFirst({ where: { id: input.contractId, orgId: a.orgId } });
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    const vencimento = new Date(input.vencimento);
    const transactionId = idDoLancamentoDeContrato(a.orgId, c.id, vencimento);
    if (await db.financeTransaction.findFirst({ where: { id: transactionId, orgId: a.orgId }, select: { id: true } })) {
      conflitoFinanceiro('financeiro_exercicio_origem_ja_gerada', 'Este vencimento já foi gerado. Recupere o pedido original; este percurso não inscreve um previsto existente.');
    }
    if (c.status !== 'ativo' || !c.accountId || !c.partnerId || !c.chartAccountId) {
      throw new BadRequestException('O exercício exige contrato ativo com conta manual, contraparte e classificação.');
    }
    if (vencimento.getTime() !== c.proximoVencimento.getTime() || vencimento < c.dataInicio || c.dataFim && vencimento > c.dataFim) {
      conflitoFinanceiro('financeiro_exercicio_origem_alterada', ORIGEM_MUDOU);
    }
    await db.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "orgId"=${a.orgId} AND "id"=${c.accountId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "Partner" WHERE "orgId"=${a.orgId} AND "id"=${c.partnerId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "ChartAccount" WHERE "orgId"=${a.orgId} AND "id"=${c.chartAccountId} FOR SHARE`;
    const [conta, contraparte, classificacao] = await Promise.all([
      db.financeAccount.findFirst({ where: { id: c.accountId, orgId: a.orgId } }),
      db.partner.findFirst({ where: { id: c.partnerId, orgId: a.orgId } }),
      db.chartAccount.findFirst({ where: { id: c.chartAccountId, orgId: a.orgId } }),
    ]);
    if (!conta || !contraparte || !classificacao || conta.provider !== 'manual' || !conta.isActive ||
        !contraparte.ativo || !classificacao.ativo || !classificacao.permiteLancamento || !c.valor.greaterThan(0)) {
      throw new BadRequestException('Confira a conta manual ativa, contraparte, classificação lançável e valor positivo do contrato.');
    }
    const condicoes = {
      descricao: `${c.descricao} (contrato)`, tipo: c.tipo,
      valorCanonico: conta.currency + ' ' + c.valor.toFixed(2), currency: conta.currency,
      competencia: vencimento.toISOString(), vencimento: vencimento.toISOString(),
      conta: { id: conta.id, nome: conta.name, currency: conta.currency, provider: 'manual' as const, ativa: conta.isActive },
      contrato: { id: c.id, descricao: c.descricao, tipo: c.tipo, valorCanonico: conta.currency + ' ' + c.valor.toFixed(2),
        diaVencimento: c.diaVencimento, periodicidade: c.periodicidade, dataInicio: c.dataInicio.toISOString(),
        dataFim: c.dataFim?.toISOString() ?? null, status: c.status },
      contraparte: { id: contraparte.id, razaoSocial: contraparte.razaoSocial, ativo: contraparte.ativo },
      classificacao: { id: classificacao.id, codigo: classificacao.codigo, nome: classificacao.nome,
        ativo: classificacao.ativo, permiteLancamento: classificacao.permiteLancamento },
      projetoFinanceiro: null, departamento: null, temRateio: false as const,
    };
    const proximoVencimento = proximoVencimentoDoContrato(vencimento, c.periodicidade).toISOString();
    const origemHash = hashFinanceiro({ modo: 'exercicio', orgId: a.orgId, actorId: a.sub,
      contractId: c.id, vencimento: input.vencimento, updatedAt: c.updatedAt.toISOString(),
      proximoVencimento, condicoes, alcadaDaDecisao: 'responsavel', alcadaNoPedido: pessoa.alcada });
    const r = FinanceiroGeracaoPreviaSchema.safeParse({
      modo: 'exercicio', orgId: a.orgId, actorId: a.sub, contractId: c.id, vencimento: input.vencimento,
      transactionIdPrevisto: transactionId, proximoVencimento, condicoes,
      marcaOrigem: { updatedAt: c.updatedAt.toISOString(), contentHash: origemHash },
      alcadaDaDecisao: 'responsavel', alcadaNoPedido: pessoa.alcada, status: 'previsto', approvalStatus: 'aguardando',
    });
    if (!r.success) conflitoFinanceiro('financeiro_exercicio_origem_inconsistente', 'As condições do contrato não formam uma prévia válida de exercício.');
    return { contrato: c, previa: r.data };
  }

  private recibo(o: FinanceExerciseObligation): FinanceiroGeracaoResposta {
    const r = FinanceiroGeracaoRespostaSchema.safeParse(o.generationResponse);
    const snapshot = FinanceiroSnapshotSchema.safeParse(o.snapshot);
    if (!r.success || !snapshot.success || !o.requestId || !o.creationFingerprint) inconsistente();
    const v = r.data, s = snapshot.data;
    const pedido: FinanceiroGeracaoPedido = { contractId: v.contractId, vencimento: v.vencimento,
      requestId: v.requestId, marcaOrigem: v.marcaOrigem };
    if (v.replayed || v.orgId !== o.orgId || v.actorId !== o.createdById || v.requestId !== o.requestId ||
        v.obligationId !== o.id || v.transactionId !== o.transactionId || v.contractId !== o.contractId ||
        v.versionId !== o.versionId || v.contentHash !== o.contentHash || v.registradoEm !== o.createdAt.toISOString() ||
        s.orgId !== o.orgId || s.transactionId !== o.transactionId || s.contractId !== o.contractId ||
        hashFinanceiro(s) !== o.contentHash || hashFinanceiro(v.condicoes) !== hashFinanceiro(s.condicoes) ||
        v.vencimento !== s.condicoes.vencimento || v.transactionId !== idDoLancamentoDeContrato(o.orgId, o.contractId, new Date(v.vencimento)) ||
        v.proximoVencimento !== proximoVencimentoDoContrato(new Date(v.vencimento), s.condicoes.contrato.periodicidade).toISOString() ||
        fingerprint({ orgId: o.orgId, sub: o.createdById }, pedido) !== o.creationFingerprint) inconsistente();
    return v;
  }

  async previa(a: AtorFinanceiro, body: unknown): Promise<FinanceiroGeracaoPrevia> {
    const input = FinanceiroGeracaoEntradaSchema.parse(body);
    return this.contexto(a, () => this.prisma.$transaction(async db => {
      const { previa } = await this.construirPrevia(db, a, input, false);
      const final = await this.pessoa(db, a);
      if (final.alcada !== previa.alcadaNoPedido) throw new ForbiddenException('O acesso mudou durante a prévia. Confira novamente.');
      return previa;
    }, { timeout: 30000, maxWait: 10000 }));
  }

  async gerar(a: AtorFinanceiro, body: unknown): Promise<FinanceiroGeracaoResposta> {
    const input = FinanceiroGeracaoPedidoSchema.parse(body);
    return this.contexto(a, () => this.prisma.$transaction(async db => {
      await this.pessoa(db, a);
      await travarFinanceiro(db, a.orgId);
      const pessoa = await this.pessoa(db, a);
      const prior = await db.financeExerciseObligation.findFirst({ where: { orgId: a.orgId, requestId: input.requestId } });
      if (prior) {
        if (prior.createdById !== a.sub || prior.creationFingerprint !== fingerprint(a, input)) {
          conflitoFinanceiro('financeiro_exercicio_pedido_conflito', 'Este pedido já foi usado com outro conteúdo ou pessoa.');
        }
        const r = this.recibo(prior);
        await this.pessoa(db, a);
        return { ...r, replayed: true };
      }
      const { contrato, previa } = await this.construirPrevia(db, a, input, true);
      if (input.marcaOrigem.updatedAt !== previa.marcaOrigem.updatedAt || input.marcaOrigem.contentHash !== previa.marcaOrigem.contentHash) {
        conflitoFinanceiro('financeiro_exercicio_origem_alterada', ORIGEM_MUDOU);
      }
      const gerou = await gerarPrevistoDeContratoNoTx(db, a.orgId, contrato, new Date(input.vencimento), a.sub, 'aguardando');
      if (!gerou) conflitoFinanceiro('financeiro_exercicio_origem_alterada', ORIGEM_MUDOU);
      const snapshot = await construirSnapshotFinanceiro(db, a.orgId, previa.transactionIdPrevisto, true);
      if (hashFinanceiro(snapshot.condicoes) !== hashFinanceiro(previa.condicoes)) {
        conflitoFinanceiro('financeiro_exercicio_origem_alterada', ORIGEM_MUDOU);
      }
      const now = new Date(), obligationId = randomUUID(), versionId = randomUUID(), contentHash = hashFinanceiro(snapshot);
      const r = FinanceiroGeracaoRespostaSchema.parse({
        modo: 'exercicio', orgId: a.orgId, actorId: a.sub, requestId: input.requestId, obligationId,
        contractId: input.contractId, vencimento: input.vencimento, transactionId: previa.transactionIdPrevisto,
        versionId, contentHash, marcaOrigem: previa.marcaOrigem, proximoVencimento: previa.proximoVencimento,
        registradoEm: now.toISOString(), condicoes: previa.condicoes,
        alcadaDaDecisao: 'responsavel', alcadaNoPedido: previa.alcadaNoPedido,
        resultado: { status: 'previsto', approvalStatus: 'aguardando', paidAt: null, reconciledAt: null,
          pagamentoExecutado: false, cobrancaExecutada: false, conciliacaoExecutada: false }, replayed: false,
      });
      await db.financeExerciseObligation.create({ data: {
        id: obligationId, orgId: a.orgId, transactionId: r.transactionId, contractId: input.contractId, versionId, contentHash,
        snapshot: snapshot as unknown as Prisma.InputJsonValue, createdById: a.sub, createdAt: now,
        requestId: input.requestId, creationFingerprint: fingerprint(a, input), generationResponse: r as unknown as Prisma.InputJsonValue,
      } });
      await this.audit.log({ orgId: a.orgId, actorId: a.sub, action: 'finance.exercicio.gerar',
        entityType: 'finance_transaction', entityId: r.transactionId,
        after: { obligationId, requestId: input.requestId, versionId, contentHash,
          originHash: input.marcaOrigem.contentHash, modo: 'exercicio', approvalStatus: 'aguardando' } }, db);
      const final = await this.pessoa(db, a);
      if (final.alcada !== pessoa.alcada) throw new ForbiddenException('O acesso mudou durante a geração. Confira novamente.');
      return r;
    }, { timeout: 30000, maxWait: 10000 }));
  }

  async porPedido(a: AtorFinanceiro, requestId: string): Promise<FinanceiroGeracaoRecuperacao> {
    const id = FinanceiroGeracaoPedidoSchema.shape.requestId.parse(requestId);
    return this.contexto(a, () => this.prisma.$transaction(async db => {
      await this.pessoa(db, a);
      await travarFinanceiro(db, a.orgId);
      await this.pessoa(db, a);
      const o = await db.financeExerciseObligation.findFirst({ where: { orgId: a.orgId, requestId: id } });
      if (o && o.createdById !== a.sub) throw new ForbiddenException('Acesso insuficiente.');
      const resultado: FinanceiroGeracaoRecuperacao = o
        ? { estado: 'confirmado', orgId: a.orgId, actorId: a.sub, requestId: id,
          recibo: { ...this.recibo(o), replayed: true } }
        : { estado: 'ausencia_conferida', orgId: a.orgId, actorId: a.sub, requestId: id };
      await this.pessoa(db, a);
      return FinanceiroGeracaoRecuperacaoSchema.parse(resultado);
    }, { timeout: 30000, maxWait: 10000 }));
  }
}
