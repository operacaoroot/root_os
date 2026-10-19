import { describe, expect, it } from 'vitest';
import { contaFixa, grupoDaSaida, mesAMes, mesesAte, partesDoMes, type ContaDoPlano, type Movimento } from '../src/finance/mes-a-mes';

// Plano mínimo com a mesma forma do padrão: grupo → subgrupo → conta.
const plano: ContaDoPlano[] = [
  { id: 'g4', codigo: '4', parentId: null, custoFixo: false },
  { id: 'g41', codigo: '4.1', parentId: 'g4', custoFixo: false },
  { id: 'aluguel', codigo: '4.1.01', parentId: 'g41', custoFixo: true },
  { id: 'material', codigo: '4.1.06', parentId: 'g41', custoFixo: false },
  { id: 'g42', codigo: '4.2', parentId: 'g4', custoFixo: true },
  { id: 'pessoal', codigo: '4.2.01', parentId: 'g42', custoFixo: false },
  { id: 'marketing', codigo: '4.3.01', parentId: 'g4', custoFixo: false },
  { id: 'prolabore', codigo: '4.6.01', parentId: 'g4', custoFixo: false },
  { id: 'das', codigo: '2.1.08', parentId: null, custoFixo: false },
  { id: 'software', codigo: '3.1.03', parentId: null, custoFixo: true },
  { id: 'equip', codigo: '5.1.01', parentId: null, custoFixo: false },
];
const porId = new Map(plano.map((c) => [c.id, c]));
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const saida = (date: string, amount: number, chartAccountId: string | null, extra: Partial<Movimento> = {}): Movimento =>
  ({ type: 'saida', amount, date: dia(date), chartAccountId, contractId: null, splits: [], ...extra });

describe('mês a mês do financeiro', () => {
  it('os meses terminam no atual e atravessam a virada do ano', () => {
    expect(mesesAte(dia('2026-10-18'), 4)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(mesesAte(dia('2027-01-05'), 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('a conta é fixa por ela mesma ou por uma conta-mãe', () => {
    expect(contaFixa(porId, 'aluguel')).toBe(true);
    expect(contaFixa(porId, 'pessoal')).toBe(true); // herda do 4.2
    expect(contaFixa(porId, 'material')).toBe(false);
    expect(contaFixa(porId, null)).toBe(false);
  });

  it('investimento, imposto e retirada vencem a marca de fixo e o contrato', () => {
    expect(grupoDaSaida(porId, 'equip', true)).toBe('investimento');
    expect(grupoDaSaida(porId, 'das', true)).toBe('impostos'); // DAS do MEI é contrato e continua imposto
    expect(grupoDaSaida(porId, 'prolabore', false)).toBe('retirada');
    expect(grupoDaSaida(porId, 'marketing', true)).toBe('fixo'); // preso a contrato
    expect(grupoDaSaida(porId, 'marketing', false)).toBe('variavel');
    expect(grupoDaSaida(porId, null, false)).toBe('variavel');
  });

  it('soma por mês, usa as linhas do rateio e calcula a sobra antes de investir', () => {
    const movs: Movimento[] = [
      { type: 'entrada', amount: 5000, date: dia('2026-09-10'), chartAccountId: null, contractId: null, splits: [] },
      saida('2026-09-05', 150, 'aluguel'),
      saida('2026-09-15', 86.05, 'das'),
      saida('2026-09-20', 2519.94, 'equip'),
      saida('2026-09-22', 300, null, { splits: [{ chartAccountId: 'software', valor: 100 }, { chartAccountId: 'marketing', valor: 200 }] }),
      saida('2026-10-01', 49.9, 'marketing', { contractId: 'k1' }),
      saida('2026-06-30', 999, 'aluguel'), // fora da janela
    ];
    const [set, out] = mesAMes(movs, plano, ['2026-09', '2026-10']);
    expect(set).toEqual({
      mes: '2026-09', receita: 5000, impostos: 86.05, fixo: 250, fixoPorMes: 250, variavel: 200, eventual: 0, investimento: 2519.94, retirada: 0,
      saiu: 3055.99, sobra: 4463.95,
    });
    expect(out.fixo).toBe(49.9);
    expect(out.sobra).toBe(-49.9);
  });

  it('estorno numa conta de despesa abate o gasto e não vira receita', () => {
    const comReceita = [...plano, { id: 'receita', codigo: '1.1.02', parentId: null, custoFixo: false }];
    const movs: Movimento[] = [
      saida('2026-09-03', 178.2, 'marketing'),
      { type: 'entrada', amount: 178.2, date: dia('2026-09-03'), chartAccountId: 'marketing', contractId: null, splits: [] },
      { type: 'entrada', amount: 1000, date: dia('2026-09-10'), chartAccountId: 'receita', contractId: null, splits: [] },
      saida('2026-09-11', 200, 'marketing'),
    ];
    const [set] = mesAMes(movs, comReceita, ['2026-09']);
    expect(set.receita).toBe(1000);
    expect(set.variavel).toBe(200);
    expect(set.saiu).toBe(200);
    expect(set.sobra).toBe(800);
  });

  it('a natureza escolhida na conta vence imposto e a marca de fixo; eventual sai da sobra', () => {
    const escolhido = plano.map((c) =>
      c.id === 'das' ? { ...c, natureza: 'fixo' } : c.id === 'pessoal' ? { ...c, natureza: 'eventual' } : c);
    const ids = new Map(escolhido.map((c) => [c.id, c]));
    expect(grupoDaSaida(ids, 'das', true)).toBe('fixo'); // DAS do MEI: valor fixo todo mês
    expect(grupoDaSaida(ids, 'pessoal', false)).toBe('eventual'); // escolha da conta vence a marca do 4.2
    expect(grupoDaSaida(ids, 'equip', false)).toBe('investimento');
    const [set] = mesAMes([
      { type: 'entrada', amount: 1000, date: dia('2026-09-10'), chartAccountId: null, contractId: null, splits: [] },
      saida('2026-09-15', 86.05, 'das'),
      saida('2026-09-20', 189.8, 'pessoal'),
    ], escolhido, ['2026-09']);
    expect(set).toMatchObject({ impostos: 0, fixo: 86.05, eventual: 189.8, sobra: 724.15 });
  });

  it('pago de uma vez para 12 meses: o caixa mostra no mês, o fixo por mês divide', () => {
    const [set, out, nov] = mesAMes([
      saida('2026-09-15', 599.88, 'software', { mesesDeUso: 12 }),
      saida('2026-10-15', 350, 'software'),
    ], plano, ['2026-09', '2026-10', '2026-11']);
    expect([set.fixo, set.fixoPorMes]).toEqual([599.88, 49.99]);
    expect([out.fixo, out.fixoPorMes]).toEqual([350, 399.99]);
    expect([nov.fixo, nov.fixoPorMes]).toEqual([0, 49.99]);
  });

  it('cada célula da tabela é a soma das partes que o clique abre', () => {
    const movs: Movimento[] = [
      { type: 'entrada', amount: 5000, date: dia('2026-09-10'), chartAccountId: null, contractId: null, splits: [] },
      saida('2026-09-22', 300, null, { splits: [{ chartAccountId: 'software', valor: 100 }, { chartAccountId: 'marketing', valor: 200 }] }),
      saida('2026-09-05', 150, 'aluguel'),
    ];
    const partes = partesDoMes(movs, plano, ['2026-09']);
    const [set] = mesAMes(movs, plano, ['2026-09']);
    const soma = (g: string) => partes.filter((p) => p.grupo === g).reduce((s, p) => s + p.valor, 0);
    expect([soma('receita'), soma('fixo'), soma('variavel')]).toEqual([set.receita, set.fixo, set.variavel]);
    expect(partes.filter((p) => p.indice === 1).map((p) => p.grupo)).toEqual(['fixo', 'variavel']);
  });
});
