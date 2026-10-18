/*
 * PARA ONDE FOI O DINHEIRO, MÊS A MÊS
 *
 * Separa o que entrou e o que saiu (realizado ou conciliado) em receita,
 * impostos, custo fixo, custo variável, investimento e retirada dos sócios.
 * Cada saída é lida pela conta do plano — ou por linha, quando tem rateio —
 * nesta ordem:
 *
 *   5.x            → investimento
 *   2.x            → impostos
 *   4.6.x          → retirada dos sócios (pró-labore, dividendos)
 *   preso a contrato, ou conta marcada como fixa (ela ou uma conta-mãe) → fixo
 *   o resto, inclusive sem conta → variável
 *
 * Imposto vem antes de contrato de propósito: o DAS do MEI é contrato e é
 * imposto, e assim fica em impostos todo mês, tenha o pagamento sido
 * conciliado com o contrato ou não.
 *
 * Entrada é receita quando está numa conta de receita (1.x) ou sem conta.
 * Entrada numa conta de despesa é estorno ou devolução: abate o gasto daquela
 * conta no mês, em vez de inflar a receita e o custo ao mesmo tempo.
 *
 * Funções puras: o serviço busca no banco, aqui só se soma.
 */

export type Grupo = 'impostos' | 'fixo' | 'variavel' | 'investimento' | 'retirada';

export interface ContaDoPlano {
  id: string;
  codigo: string;
  parentId: string | null;
  custoFixo: boolean;
}

export interface Movimento {
  type: 'entrada' | 'saida';
  amount: number;
  date: Date;
  chartAccountId: string | null;
  contractId: string | null;
  splits: { chartAccountId: string | null; valor: number }[];
}

export interface LinhaDoMes {
  mes: string; // AAAA-MM
  receita: number;
  impostos: number;
  fixo: number;
  variavel: number;
  investimento: number;
  retirada: number;
  /** tudo o que saiu no mês */
  saiu: number;
  /** receita − impostos − fixo − variável: o que a operação deixou, antes de investir e retirar */
  sobra: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** O mês do lançamento. As datas do financeiro são dia sem hora, gravadas à meia-noite UTC. */
export const mesDe = (d: Date) => d.toISOString().slice(0, 7);

/** Os `quantos` meses que terminam no mês de `agora`, do mais antigo ao atual. */
export function mesesAte(agora: Date, quantos: number): string[] {
  const out: string[] = [];
  for (let i = quantos - 1; i >= 0; i--) {
    out.push(mesDe(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - i, 1))));
  }
  return out;
}

/** Diz se a conta (ou alguma conta-mãe) está marcada como custo fixo. */
export function contaFixa(contas: Map<string, ContaDoPlano>, id: string | null): boolean {
  const vistos = new Set<string>();
  let atual = id ? contas.get(id) : undefined;
  while (atual && !vistos.has(atual.id)) {
    if (atual.custoFixo) return true;
    vistos.add(atual.id);
    atual = atual.parentId ? contas.get(atual.parentId) : undefined;
  }
  return false;
}

export function grupoDaSaida(contas: Map<string, ContaDoPlano>, chartAccountId: string | null, temContrato: boolean): Grupo {
  const codigo = chartAccountId ? contas.get(chartAccountId)?.codigo ?? '' : '';
  if (codigo.startsWith('5')) return 'investimento';
  if (codigo.startsWith('2')) return 'impostos';
  if (codigo === '4.6' || codigo.startsWith('4.6.')) return 'retirada';
  if (temContrato || contaFixa(contas, chartAccountId)) return 'fixo';
  return 'variavel';
}

/** As partes de um lançamento: as linhas do rateio, quando houver, ou o lançamento inteiro. */
export function partesDaSaida(m: Movimento): { chartAccountId: string | null; valor: number }[] {
  return m.splits.length ? m.splits : [{ chartAccountId: m.chartAccountId, valor: m.amount }];
}

/** Entrada que conta como receita: em conta de receita (1.x) ou sem conta. O resto é estorno de gasto. */
export function ehReceita(contas: Map<string, ContaDoPlano>, chartAccountId: string | null): boolean {
  const codigo = chartAccountId ? contas.get(chartAccountId)?.codigo : undefined;
  return !codigo || codigo.startsWith('1');
}

export function mesAMes(movs: Movimento[], contas: ContaDoPlano[], meses: string[]): LinhaDoMes[] {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const linhas = new Map<string, LinhaDoMes>(
    meses.map((mes) => [mes, { mes, receita: 0, impostos: 0, fixo: 0, variavel: 0, investimento: 0, retirada: 0, saiu: 0, sobra: 0 }]),
  );
  for (const m of movs) {
    const l = linhas.get(mesDe(m.date));
    if (!l) continue;
    // estorno (entrada em conta de despesa) entra com sinal trocado no grupo da conta
    const sinal = m.type === 'saida' ? 1 : -1;
    for (const p of partesDaSaida(m)) {
      if (m.type === 'entrada' && ehReceita(porId, p.chartAccountId)) { l.receita += p.valor; continue; }
      l[grupoDaSaida(porId, p.chartAccountId, !!m.contractId)] += sinal * p.valor;
      l.saiu += sinal * p.valor;
    }
  }
  return meses.map((mes) => {
    const l = linhas.get(mes)!;
    const out: LinhaDoMes = {
      mes,
      receita: r2(l.receita), impostos: r2(l.impostos), fixo: r2(l.fixo), variavel: r2(l.variavel),
      investimento: r2(l.investimento), retirada: r2(l.retirada), saiu: r2(l.saiu), sobra: 0,
    };
    out.sobra = r2(out.receita - out.impostos - out.fixo - out.variavel);
    return out;
  });
}
