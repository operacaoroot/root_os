import { describe, expect, it } from 'vitest';
import { contaFixa, grupoDaSaida, mesAMes, mesesAte, partesDoMes, type ContaDoPlano, type Movimento } from '../src/finance/mes-a-mes';

// Plano mínimo com a mesma forma do padrão: grupo → subgrupo → conta.
const plano: ContaDoPlano[] = [
  { id: 'receita', codigo: '1.1.02', parentId: null, custoFixo: false },
  { id: 'das', codigo: '2.1.08', parentId: null, custoFixo: false },
  { id: 'software', codigo: '3.1.03', parentId: null, custoFixo: true }, // assinatura de IA
  { id: 'vps', codigo: '3.1.09', parentId: null, custoFixo: false, natureza: 'variavel' },
  { id: 'g4', codigo: '4', parentId: null, custoFixo: false },
  { id: 'g41', codigo: '4.1', parentId: 'g4', custoFixo: false },
  { id: 'aluguel', codigo: '4.1.01', parentId: 'g41', custoFixo: true },
  { id: 'material', codigo: '4.1.06', parentId: 'g41', custoFixo: false },
  { id: 'sala', codigo: '4.1.14', parentId: 'g41', custoFixo: false, natureza: 'eventual' },
  { id: 'g42', codigo: '4.2', parentId: 'g4', custoFixo: true },
  { id: 'pessoal', codigo: '4.2.01', parentId: 'g42', custoFixo: false },
  { id: 'tarifa', codigo: '4.5.03', parentId: 'g4', custoFixo: false },
  { id: 'prolabore', codigo: '4.6.01', parentId: 'g4', custoFixo: false },
  { id: 'equip', codigo: '5.1.01', parentId: null, custoFixo: false },
];
const porId = new Map(plano.map((c) => [c.id, c]));
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const saida = (date: string, amount: number, chartAccountId: string | null, extra: Partial<Movimento> = {}): Movimento =>
  ({ type: 'saida', amount, date: dia(date), chartAccountId, contractId: null, splits: [], ...extra });
const entrada = (date: string, amount: number, chartAccountId: string | null = 'receita'): Movimento =>
  ({ type: 'entrada', amount, date: dia(date), chartAccountId, contractId: null, splits: [] });

describe('mês a mês do financeiro (custo da operação × despesa da estrutura)', () => {
  it('os meses terminam no atual e atravessam a virada do ano', () => {
    expect(mesesAte(dia('2026-10-18'), 4)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(mesesAte(dia('2027-01-05'), 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('a conta é fixa por ela mesma ou por uma conta-mãe', () => {
    expect(contaFixa(porId, 'aluguel')).toBe(true);
    expect(contaFixa(porId, 'pessoal')).toBe(true); // herda do 4.2
    expect(contaFixa(porId, 'material')).toBe(false);
  });

  it('3.x é custo da operação, 4.x é despesa, e a natureza separa dentro de cada lado', () => {
    expect(grupoDaSaida(porId, 'software', false)).toBe('custoFixo'); // IA: custo fixo da operação
    expect(grupoDaSaida(porId, 'vps', false)).toBe('custoVariavel'); // VPS sobe com a demanda
    expect(grupoDaSaida(porId, 'aluguel', false)).toBe('despesaFixa');
    expect(grupoDaSaida(porId, 'sala', false)).toBe('despesaEventual'); // compra da sala: despesa, não investimento
    expect(grupoDaSaida(porId, 'tarifa', false)).toBe('despesaVariavel');
    expect(grupoDaSaida(porId, 'material', true)).toBe('despesaFixa'); // preso a contrato
    expect(grupoDaSaida(porId, null, false)).toBe('despesaVariavel');
  });

  it('investimento, retirada e imposto vêm antes do lado', () => {
    expect(grupoDaSaida(porId, 'equip', true)).toBe('investimento');
    expect(grupoDaSaida(porId, 'prolabore', false)).toBe('retirada');
    expect(grupoDaSaida(porId, 'das', true)).toBe('impostos');
  });

  it('margem da operação, despesas e sobra; o DAS de conta fixa entra no fixo do mês', () => {
    const comDasFixo = plano.map((c) => (c.id === 'das' ? { ...c, natureza: 'fixo' } : c));
    const [set] = mesAMes([
      entrada('2026-09-10', 5000),
      saida('2026-09-15', 350, 'software'),
      saida('2026-09-15', 100, 'vps'),
      saida('2026-09-05', 150, 'aluguel'),
      saida('2026-09-20', 2519.94, 'sala'),
      saida('2026-09-20', 1.99, 'tarifa'),
      saida('2026-09-15', 86.05, 'das'),
      saida('2026-09-25', 1000, 'equip'),
    ], comDasFixo, ['2026-09']);
    expect(set).toEqual({
      mes: '2026-09', receita: 5000,
      custoFixo: 350, custoVariavel: 100, custo: 450, margem: 4550,
      despesaFixa: 150, despesaVariavel: 1.99, despesaEventual: 2519.94, despesas: 2671.93,
      impostos: 86.05, sobra: 1792.02, investimento: 1000, retirada: 0,
      saiu: 4207.98, fixoDoMes: 586.05,
    });
  });

  it('usa as linhas do rateio e o estorno abate o gasto sem virar receita', () => {
    const [set] = mesAMes([
      entrada('2026-09-10', 1000),
      saida('2026-09-22', 300, null, { splits: [{ chartAccountId: 'software', valor: 100 }, { chartAccountId: 'sala', valor: 200 }] }),
      saida('2026-09-03', 178.2, 'pessoal'),
      entrada('2026-09-03', 178.2, 'pessoal'),
    ], plano, ['2026-09']);
    expect(set).toMatchObject({ receita: 1000, custoFixo: 100, despesaEventual: 200, despesaFixa: 0, saiu: 300, sobra: 700 });
  });

  it('pago de uma vez para 12 meses: o caixa mostra no mês, o "por mês" divide', () => {
    const movs = [saida('2026-09-15', 599.88, 'vps', { mesesDeUso: 12 }), saida('2026-10-15', 350, 'software')];
    const meses = ['2026-09', '2026-10', '2026-11'];
    const caixa = mesAMes(movs, plano, meses);
    const porMes = mesAMes(movs, plano, meses, true);
    expect(caixa.map((l) => l.custoVariavel)).toEqual([599.88, 0, 0]);
    expect(porMes.map((l) => l.custoVariavel)).toEqual([49.99, 49.99, 49.99]);
    expect(porMes.map((l) => l.custoFixo)).toEqual([0, 350, 0]);
  });

  it('cada célula da tabela é a soma das partes que o clique abre', () => {
    const movs: Movimento[] = [
      entrada('2026-09-10', 5000),
      saida('2026-09-22', 300, null, { splits: [{ chartAccountId: 'software', valor: 100 }, { chartAccountId: 'sala', valor: 200 }] }),
      saida('2026-09-05', 150, 'aluguel'),
    ];
    const partes = partesDoMes(movs, plano, ['2026-09']);
    const [set] = mesAMes(movs, plano, ['2026-09']);
    const soma = (g: string) => partes.filter((p) => p.grupo === g).reduce((s, p) => s + p.valor, 0);
    expect([soma('receita'), soma('custoFixo'), soma('despesaFixa'), soma('despesaEventual')])
      .toEqual([set.receita, set.custoFixo, set.despesaFixa, set.despesaEventual]);
    expect(partes.filter((p) => p.indice === 1).map((p) => p.grupo)).toEqual(['custoFixo', 'despesaEventual']);
  });
});
