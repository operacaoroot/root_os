/*
 * PARA ONDE FOI O DINHEIRO, MÊS A MÊS
 *
 * Separa o que entrou e o que saiu (realizado ou conciliado) em receita,
 * impostos, custo fixo, custo variável, gasto eventual, investimento e
 * retirada dos sócios. Cada saída é lida pela conta do plano — ou por linha,
 * quando tem rateio — nesta ordem:
 *
 *   5.x            → investimento
 *   4.6.x          → retirada dos sócios (pró-labore, dividendos)
 *   natureza escolhida na conta (ela ou uma conta-mãe): fixo, variável ou eventual
 *   2.x            → impostos
 *   preso a contrato, ou conta marcada como fixa (custoFixo) → fixo
 *   o resto, inclusive sem conta → variável
 *
 * A natureza escolhida vem antes de imposto de propósito: o DAS do MEI tem
 * valor fixo todo mês, fature quanto faturar, e quem é MEI marca a conta do
 * DAS como fixa. No Simples de ME o imposto é % da venda e fica em impostos.
 *
 * Fixo é o que vem todo mês, venda ou não venda. Variável sobe e desce com as
 * vendas. Eventual é gasto pontual, por decisão (confraternização, evento,
 * uniforme, presente): é o primeiro lugar a cortar quando o caixa aperta.
 *
 * "Fixo por mês" divide o que foi pago de uma vez para vários meses de uso
 * (plano anual de hospedagem: 12 meses). A tabela continua mostrando o caixa
 * (o que saiu em cada mês); a linha "fixo por mês" mostra o custo de manter.
 *
 * Entrada é receita quando está numa conta de receita (1.x) ou sem conta.
 * Entrada numa conta de despesa é estorno ou devolução: abate o gasto daquela
 * conta no mês, em vez de inflar a receita e o custo ao mesmo tempo.
 *
 * Funções puras: o serviço busca no banco, aqui só se soma.
 */

export type Grupo = 'impostos' | 'fixo' | 'variavel' | 'eventual' | 'investimento' | 'retirada';
export type Natureza = 'fixo' | 'variavel' | 'eventual';
export const NATUREZAS: readonly Natureza[] = ['fixo', 'variavel', 'eventual'];

export interface ContaDoPlano {
  id: string;
  codigo: string;
  parentId: string | null;
  custoFixo: boolean;
  /** Escolha explícita na Análise. Nula: vale a regra pelo código e por custoFixo. */
  natureza?: string | null;
}

export interface Movimento {
  id?: string;
  type: 'entrada' | 'saida';
  amount: number;
  date: Date;
  chartAccountId: string | null;
  contractId: string | null;
  splits: { chartAccountId: string | null; valor: number }[];
  /** Pago de uma vez para N meses de uso (ex.: plano anual = 12). Nulo ou 1: um mês. */
  mesesDeUso?: number | null;
}

export interface LinhaDoMes {
  mes: string; // AAAA-MM
  receita: number;
  impostos: number;
  fixo: number;
  /** fixo com os pagamentos de vários meses de uso divididos pelos meses (custo de manter, não caixa) */
  fixoPorMes: number;
  variavel: number;
  eventual: number;
  investimento: number;
  retirada: number;
  /** tudo o que saiu no mês */
  saiu: number;
  /** receita − impostos − fixo − variável − eventual: o que a operação deixou, antes de investir e retirar */
  sobra: number;
}

/** Uma parte de um lançamento dentro de uma célula da tabela (mês × grupo). */
export interface ParteDoMes {
  mes: string;
  grupo: Grupo | 'receita';
  indice: number; // posição do movimento na lista recebida
  chartAccountId: string | null;
  /** com sinal: estorno entra negativo no grupo da conta */
  valor: number;
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

/** O mês `n` meses depois de `mes` (AAAA-MM). */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  return mesDe(new Date(Date.UTC(a, m - 1 + n, 1)));
}

/** A natureza escolhida na conta ou na conta-mãe mais próxima; nula se nenhuma escolheu. */
export function naturezaDaConta(contas: Map<string, ContaDoPlano>, id: string | null): Natureza | null {
  const vistos = new Set<string>();
  let atual = id ? contas.get(id) : undefined;
  while (atual && !vistos.has(atual.id)) {
    if (atual.natureza && (NATUREZAS as readonly string[]).includes(atual.natureza)) return atual.natureza as Natureza;
    vistos.add(atual.id);
    atual = atual.parentId ? contas.get(atual.parentId) : undefined;
  }
  return null;
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
  if (codigo === '4.6' || codigo.startsWith('4.6.')) return 'retirada';
  const natureza = naturezaDaConta(contas, chartAccountId);
  if (natureza) return natureza;
  if (codigo.startsWith('2')) return 'impostos';
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

/** Cada parte de cada movimento, já no seu mês e grupo (é o que a tabela soma e o que o clique abre). */
export function partesDoMes(movs: Movimento[], contas: ContaDoPlano[], meses: string[]): ParteDoMes[] {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const naJanela = new Set(meses);
  const out: ParteDoMes[] = [];
  movs.forEach((m, indice) => {
    const mes = mesDe(m.date);
    if (!naJanela.has(mes)) return;
    const sinal = m.type === 'saida' ? 1 : -1;
    for (const p of partesDaSaida(m)) {
      if (m.type === 'entrada' && ehReceita(porId, p.chartAccountId)) {
        out.push({ mes, grupo: 'receita', indice, chartAccountId: p.chartAccountId, valor: p.valor });
      } else {
        out.push({ mes, grupo: grupoDaSaida(porId, p.chartAccountId, !!m.contractId), indice, chartAccountId: p.chartAccountId, valor: sinal * p.valor });
      }
    }
  });
  return out;
}

export function mesAMes(movs: Movimento[], contas: ContaDoPlano[], meses: string[]): LinhaDoMes[] {
  const linhas = new Map<string, LinhaDoMes>(
    meses.map((mes) => [mes, { mes, receita: 0, impostos: 0, fixo: 0, fixoPorMes: 0, variavel: 0, eventual: 0, investimento: 0, retirada: 0, saiu: 0, sobra: 0 }]),
  );
  for (const p of partesDoMes(movs, contas, meses)) {
    const l = linhas.get(p.mes)!;
    if (p.grupo === 'receita') { l.receita += p.valor; continue; }
    l[p.grupo] += p.valor;
    l.saiu += p.valor;
    if (p.grupo === 'fixo') {
      // custo de manter: o pagamento de N meses de uso vale 1/N em cada um deles
      const n = Math.max(1, Math.floor(movs[p.indice].mesesDeUso ?? 1));
      for (let i = 0; i < n; i++) {
        const alvo = linhas.get(somarMeses(p.mes, i));
        if (alvo) alvo.fixoPorMes += p.valor / n;
      }
    }
  }
  return meses.map((mes) => {
    const l = linhas.get(mes)!;
    const out: LinhaDoMes = {
      mes,
      receita: r2(l.receita), impostos: r2(l.impostos), fixo: r2(l.fixo), fixoPorMes: r2(l.fixoPorMes),
      variavel: r2(l.variavel), eventual: r2(l.eventual), investimento: r2(l.investimento), retirada: r2(l.retirada),
      saiu: r2(l.saiu), sobra: 0,
    };
    out.sobra = r2(out.receita - out.impostos - out.fixo - out.variavel - out.eventual);
    return out;
  });
}
