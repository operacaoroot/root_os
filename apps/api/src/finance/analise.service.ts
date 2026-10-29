import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { FinanceService } from './finance.service';
import { materializarParcelas } from './parcelas.service';
import { ehReceita, grupoDaSaida, mesAMes, mesDe, mesesAte, naturezaDaConta, naturezaEmUso, partesDaSaida, partesDoMes, type ContaDoPlano, type Movimento } from './mes-a-mes';

/*
 * ANÁLISE DO FINANCEIRO
 *
 * Junta, numa leitura só, o que o financeiro sabe (caixa, previstos, contratos
 * recorrentes, para onde foi o dinheiro mês a mês) com o que ele não sabe sozinho: os ACORDOS comerciais. Um
 * acordo diz quanto foi vendido ou entregue a um cliente e de que tipo é
 * (pagante, permuta, repasse, parceria). É a única forma de mostrar "quanto
 * deveria ter entrado" ao lado de "quanto entrou".
 *
 * O recebido de um acordo é casado pelo extrato: entradas cujo favorecido ou
 * descrição contêm o nome do cliente ou um dos apelidos do acordo.
 *
 * A leitura da IA recebe só estes números (nunca o extrato inteiro) e fica
 * guardada por dia e por conjunto de números: reabrir a aba não gasta modelo.
 */

export const TIPOS_DE_ACORDO = ['pagante', 'permuta', 'repasse', 'parceria'] as const;

/** Layout 26/10: "AAAA-MM" vira o dia 1 do mês; undefined = não mexe; null = sem data. */
function diaDoFechamento(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(`${v.length === 7 ? `${v}-01` : v}T12:00:00.000Z`);
}

export const AcordoInputSchema = z.object({
  cliente: z.string().trim().min(1).max(120),
  produto: z.string().trim().min(1).max(120),
  valor: z.number().nonnegative(),
  tipo: z.enum(TIPOS_DE_ACORDO),
  observacao: z.string().trim().max(300).nullable().optional(),
  apelidos: z.string().trim().max(300).nullable().optional(),
  // Integração 26/10: o cliente do Financeiro deste acordo (nulo = ainda não ligado).
  partnerId: z.string().uuid().nullable().optional(),
  // Layout 26/10: quando o acordo fechou (AAAA-MM ou AAAA-MM-DD); alimenta "Contratos fechados por mês" do Comercial.
  fechadoEm: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).nullable().optional(),
});
export const AcordoUpdateSchema = AcordoInputSchema.partial();
export const LeituraInputSchema = z.object({ refazer: z.boolean().optional() }).default({});

const POR_MES: Record<string, number> = { mensal: 1, bimestral: 1 / 2, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 };
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;
const DIA = 86400_000;

const SISTEMA = `Você é o analista financeiro da ROOT, uma consultoria pequena de três sócios que ainda opera no CNPJ MEI de um deles.
Quem lê não é do financeiro: escreva em português do Brasil simples, sem jargão (nada de EBITDA, DRE, margem de contribuição).
Recebe um JSON com os números do momento. Devolva de 3 a 5 observações, cada uma numa linha começando com "- ".
Cada observação: um fato com número (em R$ ou meses) e, quando couber, uma ação concreta em seguida, depois de " → ".
Priorize: caixa e fôlego, o que deveria ter entrado e não entrou, peso das parcerias/permutas sobre o que foi entregue,
dependência de um cliente só, contas recorrentes contra receita recorrente, custo da operação × despesa da estrutura (fixo, variável, eventual)
nos últimos meses (em mesAMes; o mês atual ainda não fechou), pendências de dado que distorcem a leitura.
Não invente número que não está no JSON. Não repita o mesmo ponto. Sem introdução e sem conclusão.`;

@Injectable()
export class AnaliseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fin: FinanceService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  // ---------------- acordos ----------------
  /** Integração 26/10: o cliente escolhido no acordo tem de ser desta empresa. */
  private async clienteDaEmpresa(orgId: string, partnerId: string | null | undefined): Promise<void> {
    if (!partnerId) return;
    const p = await this.prisma.partner.findFirst({ where: { id: partnerId, orgId }, select: { id: true } });
    if (!p) throw new NotFoundException('Cliente não encontrado nesta empresa.');
  }

  listAcordos(orgId: string) {
    return this.prisma.acordoComercial.findMany({ where: { orgId }, orderBy: [{ tipo: 'asc' }, { cliente: 'asc' }], include: { partner: { select: { razaoSocial: true, nomeFantasia: true } } } });
  }

  async createAcordo(orgId: string, input: z.infer<typeof AcordoInputSchema>, actorId: string) {
    await this.clienteDaEmpresa(orgId, input.partnerId);
    const a = await this.prisma.acordoComercial.create({
      data: { orgId, ...input, valor: new Prisma.Decimal(input.valor), observacao: input.observacao ?? null, apelidos: input.apelidos ?? null, fechadoEm: diaDoFechamento(input.fechadoEm) ?? null },
    });
    await this.audit.log({ orgId, actorId, action: 'finance.acordo.create', entityType: 'acordo_comercial', entityId: a.id, after: { cliente: a.cliente, tipo: a.tipo, valor: num(a.valor) } });
    return { ok: true, id: a.id };
  }

  async updateAcordo(orgId: string, id: string, input: z.infer<typeof AcordoUpdateSchema>, actorId: string) {
    await this.clienteDaEmpresa(orgId, input.partnerId);
    const antes = await this.prisma.acordoComercial.findFirst({ where: { id, orgId } });
    if (!antes) throw new NotFoundException('Acordo não encontrado');
    const data: Prisma.AcordoComercialUpdateInput = { ...input, valor: input.valor !== undefined ? new Prisma.Decimal(input.valor) : undefined, fechadoEm: diaDoFechamento(input.fechadoEm) };
    const a = await this.prisma.acordoComercial.update({ where: { id }, data });
    await this.audit.log({ orgId, actorId, action: 'finance.acordo.update', entityType: 'acordo_comercial', entityId: id, before: { tipo: antes.tipo, valor: num(antes.valor) }, after: { tipo: a.tipo, valor: num(a.valor) } });
    return { ok: true, id };
  }

  async deleteAcordo(orgId: string, id: string, actorId: string) {
    const antes = await this.prisma.acordoComercial.findFirst({ where: { id, orgId } });
    if (!antes) throw new NotFoundException('Acordo não encontrado');
    await this.prisma.acordoComercial.delete({ where: { id } });
    // As parcelas saem junto (cascata); o previsto "a gerar" de cada uma sai do fluxo.
    await materializarParcelas(this.prisma, orgId);
    await this.audit.log({ orgId, actorId, action: 'finance.acordo.delete', entityType: 'acordo_comercial', entityId: id, before: { cliente: antes.cliente, tipo: antes.tipo, valor: num(antes.valor) } });
    return { ok: true };
  }

  // ---------------- resumo ----------------
  async resumo(orgId: string) {
    const agora = Date.now();
    const meses = mesesAte(new Date(agora), 4);
    const mesAtual = meses[meses.length - 1];
    const inicioJanela = new Date(`${meses[0]}-01T00:00:00.000Z`);
    const [summary, acordos, entradas, contratos, semConta, contas, movsJanela] = await Promise.all([
      this.fin.summary(orgId),
      this.listAcordos(orgId),
      this.prisma.financeTransaction.findMany({
        where: { orgId, type: 'entrada' },
        select: { amount: true, status: true, counterparty: true, description: true, date: true, dueDate: true, chartAccountId: true },
      }),
      // Conta que já acabou (data de fim no passado) não entra, mesmo com o status ativo.
      this.prisma.contract.findMany({ where: { orgId, status: 'ativo', OR: [{ dataFim: null }, { dataFim: { gte: new Date(agora - 86400_000) } }] }, select: { id: true, tipo: true, descricao: true, valor: true, periodicidade: true, diaVencimento: true, dataFim: true, partner: { select: { razaoSocial: true } } } }),
      this.prisma.financeTransaction.count({ where: { orgId, status: { not: 'previsto' }, chartAccountId: null, temRateio: false } }),
      this.prisma.chartAccount.findMany({ where: { orgId }, select: { id: true, codigo: true, nome: true, parentId: true, custoFixo: true, natureza: true } }),
      this.prisma.financeTransaction.findMany({
        where: { orgId, status: { in: ['realizado', 'conciliado'] }, date: { gte: inicioJanela } },
        select: { id: true, type: true, amount: true, date: true, description: true, counterparty: true, notes: true, mesesDeUso: true, chartAccountId: true, contractId: true, splits: { select: { chartAccountId: true, valor: true } } },
        orderBy: { date: 'asc' },
      }),
    ]);
    const doContrato = contratos.length
      ? await this.prisma.financeTransaction.findMany({
          where: { orgId, contractId: { in: contratos.map((c) => c.id) } },
          select: { contractId: true, status: true, amount: true, date: true, dueDate: true },
        })
      : [];
    const plano: ContaDoPlano[] = contas;
    const porId = new Map(plano.map((c) => [c.id, c]));
    const previstos = await this.prisma.financeTransaction.findMany({
      where: { orgId, status: 'previsto' },
      select: { type: true, amount: true, dueDate: true, date: true },
    });
    // Acordo com parcelas (29/10/2026): o recebido e o a receber vêm delas, não do nome no extrato.
    const parcelas = await this.prisma.acordoParcela.findMany({ where: { orgId }, select: { acordoId: true, valor: true, pagaEm: true } });

    // acordos × extrato
    const efetivo = (s: string) => s === 'realizado' || s === 'conciliado';
    const linhas = acordos.map((a) => {
      const chaves = [a.cliente, ...(a.apelidos ?? '').split(',')].map((c) => c.trim().toLowerCase()).filter((c) => c.length >= 3);
      const casa = (t: { counterparty: string | null; description: string }) => {
        const alvo = `${t.counterparty ?? ''} ${t.description}`.toLowerCase();
        return chaves.some((c) => alvo.includes(c));
      };
      const suas = parcelas.filter((p) => p.acordoId === a.id);
      const doAcordo: typeof entradas = suas.length ? [] : entradas.filter(casa);
      const recebido = suas.length
        ? r2(suas.filter((p) => p.pagaEm).reduce((s, p) => s + num(p.valor), 0))
        : r2(doAcordo.filter((t) => efetivo(t.status)).reduce((s, t) => s + num(t.amount), 0));
      const aReceber = suas.length
        ? r2(suas.filter((p) => !p.pagaEm).reduce((s, p) => s + num(p.valor), 0))
        : r2(doAcordo.filter((t) => t.status === 'previsto').reduce((s, t) => s + num(t.amount), 0));
      const valor = num(a.valor);
      const esperaCaixa = a.tipo === 'pagante';
      return {
        id: a.id, cliente: a.cliente, produto: a.produto, tipo: a.tipo, valor, observacao: a.observacao, apelidos: a.apelidos,
        // Integração 26/10: o cliente cadastrado a que o acordo está ligado.
        partnerId: a.partnerId ?? null, partnerNome: a.partner ? (a.partner.nomeFantasia || a.partner.razaoSocial) : null,
        fechadoEm: a.fechadoEm ? a.fechadoEm.toISOString().slice(0, 10) : null,
        recebido, aReceber, semRastro: esperaCaixa ? r2(Math.max(0, valor - recebido - aReceber)) : 0,
      };
    });
    const porTipo = TIPOS_DE_ACORDO.map((tipo) => {
      const g = linhas.filter((l) => l.tipo === tipo);
      return { tipo, acordos: g.length, valor: r2(g.reduce((s, l) => s + l.valor, 0)), recebido: r2(g.reduce((s, l) => s + l.recebido, 0)), aReceber: r2(g.reduce((s, l) => s + l.aReceber, 0)) };
    });
    const entregue = r2(porTipo.reduce((s, t) => s + t.valor, 0));
    const pagante = porTipo.find((t) => t.tipo === 'pagante')!;

    // recorrentes, com o que aconteceu com cada um no mês atual. O pagamento fica preso
    // ao contrato quando é conciliado com o previsto que o contrato gerou.
    const mensal = (c: (typeof contratos)[number]) => r2(num(c.valor) * (POR_MES[c.periodicidade] ?? 1));
    const noMes = (contratoId: string) => {
      const doMes = doContrato.filter((t) => t.contractId === contratoId);
      const pago = r2(doMes.filter((t) => efetivo(t.status) && mesDe(t.date) === mesAtual).reduce((s, t) => s + num(t.amount), 0));
      const aberto = doMes
        .filter((t) => t.status === 'previsto' && mesDe(t.dueDate ?? t.date) === mesAtual)
        .sort((a, b) => (a.dueDate ?? a.date).getTime() - (b.dueDate ?? b.date).getTime())[0];
      return { pago, previsto: aberto ? num(aberto.amount) : 0, vence: aberto ? (aberto.dueDate ?? aberto.date).toISOString().slice(0, 10) : null };
    };
    const recorrentes = contratos.map((c) => ({ id: c.id, tipo: c.tipo, descricao: c.descricao, quem: c.partner?.razaoSocial ?? null, valor: num(c.valor), periodicidade: c.periodicidade, dia: c.diaVencimento, ate: c.dataFim ? c.dataFim.toISOString().slice(0, 10) : null, porMes: mensal(c), noMes: noMes(c.id) }));
    const custoMensal = r2(recorrentes.filter((c) => c.tipo === 'saida').reduce((s, c) => s + c.porMes, 0));
    const receitaMensal = r2(recorrentes.filter((c) => c.tipo === 'entrada').reduce((s, c) => s + c.porMes, 0));

    // próximos 30/60/90 dias
    const janela = (dias: number, tipo: 'entrada' | 'saida') => r2(previstos
      .filter((p) => p.type === tipo && (p.dueDate ?? p.date).getTime() <= agora + dias * DIA)
      .reduce((s, p) => s + num(p.amount), 0));
    const proximos = [30, 60, 90].map((dias) => ({ dias, entra: janela(dias, 'entrada'), sai: janela(dias, 'saida') }));

    // dependência: entradas realizadas dos últimos 90 dias por pagador
    const desde = agora - 90 * DIA;
    const porPagador = new Map<string, number>();
    for (const t of entradas) {
      // estorno de gasto (entrada em conta de despesa) não é cliente pagando
      if (!efetivo(t.status) || t.date.getTime() < desde || !ehReceita(porId, t.chartAccountId)) continue;
      const k = (t.counterparty ?? t.description).trim();
      porPagador.set(k, (porPagador.get(k) ?? 0) + num(t.amount));
    }
    const totalRecebido90 = [...porPagador.values()].reduce((s, v) => s + v, 0);
    const topo = [...porPagador.entries()].sort((a, b) => b[1] - a[1])[0];

    // para onde foi o dinheiro, mês a mês
    const movs: Movimento[] = movsJanela.map((t) => ({
      id: t.id, mesesDeUso: t.mesesDeUso,
      type: t.type, amount: num(t.amount), date: t.date, chartAccountId: t.chartAccountId, contractId: t.contractId,
      splits: t.splits.map((s) => ({ chartAccountId: s.chartAccountId, valor: num(s.valor) })),
    }));
    // As contas que pesaram como fixo ou variável na janela: é nelas que marcar "fixa" muda a tabela.
    const usadas = new Map<string, number>();
    for (const m of movs) {
      for (const p of partesDaSaida(m)) {
        if (!p.chartAccountId || (m.type === 'entrada' && ehReceita(porId, p.chartAccountId))) continue;
        const g = grupoDaSaida(porId, p.chartAccountId, false);
        const v = m.type === 'saida' ? p.valor : -p.valor;
        if (g !== 'investimento' && g !== 'retirada') {
          usadas.set(p.chartAccountId, (usadas.get(p.chartAccountId) ?? 0) + v);
        }
      }
    }
    const contasDaJanela = [...usadas.entries()]
      .map(([id, total]) => {
        const c = contas.find((x) => x.id === id)!;
        // A natureza em uso: a escolhida (nesta conta ou numa conta-mãe), ou a que a regra dá hoje.
        // lado (custo da operação, despesa da estrutura ou imposto) e a natureza que vale sem escolha
        const lado = c.codigo.startsWith('3') ? 'custo' : c.codigo.startsWith('2') ? 'imposto' : 'despesa';
        const automatica = (() => { const sem = new Map(porId); sem.set(id, { ...c, natureza: null }); return naturezaEmUso(sem, id, false); })();
        return {
          id, codigo: c.codigo, nome: c.nome, lado, grupo: grupoDaSaida(porId, id, false),
          natureza: c.natureza ?? null, naturezaHerdada: !c.natureza ? naturezaDaConta(porId, id) : null, automatica, total: r2(total),
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      geradoEm: new Date().toISOString(),
      caixa: {
        saldo: summary.saldoTotal,
        aReceber: summary.aReceber,
        aPagar: summary.aPagar,
        folegoMeses: custoMensal > 0 ? r2(summary.saldoTotal / custoMensal) : null,
      },
      acordos: {
        linhas,
        porTipo,
        entregue,
        viraCaixa: r2(pagante.valor),
        semCaixaPct: entregue > 0 ? r2(((entregue - pagante.valor) / entregue) * 100) : 0,
        semRastro: r2(linhas.reduce((s, l) => s + l.semRastro, 0)),
      },
      recorrentes: { linhas: recorrentes, custoMensal, receitaMensal, coberturaPct: custoMensal > 0 ? r2((receitaMensal / custoMensal) * 100) : null },
      mesAMes: {
        linhas: mesAMes(movs, plano, meses), porMes: mesAMes(movs, plano, meses, true), mesAtual, contas: contasDaJanela,
        // o que está dentro de cada célula da tabela (mês × grupo): o clique abre esta lista
        detalhe: partesDoMes(movs, plano, meses).map((pt) => {
          const t = movsJanela[pt.indice];
          const conta = pt.chartAccountId ? porId.get(pt.chartAccountId) : undefined;
          return {
            mes: pt.mes, grupo: pt.grupo, id: t.id, data: t.date.toISOString().slice(0, 10),
            descricao: t.notes?.split(' — ')[0] || t.description, extrato: t.description, quem: t.counterparty,
            conta: conta ? `${conta.codigo} ${contas.find((x) => x.id === conta.id)?.nome ?? ''}`.trim() : null,
            valor: r2(pt.valor), rateio: t.splits.length > 0, mesesDeUso: t.mesesDeUso ?? null,
          };
        }),
      },
      proximos,
      dependencia: topo ? { pagador: topo[0], valor: r2(topo[1]), pct: totalRecebido90 > 0 ? r2((topo[1] / totalRecebido90) * 100) : 0, total90: r2(totalRecebido90) } : null,
      pendencias: { semClassificacao: semConta, vencidoReceber: summary.aReceberVencido, vencidoPagar: summary.aPagarVencido },
    };
  }

  // ---------------- leitura da IA ----------------
  // Pedido em andamento por empresa: quem chega enquanto a IA ainda escreve espera a mesma resposta.
  private emAndamento = new Map<string, Promise<{ texto: string; geradaEm: string; guardada: boolean }>>();

  leitura(orgId: string, refazer = false) {
    const atual = this.emAndamento.get(orgId);
    if (atual) return atual;
    const p = this.lerAgora(orgId, refazer).finally(() => this.emAndamento.delete(orgId));
    this.emAndamento.set(orgId, p);
    return p;
  }

  private async lerAgora(orgId: string, refazer: boolean) {
    const r = await this.resumo(orgId);
    // Números que a IA vê: sem ids e sem o carimbo de hora (senão o hash muda a cada abertura).
    const base = {
      caixa: r.caixa,
      acordos: { ...r.acordos, linhas: r.acordos.linhas.map(({ id, apelidos, ...l }) => l) },
      recorrentes: { ...r.recorrentes, linhas: r.recorrentes.linhas.map(({ id, ...l }) => l) },
      mesAMes: { mesAtual: r.mesAMes.mesAtual, linhas: r.mesAMes.linhas },  // sem o detalhe: a IA lê os totais
      proximos: r.proximos,
      dependencia: r.dependencia,
      pendencias: r.pendencias,
    };
    const json = JSON.stringify(base);
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 32);
    const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília
    if (!refazer) {
      const guardada = await this.prisma.analiseLeitura.findFirst({ where: { orgId, dia, hash }, orderBy: { createdAt: 'desc' } });
      if (guardada) return { texto: guardada.texto, geradaEm: guardada.createdAt.toISOString(), guardada: true };
    }
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    // 6000: o modelo pode raciocinar antes de escrever, e o raciocínio conta nesse teto.
    const texto = (await this.llm.complete({ funcao: 'FI-01', system: SISTEMA, user: `Números de hoje (${dia}):\n${json}`, orgId, maxTokens: 6000 })).trim();
    // upsert: dois pedidos simultâneos (duas abas, duplo clique) não quebram na chave única.
    const salva = await this.prisma.analiseLeitura.upsert({
      where: { orgId_dia_hash: { orgId, dia, hash } },
      create: { orgId, dia, hash, texto },
      update: { texto },
    });
    return { texto, geradaEm: salva.createdAt.toISOString(), guardada: false };
  }
}
