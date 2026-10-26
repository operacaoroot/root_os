import { createHash } from 'node:crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, FinanceTxType, type Contract, type ApprovalStatus } from '@prisma/client';
import type {
  PartnerList, DimensionList, ContractList, Payables, PayableRow,
  CreatePartnerInput, CreateDimensionInput, CreateContractInput,
  GerarContratoInput, GerarContratoResposta,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { exigirPessoaFinanceiraAtual, travarFinanceiro, travarLancamentoFinanceiro, exigirNaoExercicio } from './financeiro-exercicio.service';

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));
export const APPROVAL_LIMIT = (): number => Number(process.env.FINANCE_APPROVAL_LIMIT ?? 5000);

const PERIOD_MONTHS: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

function addMonths(d: Date, m: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + m);
  return r;
}
function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400_000);
}

const NAO_ENCONTRADO = {
  conta: 'Conta não encontrada',
  categoria: 'Categoria não encontrada',
  plano: 'Conta do plano de contas não encontrada',
  parceiro: 'Parceiro (fornecedor/cliente) não encontrado',
  contrato: 'Contrato não encontrado',
  departamento: 'Departamento não encontrado',
  projeto: 'Projeto não encontrado',
} as const;
type Referencia = keyof typeof NAO_ENCONTRADO;

/** Ids que um pedido do Financeiro aponta, por tipo. Nulo ou ausente não é conferido. */
export type ReferenciasFinanceiras = Partial<Record<Referencia, string | null | undefined | Array<string | null | undefined>>>;

function quantasDaEmpresa(prisma: PrismaService, tipo: Referencia, orgId: string, ids: string[]): Promise<number> {
  const where = { orgId, id: { in: ids } };
  switch (tipo) {
    case 'conta': return prisma.financeAccount.count({ where });
    case 'categoria': return prisma.financeCategory.count({ where });
    case 'plano': return prisma.chartAccount.count({ where });
    case 'parceiro': return prisma.partner.count({ where });
    case 'contrato': return prisma.contract.count({ where });
    case 'departamento': return prisma.departamento.count({ where });
    case 'projeto': return prisma.projeto.count({ where });
  }
}

/**
 * Confere, antes de qualquer escrita, que cada id do pedido é desta empresa.
 *
 * A chave estrangeira só garante que o id existe em alguma empresa, e a API
 * conecta como dona das tabelas, que o isolamento por linha não alcança. Id de
 * outra empresa recebe o mesmo 404 de um id que não existe: uma resposta
 * diferente diria a quem pergunta que aquele id existe na vizinha. Nenhum
 * caminho troca a empresa de um cadastro, então conferir antes de gravar basta.
 */
export async function conferirReferencias(prisma: PrismaService, orgId: string, refs: ReferenciasFinanceiras): Promise<void> {
  for (const tipo of Object.keys(NAO_ENCONTRADO) as Referencia[]) {
    const ids = [...new Set([refs[tipo]].flat().filter((id): id is string => !!id))];
    if (ids.length && (await quantasDaEmpresa(prisma, tipo, orgId, ids)) !== ids.length) {
      throw new NotFoundException(NAO_ENCONTRADO[tipo]);
    }
  }
}

/**
 * Id do lançamento que a geração grava para um vencimento do contrato.
 *
 * O mesmo contrato e o mesmo vencimento dão sempre o mesmo id: o pedido
 * repetido acha o lançamento que o primeiro gravou, e a chave primária recusa
 * um segundo. O vencimento entra pelo ISO em UTC, então duas grafias do mesmo
 * instante dão o mesmo id. A construção é a de `idNativo` no importador do
 * ClickUp (`prisma/import-clickup-work.contract.ts`): 16 bytes do sha256 com os
 * bits de versão e variante de UUID.
 */
export function idDoLancamentoDeContrato(orgId: string, contractId: string, vencimento: Date): string {
  const bytes = createHash('sha256')
    .update(`${orgId}\0lancamento-de-contrato\0${contractId}\0${vencimento.toISOString()}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function proximoVencimentoDoContrato(vencimento: Date, periodicidade: string): Date {
  return addMonths(vencimento, PERIOD_MONTHS[periodicidade] ?? 1);
}

/** Composição interna: a transação do chamador também pode inscrever o exercício. */
export async function gerarPrevistoDeContratoNoTx(db: Prisma.TransactionClient, orgId: string, c: Contract,
  vencimento: Date, actorId: string, approvalStatus: ApprovalStatus): Promise<boolean> {
  if (c.orgId !== orgId) throw new NotFoundException('Contrato não encontrado');
  const transactionId = idDoLancamentoDeContrato(orgId, c.id, vencimento);
  const avancou = await db.contract.updateMany({
    where: { id: c.id, orgId, status: 'ativo', proximoVencimento: c.proximoVencimento, updatedAt: c.updatedAt },
    data: { proximoVencimento: proximoVencimentoDoContrato(vencimento, c.periodicidade) },
  });
  if (avancou.count !== 1) return false;
  if (!c.accountId) throw new BadRequestException('Contrato sem conta bancária definida');
  await db.financeTransaction.create({ data: {
    id: transactionId, orgId, accountId: c.accountId, chartAccountId: c.chartAccountId, partnerId: c.partnerId, contractId: c.id,
    type: c.tipo, status: 'previsto', description: `${c.descricao} (contrato)`,
    amount: c.valor, date: vencimento, dueDate: vencimento, source: 'manual', approvalStatus,
  } });
  await db.auditLog.create({ data: {
    orgId, actorId, action: 'finance.contract.generate', entityType: 'contract', entityId: c.id,
    after: { transactionId, vencimento: vencimento.toISOString() },
  } });
  return true;
}

const VENCIMENTO_NAO_E_O_PROXIMO = 'O vencimento pedido não é o próximo deste contrato. Atualize a lista antes de gerar.';
const CONTRATO_MUDOU = 'O contrato mudou durante a geração. Atualize a lista e tente de novo.';

// AP/AR (contas a pagar/receber): fornecedores/clientes, dimensões de rateio,
// contratos recorrentes e o fluxo de aprovação por limite. Enxerto do FinOps5.0.
@Injectable()
export class AprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private meta() {
    return { tool: 'banco-interno', generatedAt: new Date().toISOString() };
  }

  // ---------- Parceiros (fornecedores/clientes) ----------
  async listPartners(orgId: string, papel?: string): Promise<PartnerList> {
    const where: Prisma.PartnerWhereInput = { orgId };
    if (papel === 'cliente') where.isCliente = true;
    if (papel === 'fornecedor') where.isFornecedor = true;
    const rows = await this.prisma.partner.findMany({ where, orderBy: [{ razaoSocial: 'asc' }] });
    return {
      items: rows.map((p) => ({
        id: p.id, isCliente: p.isCliente, isFornecedor: p.isFornecedor, razaoSocial: p.razaoSocial,
        nomeFantasia: p.nomeFantasia, cnpjCpf: p.cnpjCpf, email: p.email, phone: p.phone, ativo: p.ativo,
      })),
      total: rows.length,
      source: this.meta(),
    };
  }

  async createPartner(orgId: string, input: CreatePartnerInput, actorId: string) {
    const p = await this.prisma.partner.create({
      data: {
        orgId, razaoSocial: input.razaoSocial, nomeFantasia: input.nomeFantasia ?? null,
        cnpjCpf: input.cnpjCpf ?? null, email: input.email ?? null, phone: input.phone ?? null,
        isCliente: input.isCliente ?? false, isFornecedor: input.isFornecedor ?? false,
      },
    });
    await this.audit.log({ orgId, actorId, action: 'finance.partner.create', entityType: 'partner', entityId: p.id, after: { razaoSocial: p.razaoSocial } });
    return { ok: true, id: p.id };
  }

  /** Layout 26/10: renomear o cadastro (razão social e/ou nome fantasia). Só o nome muda; o antes fica na auditoria. */
  async renomearPartner(orgId: string, id: string, corpo: unknown, actorId: string) {
    const c = (corpo ?? {}) as { razaoSocial?: unknown; nomeFantasia?: unknown };
    const limpo = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : undefined);
    const razaoSocial = limpo(c.razaoSocial);
    const nomeFantasia = c.nomeFantasia === null ? null : limpo(c.nomeFantasia);
    if (razaoSocial === '') throw new BadRequestException('O nome do cadastro não pode ficar vazio.');
    if (razaoSocial === undefined && nomeFantasia === undefined) throw new BadRequestException('Diga o novo nome.');
    const antes = await this.prisma.partner.findFirst({ where: { id, orgId }, select: { razaoSocial: true, nomeFantasia: true } });
    if (!antes) throw new NotFoundException('Cadastro não encontrado.');
    const data = {
      ...(razaoSocial !== undefined ? { razaoSocial } : {}),
      ...(nomeFantasia !== undefined ? { nomeFantasia: nomeFantasia || null } : {}),
    };
    await this.prisma.partner.updateMany({ where: { id, orgId }, data });
    await this.audit.log({ orgId, actorId, action: 'finance.partner.rename', entityType: 'partner', entityId: id, before: antes, after: data });
    return { ok: true, id };
  }

  // ---------- Dimensões (departamentos / projetos) ----------
  async listDimensions(orgId: string, kind: 'departamento' | 'projeto'): Promise<DimensionList> {
    const rows = kind === 'departamento'
      ? await this.prisma.departamento.findMany({ where: { orgId }, orderBy: [{ nome: 'asc' }] })
      : await this.prisma.projeto.findMany({ where: { orgId }, orderBy: [{ nome: 'asc' }] });
    return {
      items: rows.map((r) => ({ id: r.id, nome: r.nome, ativo: r.ativo })),
      total: rows.length,
      source: this.meta(),
    };
  }

  async createDimension(orgId: string, kind: 'departamento' | 'projeto', input: CreateDimensionInput, actorId: string) {
    const data = { orgId, nome: input.nome };
    const r = kind === 'departamento'
      ? await this.prisma.departamento.create({ data })
      : await this.prisma.projeto.create({ data });
    await this.audit.log({ orgId, actorId, action: `finance.${kind}.create`, entityType: kind, entityId: r.id, after: { nome: r.nome } });
    return { ok: true, id: r.id };
  }

  // ---------- Contratos recorrentes ----------
  async listContracts(orgId: string): Promise<ContractList> {
    const rows = await this.prisma.contract.findMany({
      where: { orgId }, orderBy: [{ proximoVencimento: 'asc' }], include: { partner: { select: { razaoSocial: true } } },
    });
    return {
      items: rows.map((c) => ({
        id: c.id, tipo: c.tipo, partnerId: c.partnerId, partnerName: c.partner?.razaoSocial ?? null,
        descricao: c.descricao, valor: num(c.valor), diaVencimento: c.diaVencimento, periodicidade: c.periodicidade,
        chartAccountId: c.chartAccountId, accountId: c.accountId,
        dataInicio: c.dataInicio.toISOString(), dataFim: c.dataFim ? c.dataFim.toISOString() : null,
        proximoVencimento: c.proximoVencimento.toISOString(), status: c.status,
      })),
      total: rows.length,
      source: this.meta(),
    };
  }

  async createContract(orgId: string, input: CreateContractInput, actorId: string) {
    const inicio = new Date(input.dataInicio);
    if (isNaN(inicio.getTime())) throw new BadRequestException('dataInicio inválida');
    const prox = new Date(inicio.getFullYear(), inicio.getMonth(), Math.min(input.diaVencimento, 28));
    if (prox < inicio) prox.setMonth(prox.getMonth() + 1);
    await conferirReferencias(this.prisma, orgId, { conta: input.accountId, plano: input.chartAccountId, parceiro: input.partnerId });
    const c = await this.prisma.contract.create({
      data: {
        orgId, tipo: input.tipo as FinanceTxType, partnerId: input.partnerId ?? null, descricao: input.descricao,
        valor: new Prisma.Decimal(input.valor), diaVencimento: input.diaVencimento, periodicidade: input.periodicidade ?? 'mensal',
        chartAccountId: input.chartAccountId ?? null, accountId: input.accountId ?? null,
        dataInicio: inicio, dataFim: input.dataFim ? new Date(input.dataFim) : null, proximoVencimento: prox,
      },
    });
    await this.audit.log({ orgId, actorId, action: 'finance.contract.create', entityType: 'contract', entityId: c.id, after: { descricao: c.descricao, valor: num(c.valor) } });
    return { ok: true, id: c.id };
  }

  /**
   * Gera o lançamento previsto de um vencimento do contrato e avança o vencimento.
   *
   * Quem chama diz qual vencimento quer, e o lançamento dele tem id fixo
   * (`idDoLancamentoDeContrato`). Se esse lançamento já existe, a resposta é a
   * mesma da chamada que o gerou, com `replayed: true`, sem escrita nem
   * auditoria nova: é o caso da resposta que se perdeu depois do commit e do
   * segundo clique. Vencimento que não é o próximo do contrato e não tem
   * lançamento recebe 409.
   *
   * Avançar, criar o lançamento e auditar vão numa transação só, e o avanço só
   * acontece se a linha do contrato ainda é a que foi lida: mesmo vencimento,
   * ativo, sem outra alteração no meio. Duas chamadas pelo mesmo vencimento
   * disputam a mesma linha; a segunda espera a primeira terminar, não acha mais
   * o que leu e devolve o lançamento que a primeira gravou. Falha em qualquer
   * passo desfaz os três.
   */
  async gerarContrato(orgId: string, id: string, input: GerarContratoInput, actorId: string): Promise<GerarContratoResposta> {
    const venc = new Date(input.vencimento);
    if (isNaN(venc.getTime())) throw new BadRequestException('vencimento inválido');
    const c = await this.prisma.contract.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Contrato não encontrado');

    const transactionId = idDoLancamentoDeContrato(orgId, c.id, venc);
    const next = proximoVencimentoDoContrato(venc, c.periodicidade);
    const resposta = { ok: true as const, transactionId, proximoVencimento: next.toISOString() };
    // Antes das conferências de status e conta: o lançamento gravado continua
    // valendo mesmo que o contrato tenha sido pausado depois.
    if (await this.jaGerado(orgId, transactionId)) return { ...resposta, replayed: true };
    if (venc.getTime() !== c.proximoVencimento.getTime()) throw new ConflictException(VENCIMENTO_NAO_E_O_PROXIMO);
    if (c.status !== 'ativo') throw new BadRequestException('Contrato não está ativo');
    if (!c.accountId) throw new BadRequestException('Contrato sem conta bancária definida');
    // Contrato gravado antes desta conferência pode apontar para cadastro de outra empresa.
    await conferirReferencias(this.prisma, orgId, { conta: c.accountId, plano: c.chartAccountId, parceiro: c.partnerId });

    const requiresApproval = c.tipo === 'saida' && num(c.valor) > APPROVAL_LIMIT();
    try {
      const gerou = await this.prisma.$transaction(db => gerarPrevistoDeContratoNoTx(
        db, orgId, c, venc, actorId, requiresApproval ? 'aguardando' : 'nao_requer',
      ));
      if (gerou) return { ...resposta, replayed: false };
    } catch (e) {
      // Chave primária repetida: outra chamada gravou este vencimento entre a conferência e o INSERT.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    // Quem perde a corrida pelo mesmo vencimento acha aqui o lançamento de quem ganhou.
    if (await this.jaGerado(orgId, transactionId)) return { ...resposta, replayed: true };
    throw new ConflictException(CONTRATO_MUDOU);
  }

  private async jaGerado(orgId: string, transactionId: string): Promise<boolean> {
    return (await this.prisma.financeTransaction.count({ where: { id: transactionId, orgId } })) > 0;
  }

  // ---------- Contas a pagar / receber (previstos) ----------
  async payables(orgId: string, tipo?: string, actorId?: string): Promise<Payables> {
    if (actorId) await exigirAcessoAtual(this.prisma, orgId, actorId, ['financeiro.ver']);
    const ocultos = actorId ? [] : [...await this.prisma.financeExerciseObligation.findMany({ where: { orgId }, select: { transactionId: true } }),
      ...await this.prisma.commercialExerciseObligation.findMany({ where: { orgId }, select: { transactionId: true } })];
    const now = new Date();
    const where: Prisma.FinanceTransactionWhereInput = { orgId, status: 'previsto', ...(actorId ? {} : { id: { notIn: ocultos.map(o => o.transactionId) } }) };
    if (tipo === 'pagar') where.type = 'saida';
    if (tipo === 'receber') where.type = 'entrada';
    const rows = await this.prisma.financeTransaction.findMany({
      where, orderBy: [{ dueDate: 'asc' }, { date: 'asc' }], take: 500,
      include: { partner: { select: { razaoSocial: true } }, chartAccount: { select: { codigo: true } } },
    });
    const inscritos = await this.prisma.financeExerciseObligation.findMany({ where: { orgId, transactionId: { in: rows.map(r => r.id) } }, select: { transactionId: true } });
    const exercicios = new Set(inscritos.map(o => o.transactionId));
    const comerciais = new Set((await this.prisma.commercialExerciseObligation.findMany({ where: { orgId, transactionId: { in: rows.map(r => r.id) } }, select: { transactionId: true } })).map(o => o.transactionId));
    let aPagar = 0, aReceber = 0, vencidoPagar = 0, vencidoReceber = 0, aguardando = 0;
    const items: PayableRow[] = rows.map((r) => {
      const v = num(r.amount);
      const due = r.dueDate ?? r.date;
      const vencido = due < now;
      const dias = vencido ? daysBetween(now, due) : 0;
      if (r.type === 'saida') { aPagar += v; if (vencido) vencidoPagar += v; }
      else { aReceber += v; if (vencido) vencidoReceber += v; }
      if (r.approvalStatus === 'aguardando') aguardando += 1;
      return {
        id: r.id, tipo: r.type, description: r.description, partnerName: r.partner?.razaoSocial ?? null,
        chartCodigo: r.chartAccount?.codigo ?? null, amount: v, dueDate: due.toISOString(),
        status: r.status, approvalStatus: r.approvalStatus, exercicioFinanceiro: exercicios.has(r.id),
        ...{ exercicioComercial: comerciais.has(r.id), exercicioComercialHref: comerciais.has(r.id) ? `/finance/exercicio/comercial/obrigacoes/${r.id}` : null }, vencido, diasAtraso: dias,
      };
    });
    if (actorId) await exigirAcessoAtual(this.prisma, orgId, actorId, ['financeiro.ver']);
    return {
      items, total: rows.length,
      totals: { aPagar, aReceber, vencidoPagar, vencidoReceber, aguardandoAprovacao: aguardando },
      approvalLimit: APPROVAL_LIMIT(),
      source: this.meta(),
    };
  }

  // ---------- Aprovação ----------
  async approve(orgId: string, id: string, aprovar: boolean, actorId: string) {
    return this.prisma.$transaction(async db => {
      await exigirPessoaFinanceiraAtual(db, orgId, actorId, true);
      await travarFinanceiro(db, orgId);
      await travarLancamentoFinanceiro(db, orgId, id);
      await exigirNaoExercicio(db, orgId, id);
      const tx = await db.financeTransaction.findFirst({ where: { id, orgId } });
      if (!tx) throw new NotFoundException('Lançamento não encontrado');
      if (tx.status !== 'previsto' || tx.paidAt || tx.reconciledAt || tx.approvalStatus !== 'aguardando')
        throw new BadRequestException('Lançamento não está aguardando aprovação prevista');
      const now = new Date();
      const approvalStatus = aprovar ? 'aprovado' : 'rejeitado';
      const changed = await db.financeTransaction.updateMany({
        where: { id, orgId, updatedAt: tx.updatedAt, approvalStatus: 'aguardando', status: 'previsto' },
        data: { approvalStatus, approvedById: actorId, approvedAt: now },
      });
      if (changed.count !== 1) throw new ConflictException('O lançamento mudou durante a decisão.');
      await this.audit.log({
        orgId, actorId, action: aprovar ? 'finance.approve' : 'finance.reject',
        entityType: 'finance_transaction', entityId: id, after: { approvalStatus },
      }, db);
      await exigirPessoaFinanceiraAtual(db, orgId, actorId, true);
      return { ok: true, approvalStatus };
    }, { timeout: 30000 });
  }
}
