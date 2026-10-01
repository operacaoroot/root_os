import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, FinanceTxType } from '@prisma/client';
import type {
  PartnerList, DimensionList, ContractList, Payables, PayableRow,
  CreatePartnerInput, CreateDimensionInput, CreateContractInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
   * Gera o lançamento previsto do vencimento atual do contrato e avança o vencimento.
   *
   * Avançar, criar o lançamento e auditar vão numa transação só, e o avanço só
   * acontece se a linha do contrato ainda é a que foi lida: mesmo vencimento,
   * ativo, sem outra alteração no meio. Duas chamadas que leram o mesmo
   * vencimento disputam a mesma linha; a segunda espera a primeira terminar,
   * não acha mais o que leu e ouve 409 sem gravar nada. Falha em qualquer passo
   * desfaz os três.
   *
   * O 409 não deve ser repetido automaticamente: a rota não tem chave de
   * idempotência, e uma chamada nova gera o vencimento seguinte.
   */
  async gerarContrato(orgId: string, id: string, actorId: string) {
    const c = await this.prisma.contract.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Contrato não encontrado');
    if (c.status !== 'ativo') throw new BadRequestException('Contrato não está ativo');
    if (!c.accountId) throw new BadRequestException('Contrato sem conta bancária definida');
    // Contrato gravado antes desta conferência pode apontar para cadastro de outra empresa.
    await conferirReferencias(this.prisma, orgId, { conta: c.accountId, plano: c.chartAccountId, parceiro: c.partnerId });

    const accountId = c.accountId;
    const venc = c.proximoVencimento;
    const next = addMonths(venc, PERIOD_MONTHS[c.periodicidade] ?? 1);
    const requiresApproval = c.tipo === 'saida' && num(c.valor) > APPROVAL_LIMIT();
    const tx = await this.prisma.$transaction(async (db) => {
      const avancou = await db.contract.updateMany({
        where: { id: c.id, orgId, status: 'ativo', proximoVencimento: venc, updatedAt: c.updatedAt },
        data: { proximoVencimento: next },
      });
      if (avancou.count !== 1) {
        throw new ConflictException('Este vencimento do contrato já foi gerado por outra chamada. Atualize a lista antes de gerar o próximo.');
      }
      const lancamento = await db.financeTransaction.create({
        data: {
          orgId, accountId, chartAccountId: c.chartAccountId, partnerId: c.partnerId, contractId: c.id,
          type: c.tipo, status: 'previsto', description: `${c.descricao} (contrato)`,
          amount: c.valor, date: venc, dueDate: venc, source: 'manual',
          approvalStatus: requiresApproval ? 'aguardando' : 'nao_requer',
        },
      });
      // A mesma linha que `AuditService.log` grava, mas pelo cliente da
      // transação: fora dela, uma falha aqui deixaria lançamento sem auditoria.
      await db.auditLog.create({
        data: {
          orgId, actorId, action: 'finance.contract.generate', entityType: 'contract', entityId: c.id,
          after: { transactionId: lancamento.id, vencimento: venc.toISOString() },
        },
      });
      return lancamento;
    });
    return { ok: true, transactionId: tx.id, proximoVencimento: next.toISOString() };
  }

  // ---------- Contas a pagar / receber (previstos) ----------
  async payables(orgId: string, tipo?: string): Promise<Payables> {
    const now = new Date();
    const where: Prisma.FinanceTransactionWhereInput = { orgId, status: 'previsto' };
    if (tipo === 'pagar') where.type = 'saida';
    if (tipo === 'receber') where.type = 'entrada';
    const rows = await this.prisma.financeTransaction.findMany({
      where, orderBy: [{ dueDate: 'asc' }, { date: 'asc' }], take: 500,
      include: { partner: { select: { razaoSocial: true } }, chartAccount: { select: { codigo: true } } },
    });
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
        status: r.status, approvalStatus: r.approvalStatus, vencido, diasAtraso: dias,
      };
    });
    return {
      items, total: rows.length,
      totals: { aPagar, aReceber, vencidoPagar, vencidoReceber, aguardandoAprovacao: aguardando },
      approvalLimit: APPROVAL_LIMIT(),
      source: this.meta(),
    };
  }

  // ---------- Aprovação ----------
  async approve(orgId: string, id: string, aprovar: boolean, actorId: string) {
    const tx = await this.prisma.financeTransaction.findFirst({ where: { id, orgId } });
    if (!tx) throw new NotFoundException('Lançamento não encontrado');
    if (tx.approvalStatus !== 'aguardando') throw new BadRequestException('Lançamento não está aguardando aprovação');
    const updated = await this.prisma.financeTransaction.update({
      where: { id },
      data: { approvalStatus: aprovar ? 'aprovado' : 'rejeitado', approvedById: actorId, approvedAt: new Date() },
    });
    await this.audit.log({
      orgId, actorId, action: aprovar ? 'finance.approve' : 'finance.reject',
      entityType: 'finance_transaction', entityId: id, after: { approvalStatus: updated.approvalStatus },
    });
    return { ok: true, approvalStatus: updated.approvalStatus };
  }
}
