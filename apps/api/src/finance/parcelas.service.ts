import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AsaasFinancialTransaction, AsaasPayment } from './asaas.service';
import {
  acordoDaCobranca, chavesDoAcordo, documentoComoChave, escolherParcela, nomeCasa, ordemDasParcelas, parcelaMaisPerto,
  type AcordoCandidato, type ParcelaCandidata,
} from './parcelas';

/*
 * PARCELAS DO ACORDO (29/10/2026): o Financeiro como dado ligado.
 *
 * A parcela é o que o contrato manda receber. Sem cobrança, ela entra no fluxo
 * como o previsto `parc_<id>`. A cobrança do Asaas que chega VESTE a parcela
 * (`asaasPaymentId`): o previsto passa a ser o `pay_<id>` do sync, e não nasce
 * uma segunda linha. O recebimento do extrato com o mesmo `paymentId` concilia
 * pelo id e marca a parcela como paga. As funções soltas são as que o sync do
 * Asaas chama, dentro da mesma passagem; o serviço é o das telas.
 */

type Db = PrismaService | Prisma.TransactionClient;
const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));
const dia = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const PREFIXO = 'parc_';

/** "<Produto> - <Cliente> - Parcela n/N", o padrão de nome de cobrança da Root (29/10/2026). */
export function nomeDaParcela(a: { produto: string; cliente: string }, numero: number, total: number): string {
  const produto = a.produto.replace(/\s*\(.*\)\s*$/, '').trim();
  return `${produto} - ${a.cliente} - Parcela ${numero}/${total}`;
}

interface Livre extends ParcelaCandidata { partnerId: string | null; acordoId: string }
interface PrevistoDeContrato extends ParcelaCandidata { contractId: string; partnerId: string | null }
interface AcordoParaVestir extends AcordoCandidato { partnerId: string | null; proximoNumero: number }

export interface Vestir {
  /** Parcelas já vestidas, por id da cobrança. */
  porPagamento: Map<string, { id: string; partnerId: string | null; pagaEm: Date | null }>;
  livres: Livre[];
  /** Acordos pagantes: a cobrança que é de um deles e não acha parcela cria a sua. */
  acordos: AcordoParaVestir[];
  previstosDeContrato: PrevistoDeContrato[];
  /** Contratos recorrentes de entrada: a mensalidade deles é conta fixa, nunca parcela de acordo. */
  contratosDeEntrada: Array<{ id: string; valor: number; chaves: string[]; partnerId: string | null }>;
}

/** Uma vez por passagem do sync: as parcelas livres e os previstos de contrato que uma cobrança pode vestir. */
export async function prepararVestir(db: Db, orgId: string): Promise<Vestir> {
  const linhas = await db.acordoComercial.findMany({
    where: { orgId },
    select: {
      id: true, cliente: true, apelidos: true, tipo: true, partnerId: true, partner: { select: { cnpjCpf: true } },
      parcelas: { select: { id: true, numero: true, valor: true, vencimento: true, asaasPaymentId: true, pagaEm: true } },
    },
  });
  const porPagamento: Vestir['porPagamento'] = new Map();
  const livres: Livre[] = [];
  const acordos: AcordoParaVestir[] = [];
  for (const a of linhas) {
    // Cliente é a empresa do contrato: o CNPJ dela casa mesmo quando o Asaas mostra o nome da pessoa.
    const chavesNome = chavesDoAcordo(a);
    const chavesDoc = documentoComoChave(a.partner?.cnpjCpf);
    if (a.tipo === 'pagante') {
      acordos.push({ id: a.id, chavesNome, chavesDoc, partnerId: a.partnerId, proximoNumero: Math.max(0, ...a.parcelas.map((p) => p.numero)) + 1 });
    }
    for (const p of a.parcelas) {
      if (p.asaasPaymentId) porPagamento.set(p.asaasPaymentId, { id: p.id, partnerId: a.partnerId, pagaEm: p.pagaEm });
      else if (!p.pagaEm) livres.push({ id: p.id, acordoId: a.id, valor: num(p.valor), vencimento: p.vencimento, chaves: [...chavesNome, ...chavesDoc], partnerId: a.partnerId });
    }
  }
  // O previsto que um contrato recorrente de ENTRADA gerou também é vestido pela cobrança
  // (Curral: o contrato gera no dia 6, o Asaas cobra no dia 10; é a mesma mensalidade).
  const doContrato = await db.financeTransaction.findMany({
    where: { orgId, status: 'previsto', type: 'entrada', contractId: { not: null }, source: { not: 'asaas' } },
    select: {
      id: true, amount: true, dueDate: true, date: true, contractId: true, partnerId: true,
      partner: { select: { razaoSocial: true, nomeFantasia: true, cnpjCpf: true, acordos: { select: { cliente: true, apelidos: true } } } },
    },
  });
  type Parceiro = { razaoSocial: string; nomeFantasia: string | null; cnpjCpf: string | null; acordos: Array<{ cliente: string; apelidos: string | null }> } | null;
  const chavesDoParceiro = (pa: Parceiro) => [
    // "Curral (Marcelo Alves Meroto)": o nome entre parênteses é quem paga no Asaas.
    ...chavesDoAcordo({ cliente: pa?.razaoSocial ?? '', apelidos: [pa?.nomeFantasia, /\(([^)]+)\)/.exec(pa?.razaoSocial ?? '')?.[1]].filter(Boolean).join(',') }),
    ...(pa?.acordos ?? []).flatMap(chavesDoAcordo),
    ...documentoComoChave(pa?.cnpjCpf),
  ];
  const previstosDeContrato = doContrato.map((t) => ({
    id: t.id, valor: num(t.amount), vencimento: t.dueDate ?? t.date, contractId: t.contractId!, partnerId: t.partnerId,
    chaves: chavesDoParceiro(t.partner),
  }));
  const contratos = await db.contract.findMany({
    where: { orgId, tipo: 'entrada', status: 'ativo' },
    select: { id: true, valor: true, partnerId: true, partner: { select: { razaoSocial: true, nomeFantasia: true, cnpjCpf: true, acordos: { select: { cliente: true, apelidos: true } } } } },
  });
  const contratosDeEntrada = contratos.map((c) => ({ id: c.id, valor: num(c.valor), partnerId: c.partnerId, chaves: chavesDoParceiro(c.partner) }));
  return { porPagamento, livres, acordos, previstosDeContrato, contratosDeEntrada };
}

export interface Vestimenta { parcelaId: string | null; contractId: string | null; partnerId: string | null }

/**
 * A cobrança aberta veste uma parcela (ou o previsto de um contrato). Grava a
 * ligação e apaga o previsto que ela substitui; devolve o que o `pay_` herda.
 *
 * Regra do Lucas (29/10/2026): o que está no Asaas entra no OS sozinho. A
 * cobrança que é de um acordo e não acha parcela livre CRIA a parcela; a parcela
 * vestida acompanha o valor e o vencimento da cobrança, porque o Asaas manda.
 */
export async function vestirCobranca(db: Db, orgId: string, v: Vestir, p: AsaasPayment, textoDoPagador: string | null): Promise<Vestimenta> {
  const vence = dia(p.originalDueDate || p.dueDate || p.dateCreated || new Date().toISOString());
  const valor = new Prisma.Decimal(p.value);
  const ja = v.porPagamento.get(p.id);
  if (ja) {
    if (!ja.pagaEm) {
      await db.acordoParcela.updateMany({
        where: { id: ja.id, OR: [{ valor: { not: valor } }, { vencimento: { not: vence } }] },
        data: { valor, vencimento: vence },
      });
    }
    return { parcelaId: ja.id, contractId: null, partnerId: ja.partnerId };
  }
  const texto = `${textoDoPagador ?? ''} ${p.description ?? ''}`;
  const cobranca = { valor: p.value, vence, texto };
  // A parcela livre de mesmo valor e nome vem primeiro.
  let parcela = escolherParcela(cobranca, v.livres);
  // Mensalidade (assinatura do Asaas, ou o valor de um contrato de entrada do mesmo
  // cliente) é conta fixa: veste o previsto do contrato e nunca cria parcela de acordo.
  const doContrato = parcela ? null : escolherParcela(cobranca, v.previstosDeContrato);
  if (doContrato) {
    await db.financeTransaction.deleteMany({ where: { orgId, id: doContrato.id, status: 'previsto' } });
    v.previstosDeContrato.splice(v.previstosDeContrato.indexOf(doContrato), 1);
    return { parcelaId: null, contractId: doContrato.contractId, partnerId: doContrato.partnerId };
  }
  const contrato = parcela ? null : v.contratosDeEntrada.find((c) => Math.abs(c.valor - p.value) < 0.01 && nomeCasa(c.chaves, texto));
  if (contrato) return { parcelaId: null, contractId: contrato.id, partnerId: contrato.partnerId };
  if (!parcela && p.subscription) return { parcelaId: null, contractId: null, partnerId: null };
  // Depois, a parcela do acordo com o vencimento mais perto (o valor pode ter mudado no
  // Asaas); e, sem nenhuma, a cobrança cria a parcela no acordo.
  const acordo = acordoDaCobranca(texto, v.acordos);
  parcela ??= acordo ? parcelaMaisPerto(vence, v.livres.filter((l) => l.acordoId === acordo.id)) : null;
  if (parcela) {
    await db.acordoParcela.update({ where: { id: parcela.id }, data: { asaasPaymentId: p.id, valor, vencimento: vence } });
    await db.financeTransaction.deleteMany({ where: { orgId, externalId: `${PREFIXO}${parcela.id}`, status: 'previsto' } });
    v.livres.splice(v.livres.indexOf(parcela), 1);
    v.porPagamento.set(p.id, { id: parcela.id, partnerId: parcela.partnerId, pagaEm: null });
    return { parcelaId: parcela.id, contractId: null, partnerId: parcela.partnerId };
  }
  if (acordo) {
    const nova = await db.acordoParcela.create({
      data: { orgId, acordoId: acordo.id, numero: acordo.proximoNumero++, valor, vencimento: vence, asaasPaymentId: p.id },
    });
    v.porPagamento.set(p.id, { id: nova.id, partnerId: acordo.partnerId, pagaEm: null });
    return { parcelaId: nova.id, contractId: null, partnerId: acordo.partnerId };
  }
  return { parcelaId: null, contractId: null, partnerId: null };
}

/**
 * Conciliação pelo id: a linha do extrato que traz o `paymentId` de uma cobrança
 * conhecida não precisa de pontuação. O recebimento marca a parcela como paga e
 * herda o cliente; a taxa da mesma cobrança sai da fila de conciliação.
 */
export async function conciliarPeloId(
  db: Db, orgId: string, v: Vestir, t: AsaasFinancialTransaction,
  linha: { id: string; partnerId: string | null; contractId: string | null; status: string; matchType: string | null },
): Promise<void> {
  if (!t.paymentId || linha.matchType || linha.status !== 'realizado') return;
  let parcela = v.porPagamento.get(t.paymentId);
  if (!parcela && t.value > 0) {
    // Cobrança criada e paga entre duas passagens: o OS nunca a viu aberta. O
    // recebimento veste a parcela pelo mesmo critério (nome, valor, data).
    const livre = escolherParcela({ valor: t.value, vence: dia(t.date), texto: t.description ?? '' }, v.livres);
    if (livre) {
      await db.acordoParcela.update({ where: { id: livre.id }, data: { asaasPaymentId: t.paymentId } });
      v.livres.splice(v.livres.indexOf(livre), 1);
      parcela = { id: livre.id, partnerId: livre.partnerId, pagaEm: null };
      v.porPagamento.set(t.paymentId, parcela);
    }
  }
  const previsto = parcela ? null : await db.financeTransaction.findFirst({
    where: { orgId, externalId: `pay_${t.paymentId}` }, select: { partnerId: true, contractId: true },
  });
  if (t.value > 0) {
    if (parcela && !parcela.pagaEm) {
      await db.acordoParcela.updateMany({ where: { id: parcela.id, pagaEm: null }, data: { pagaEm: dia(t.date), recebimentoId: linha.id } });
      parcela.pagaEm = dia(t.date);
    }
    if (!parcela && !previsto) return; // cobrança que o OS nunca viu: fica para a conciliação de sempre
  }
  await db.financeTransaction.update({
    where: { id: linha.id },
    data: {
      status: 'conciliado', matchType: 'asaas-id', matchScore: 1, reconciledAt: new Date(),
      ...(t.value > 0 && !linha.partnerId ? { partnerId: parcela?.partnerId ?? previsto?.partnerId ?? null } : {}),
      ...(t.value > 0 && !linha.contractId && previsto?.contractId ? { contractId: previsto.contractId } : {}),
    },
  });
}

const PAGA = new Set(['RECEIVED', 'RECEIVED_IN_CASH', 'CONFIRMED', 'DUNNING_RECEIVED']);

/**
 * A cobrança vestida que saiu do aberto: paga (sem linha no extrato, como a
 * recebida em dinheiro) marca a parcela; apagada ou estornada solta a parcela,
 * que volta ao fluxo como "cobrança a gerar".
 */
export async function fecharParcelasQueSairam(
  db: Db, orgId: string, v: Vestir, abertos: Set<string>, consultar: (id: string) => Promise<AsaasPayment | null>,
): Promise<void> {
  for (const [paymentId, parcela] of v.porPagamento) {
    if (parcela.pagaEm || abertos.has(paymentId)) continue;
    const p = await consultar(paymentId);
    if (!p) continue; // o Asaas não respondeu: tenta na próxima passagem
    if (!p.deleted && p.status && PAGA.has(p.status)) {
      const quando = p.paymentDate || p.clientPaymentDate || p.dueDate || new Date().toISOString();
      await db.acordoParcela.updateMany({ where: { id: parcela.id, pagaEm: null }, data: { pagaEm: dia(quando) } });
      parcela.pagaEm = dia(quando);
    } else {
      await db.acordoParcela.updateMany({ where: { id: parcela.id, asaasPaymentId: paymentId, pagaEm: null }, data: { asaasPaymentId: null } });
      v.porPagamento.delete(paymentId);
    }
  }
}

/**
 * Cada parcela sem cobrança e não paga tem o seu previsto `parc_<id>`; o resto não.
 * O previsto baixado à mão (ou conciliado) marca a parcela como paga.
 */
export async function materializarParcelas(db: Db, orgId: string): Promise<void> {
  const conta = (await db.financeAccount.findFirst({ where: { orgId, provider: 'asaas' }, select: { id: true } }))
    ?? (await db.financeAccount.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  const parcelas = await db.acordoParcela.findMany({
    where: { orgId },
    include: { acordo: { select: { cliente: true, produto: true, partnerId: true } } },
  });
  const ordem = ordemDasParcelas(parcelas);
  const linhas = await db.financeTransaction.findMany({
    where: { orgId, externalId: { startsWith: PREFIXO } },
    select: { id: true, externalId: true, status: true, amount: true, dueDate: true, date: true, paidAt: true, description: true, partnerId: true },
  });
  const porExterno = new Map(linhas.map((l) => [l.externalId!, l]));
  const vistas = new Set<string>();
  for (const p of parcelas) {
    const ext = `${PREFIXO}${p.id}`;
    vistas.add(ext);
    const linha = porExterno.get(ext);
    if (linha && linha.status !== 'previsto') {
      if (!p.pagaEm) await db.acordoParcela.update({ where: { id: p.id }, data: { pagaEm: linha.paidAt ?? linha.date, recebimentoId: linha.id } });
      continue;
    }
    if (p.asaasPaymentId || p.pagaEm) {
      if (linha) await db.financeTransaction.deleteMany({ where: { id: linha.id, status: 'previsto' } });
      continue;
    }
    if (!conta) continue;
    const o = ordem.get(p.id)!;
    const dados = {
      description: nomeDaParcela(p.acordo, o.n, o.total),
      amount: p.valor, date: p.vencimento, dueDate: p.vencimento, partnerId: p.acordo.partnerId,
    };
    if (!linha) {
      await db.financeTransaction.create({
        data: { ...dados, orgId, accountId: conta.id, type: 'entrada', status: 'previsto', source: 'acordo', externalId: ext },
      });
    } else if (
      linha.description !== dados.description || num(linha.amount) !== num(p.valor) ||
      (linha.dueDate ?? linha.date).getTime() !== p.vencimento.getTime() || linha.partnerId !== dados.partnerId
    ) {
      await db.financeTransaction.update({ where: { id: linha.id }, data: dados });
    }
  }
  // Previsto de parcela que não existe mais (apagada no acordo).
  const orfas = linhas.filter((l) => !vistas.has(l.externalId!) && l.status === 'previsto').map((l) => l.id);
  if (orfas.length) await db.financeTransaction.deleteMany({ where: { orgId, id: { in: orfas }, status: 'previsto' } });
}

// ---------------------------------------------------------------- telas ----

export const ParcelasInputSchema = z.object({
  parcelas: z.array(z.object({
    numero: z.number().int().min(1).max(240),
    valor: z.number().positive(),
    vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pagaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notaFiscal: z.string().trim().max(60).nullable().optional(),
  })).max(240),
});
export type ParcelasInput = z.infer<typeof ParcelasInputSchema>;

export type EstadoDaParcela = 'paga' | 'cobranca_gerada' | 'a_gerar';
export interface ParcelaDaTela {
  id: string; numero: number; posicao: number; valor: number; vencimento: string; pagaEm: string | null;
  asaasPaymentId: string | null; notaFiscal: string | null; estado: EstadoDaParcela; vencida: boolean;
  /** Da cobrança no Asaas: quando o dinheiro cai e quanto (no cartão, o líquido na data de crédito). */
  caiEm: string | null; liquido: number | null;
}
export interface ParcelaSemCobranca {
  id: string; acordoId: string; cliente: string; produto: string; numero: number; total: number;
  valor: number; vencimento: string; diasParaVencer: number; descricao: string;
}
export interface Atrasado { id: string; descricao: string; quem: string | null; valor: number; vencimento: string; diasDeAtraso: number; origem: 'asaas' | 'acordo' | 'manual' }
export interface NfPendente { id: string; acordoId: string; descricao: string; valor: number; vencimento: string; pagaEm: string | null; cobrancaGerada: boolean }
export interface ContaQueMudou { id: string; descricao: string; tipo: 'entrada' | 'saida'; valorDoContrato: number; ultimoValor: number; ultimoEm: string }
export interface SemPlano { id: string; data: string; tipo: 'entrada' | 'saida'; descricao: string; quem: string | null; valor: number }
export interface Rotina { aGerar: ParcelaSemCobranca[]; atrasados: Atrasado[]; nfPendente: NfPendente[]; contasQueMudaram: ContaQueMudou[]; semPlano: SemPlano[] }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hoje = () => dia(new Date(Date.now() - 3 * 3600_000).toISOString()); // dia em Brasília

function daTela(
  p: { id: string; numero: number; valor: Prisma.Decimal; vencimento: Date; pagaEm: Date | null; asaasPaymentId: string | null; notaFiscal: string | null },
  posicao: number, cobranca?: { caiEm: Date | null; liquido: number },
): ParcelaDaTela {
  const estado: EstadoDaParcela = p.pagaEm ? 'paga' : p.asaasPaymentId ? 'cobranca_gerada' : 'a_gerar';
  const caiEm = cobranca?.caiEm ?? null;
  return {
    id: p.id, numero: p.numero, posicao, valor: num(p.valor), vencimento: iso(p.vencimento), pagaEm: p.pagaEm ? iso(p.pagaEm) : null,
    asaasPaymentId: p.asaasPaymentId, notaFiscal: p.notaFiscal, estado,
    // Cartão aprovado não está "vencido": o cliente já pagou, falta o Asaas repassar.
    vencida: !p.pagaEm && (caiEm ?? p.vencimento) < hoje(),
    caiEm: caiEm ? iso(caiEm) : null, liquido: cobranca ? cobranca.liquido : null,
  };
}

@Injectable()
export class ParcelasService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async acordo(orgId: string, acordoId: string) {
    const a = await this.prisma.acordoComercial.findFirst({ where: { id: acordoId, orgId }, select: { id: true, cliente: true, produto: true } });
    if (!a) throw new NotFoundException('Acordo não encontrado.');
    return a;
  }

  async listar(orgId: string, acordoId: string): Promise<{ parcelas: ParcelaDaTela[] }> {
    await this.acordo(orgId, acordoId);
    const rows = await this.prisma.acordoParcela.findMany({ where: { orgId, acordoId }, orderBy: [{ vencimento: 'asc' }, { numero: 'asc' }] });
    const ids = rows.map((p) => p.asaasPaymentId).filter((x): x is string => !!x).map((x) => `pay_${x}`);
    const cobrancas = ids.length
      ? await this.prisma.financeTransaction.findMany({ where: { orgId, externalId: { in: ids }, status: 'previsto' }, select: { externalId: true, dueDate: true, amount: true } })
      : [];
    const porCobranca = new Map(cobrancas.map((c) => [c.externalId!.slice(4), { caiEm: c.dueDate, liquido: num(c.amount) }]));
    return { parcelas: rows.map((p, i) => daTela(p, i + 1, p.asaasPaymentId ? porCobranca.get(p.asaasPaymentId) : undefined)) };
  }

  /**
   * O plano de parcelas do acordo, inteiro. A parcela já vestida por uma cobrança
   * ou já paga não perde o que o Asaas e o extrato disseram: dela só muda a data
   * de pagamento informada à mão. As outras são criadas, trocadas ou apagadas.
   */
  async definir(orgId: string, acordoId: string, input: ParcelasInput, actorId: string): Promise<{ parcelas: ParcelaDaTela[]; mantidas: number[] }> {
    await this.acordo(orgId, acordoId);
    const numeros = input.parcelas.map((p) => p.numero);
    if (new Set(numeros).size !== numeros.length) throw new BadRequestException('Número de parcela repetido.');
    const mantidas: number[] = [];
    await this.prisma.$transaction(async (db) => {
      const atuais = await db.acordoParcela.findMany({ where: { orgId, acordoId } });
      const porNumero = new Map(atuais.map((p) => [p.numero, p]));
      for (const p of input.parcelas) {
        const atual = porNumero.get(p.numero);
        const pagaEm = p.pagaEm ? dia(p.pagaEm) : null;
        const notaFiscal = p.notaFiscal?.trim() || null;
        if (!atual) {
          await db.acordoParcela.create({ data: { orgId, acordoId, numero: p.numero, valor: new Prisma.Decimal(p.valor), vencimento: dia(p.vencimento), pagaEm, notaFiscal } });
        } else if (atual.asaasPaymentId || atual.recebimentoId) {
          await db.acordoParcela.update({ where: { id: atual.id }, data: { notaFiscal, ...(!atual.pagaEm && pagaEm ? { pagaEm } : {}) } });
          if (num(atual.valor) !== p.valor || iso(atual.vencimento) !== p.vencimento) mantidas.push(p.numero);
        } else {
          await db.acordoParcela.update({ where: { id: atual.id }, data: { valor: new Prisma.Decimal(p.valor), vencimento: dia(p.vencimento), pagaEm, notaFiscal } });
        }
      }
      for (const atual of atuais) {
        if (numeros.includes(atual.numero)) continue;
        if (atual.asaasPaymentId || atual.recebimentoId) { mantidas.push(atual.numero); continue; }
        await db.acordoParcela.delete({ where: { id: atual.id } });
      }
      await materializarParcelas(db, orgId);
      await this.audit.log({
        orgId, actorId, action: 'finance.acordo.parcelas', entityType: 'acordo_comercial', entityId: acordoId,
        after: { parcelas: input.parcelas.length, mantidas },
      }, db);
    }, { timeout: 30000 });
    return { ...(await this.listar(orgId, acordoId)), mantidas };
  }

  /**
   * A rotina da semana, numa tela: o que falta cobrar no Asaas, o que venceu e não
   * entrou, a NF que falta emitir e a conta fixa que veio com valor diferente.
   */
  async rotina(orgId: string): Promise<Rotina> {
    const h = hoje();
    const em15 = new Date(h.getTime() + 15 * 86400_000);
    const ha60 = new Date(h.getTime() - 60 * 86400_000);
    const ha90 = new Date(h.getTime() - 90 * 86400_000);
    const [aGerar, vencidos, semNf, contratos, semPlano] = await Promise.all([
      this.semCobranca(orgId),
      this.prisma.financeTransaction.findMany({
        where: { orgId, status: 'previsto', type: 'entrada', OR: [{ dueDate: { lt: h } }, { dueDate: null, date: { lt: h } }] },
        orderBy: [{ dueDate: 'asc' }],
        select: { id: true, description: true, counterparty: true, amount: true, dueDate: true, date: true, source: true, partner: { select: { razaoSocial: true } } },
      }),
      this.prisma.acordoParcela.findMany({
        where: {
          orgId, notaFiscal: null,
          // A NF sai mês a mês: só o que foi pago há pouco ou vence nos próximos 15 dias.
          OR: [{ pagaEm: { gte: ha60 } }, { pagaEm: null, vencimento: { lte: em15 } }],
        },
        orderBy: { vencimento: 'asc' },
        include: { acordo: { select: { id: true, cliente: true, produto: true } } },
      }),
      this.prisma.contract.findMany({
        where: { orgId, status: 'ativo' },
        select: {
          id: true, descricao: true, tipo: true, valor: true,
          transactions: { where: { status: { in: ['realizado', 'conciliado'] } }, orderBy: { date: 'desc' }, take: 1, select: { amount: true, date: true } },
        },
      }),
      // O que aconteceu nos últimos 90 dias sem plano de contas: não entra na DRE certa e pesa na estimativa.
      this.prisma.financeTransaction.findMany({
        where: { orgId, status: { in: ['realizado', 'conciliado'] }, chartAccountId: null, temRateio: false, date: { gte: ha90 } },
        orderBy: { date: 'desc' }, take: 100,
        select: { id: true, date: true, type: true, description: true, counterparty: true, amount: true, partner: { select: { razaoSocial: true } } },
      }),
    ]);
    const ordem = await this.ordem(orgId);
    return {
      aGerar: aGerar.parcelas,
      atrasados: vencidos.map((t) => {
        const venc = t.dueDate ?? t.date;
        return {
          id: t.id, descricao: t.description, quem: t.partner?.razaoSocial ?? t.counterparty, valor: num(t.amount),
          vencimento: iso(venc), diasDeAtraso: Math.round((h.getTime() - venc.getTime()) / 86400_000),
          origem: t.source === 'asaas' ? 'asaas' : t.source === 'acordo' ? 'acordo' : 'manual',
        };
      }),
      nfPendente: semNf.map((p) => ({
        id: p.id, acordoId: p.acordo.id, descricao: nomeDaParcela(p.acordo, ordem.get(p.id)?.n ?? p.numero, ordem.get(p.id)?.total ?? p.numero), valor: num(p.valor),
        vencimento: iso(p.vencimento), pagaEm: p.pagaEm ? iso(p.pagaEm) : null, cobrancaGerada: !!p.asaasPaymentId,
      })),
      // Valor diferente em mais de 1% (e mais de R$ 1): a conta subiu, caiu ou a de dólar variou.
      contasQueMudaram: contratos.flatMap((c) => {
        const u = c.transactions[0];
        if (!u) return [];
        const contrato = num(c.valor), ultimo = num(u.amount);
        if (Math.abs(ultimo - contrato) <= Math.max(1, contrato * 0.01)) return [];
        return [{ id: c.id, descricao: c.descricao, tipo: c.tipo, valorDoContrato: contrato, ultimoValor: ultimo, ultimoEm: iso(u.date) }];
      }),
      semPlano: semPlano.map((t) => ({
        id: t.id, data: iso(t.date), tipo: t.type, descricao: t.description, quem: t.partner?.razaoSocial ?? t.counterparty, valor: num(t.amount),
      })),
    };
  }

  /** "Quais cobranças eu estou deixando passar": parcela sem cobrança no Asaas e ainda não paga. */
  async semCobranca(orgId: string): Promise<{ parcelas: ParcelaSemCobranca[] }> {
    const rows = await this.prisma.acordoParcela.findMany({
      where: { orgId, asaasPaymentId: null, pagaEm: null },
      orderBy: { vencimento: 'asc' },
      include: { acordo: { select: { id: true, cliente: true, produto: true } } },
    });
    const ordem = await this.ordem(orgId);
    const h = hoje().getTime();
    return {
      parcelas: rows.map((p) => {
        const o = ordem.get(p.id) ?? { n: p.numero, total: p.numero };
        return {
          id: p.id, acordoId: p.acordo.id, cliente: p.acordo.cliente, produto: p.acordo.produto, numero: o.n,
          total: o.total, valor: num(p.valor), vencimento: iso(p.vencimento),
          diasParaVencer: Math.round((p.vencimento.getTime() - h) / 86400_000),
          descricao: nomeDaParcela(p.acordo, o.n, o.total),
        };
      }),
    };
  }

  /** A posição de cada parcela no seu acordo, pela ordem dos vencimentos. */
  private async ordem(orgId: string) {
    return ordemDasParcelas(await this.prisma.acordoParcela.findMany({ where: { orgId }, select: { id: true, acordoId: true, vencimento: true, numero: true } }));
  }
}
