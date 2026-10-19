/*
 * PARA ONDE FOI O DINHEIRO, MÊS A MÊS
 *
 * Regra do financeiro da ROOT (Pedro, 19/10/2026):
 *   CUSTO   é tudo o que se usa para entregar ao cliente — a operação (plano 3.x).
 *   DESPESA é o que mantém a empresa de pé — estrutura e administração (plano 4.x).
 * Dentro de cada lado, a natureza diz se o gasto vem todo mês (fixo), acompanha
 * a demanda (variável) ou é pontual, por decisão (eventual). Assinatura de IA é
 * custo fixo da operação; VPS é custo variável; tudo o que foi comprado para a
 * sala é despesa (eventual), não investimento.
 *
 * Cada saída é lida pela conta do plano — ou por linha, quando tem rateio:
 *
 *   5.x   → investimento
 *   4.6.x → retirada dos sócios (pró-labore, dividendos)
 *   2.x   → impostos (contam no "fixo do mês" quando a conta é marcada fixa:
 *           o DAS do MEI tem valor fixo todo mês)
 *   3.x   → custo da operação: fixo ou variável (eventual conta como variável)
 *   4.x e sem conta → despesa: fixa, variável ou eventual
 *
 * A natureza vem da escolha feita na conta (ela ou uma conta-mãe); sem escolha,
 * é fixa quando o pagamento está preso a contrato ou a conta tem custoFixo, e
 * variável no resto.
 *
 * Duas leituras da mesma tabela: o CAIXA (o que saiu em cada mês) e o POR MÊS,
 * em que o pago de uma vez para N meses de uso (plano anual) vale 1/N em cada
 * um dos N meses — é o custo de manter, não o movimento do caixa.
 *
 * Entrada é receita quando está numa conta de receita (1.x) ou sem conta.
 * Entrada numa conta de despesa é estorno ou devolução: abate o gasto daquela
 * conta no mês, em vez de inflar a receita e o custo ao mesmo tempo.
 *
 * Funções puras: o serviço busca no banco, aqui só se soma.
 */

export type Grupo =
  | 'custoFixo' | 'custoVariavel'
  | 'despesaFixa' | 'despesaVariavel' | 'despesaEventual'
  | 'impostos' | 'investimento' | 'retirada';
export type Natureza = 'fixo' | 'variavel' | 'eventual';
export const NATUREZAS: readonly Natureza[] = ['fixo', 'variavel', 'eventual'];

export interface ContaDoPlano {
  id: string;
  codigo: string;
  parentId: string | null;
  custoFixo: boolean;
  /** Escolha explícita na Análise. Nula: fixa por contrato/custoFixo, variável no resto. */
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
  custoFixo: number;
  custoVariavel: number;
  /** custo da operação = fixo + variável */
  custo: number;
  /** receita − custo: o que a operação deixa para pagar a estrutura */
  margem: number;
  despesaFixa: number;
  despesaVariavel: number;
  despesaEventual: number;
  despesas: number;
  impostos: number;
  /** margem − despesas − impostos: o que sobra antes de investir e retirar */
  sobra: number;
  investimento: number;
  retirada: number;
  /** tudo o que saiu no mês */
  saiu: number;
  /** o que vem todo mês, vendendo ou não: custo fixo + despesa fixa + imposto de conta fixa */
  fixoDoMes: number;
}

/** Uma parte de um lançamento dentro de uma célula da tabela (mês × grupo). */
export interface ParteDoMes {
  mes: string;
  grupo: Grupo | 'receita';
  indice: number; // posição do movimento na lista recebida
  chartAccountId: string | null;
  /** com sinal: estorno entra negativo no grupo da conta */
  valor: number;
  /** imposto de conta marcada fixa (entra no fixo do mês) */
  impostoFixo?: boolean;
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

/** A natureza em uso: a escolhida, ou fixa por contrato/custoFixo, ou variável. */
export function naturezaEmUso(contas: Map<string, ContaDoPlano>, id: string | null, temContrato: boolean): Natureza {
  return naturezaDaConta(contas, id) ?? (temContrato || contaFixa(contas, id) ? 'fixo' : 'variavel');
}

export function grupoDaSaida(contas: Map<string, ContaDoPlano>, chartAccountId: string | null, temContrato: boolean): Grupo {
  const codigo = chartAccountId ? contas.get(chartAccountId)?.codigo ?? '' : '';
  if (codigo.startsWith('5')) return 'investimento';
  if (codigo === '4.6' || codigo.startsWith('4.6.')) return 'retirada';
  if (codigo.startsWith('2')) return 'impostos';
  const natureza = naturezaEmUso(contas, chartAccountId, temContrato);
  if (codigo.startsWith('3')) return natureza === 'fixo' ? 'custoFixo' : 'custoVariavel';
  return natureza === 'fixo' ? 'despesaFixa' : natureza === 'eventual' ? 'despesaEventual' : 'despesaVariavel';
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
        continue;
      }
      const grupo = grupoDaSaida(porId, p.chartAccountId, !!m.contractId);
      const impostoFixo = grupo === 'impostos' && naturezaEmUso(porId, p.chartAccountId, !!m.contractId) === 'fixo';
      out.push({ mes, grupo, indice, chartAccountId: p.chartAccountId, valor: sinal * p.valor, ...(impostoFixo ? { impostoFixo } : {}) });
    }
  });
  return out;
}

type Soma = Omit<LinhaDoMes, 'mes' | 'custo' | 'margem' | 'despesas' | 'sobra'>;
const zerado = (): Soma => ({
  receita: 0, custoFixo: 0, custoVariavel: 0, despesaFixa: 0, despesaVariavel: 0, despesaEventual: 0,
  impostos: 0, investimento: 0, retirada: 0, saiu: 0, fixoDoMes: 0,
});

/**
 * A tabela mês a mês. `porMes`: o pago para N meses de uso entra 1/N em cada um
 * dos N meses (o que cair fora da janela não aparece); sem ela, é o caixa.
 */
export function mesAMes(movs: Movimento[], contas: ContaDoPlano[], meses: string[], porMes = false): LinhaDoMes[] {
  const somas = new Map<string, Soma>(meses.map((mes) => [mes, zerado()]));
  for (const p of partesDoMes(movs, contas, meses)) {
    const n = porMes && p.grupo !== 'receita' ? Math.max(1, Math.floor(movs[p.indice].mesesDeUso ?? 1)) : 1;
    for (let i = 0; i < n; i++) {
      const l = somas.get(somarMeses(p.mes, i));
      if (!l) continue;
      const v = p.valor / n;
      if (p.grupo === 'receita') { l.receita += v; continue; }
      l[p.grupo] += v;
      l.saiu += v;
      if (p.grupo === 'custoFixo' || p.grupo === 'despesaFixa' || p.impostoFixo) l.fixoDoMes += v;
    }
  }
  return meses.map((mes) => {
    const s = somas.get(mes)!;
    const l = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r2(v)])) as Soma;
    const custo = r2(l.custoFixo + l.custoVariavel);
    const despesas = r2(l.despesaFixa + l.despesaVariavel + l.despesaEventual);
    const margem = r2(l.receita - custo);
    return { mes, ...l, custo, margem, despesas, sobra: r2(margem - despesas - l.impostos) };
  });
}
