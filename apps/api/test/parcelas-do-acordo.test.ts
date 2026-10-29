import { describe, expect, it } from 'vitest';
import { acordoDaCobranca, chavesDoAcordo, documentoComoChave, escolherParcela, ocorrenciasDoContrato, ordemDasParcelas, parcelaMaisPerto } from '../src/finance/parcelas';
import { proximoVencimentoDoContrato } from '../src/finance/apr.service';
import { nomeDaParcela } from '../src/finance/parcelas.service';

const dia = (d: string) => new Date(`${d}T00:00:00Z`);

describe('a cobrança do Asaas veste a parcela do acordo', () => {
  const affari = chavesDoAcordo({ cliente: 'Affari', apelidos: 'Affari,Antonio f junior' });
  const agranel = [...chavesDoAcordo({ cliente: 'Senhor aGranel', apelidos: 'Felipe Fortes' }), ...documentoComoChave('35.751.273/0001-52')];
  const livres = [
    { id: 'affari-2', valor: 397, vencimento: dia('2026-11-20'), chaves: affari },
    { id: 'affari-3', valor: 397, vencimento: dia('2026-12-20'), chaves: affari },
    { id: 'agranel-2', valor: 4000, vencimento: dia('2026-11-26'), chaves: agranel },
  ];

  it('pelo nome da pessoa que paga (apelido do acordo), valor igual e o vencimento mais perto', () => {
    expect(escolherParcela({ valor: 397, vence: dia('2026-12-20'), texto: 'Antonio f junior' }, livres)?.id).toBe('affari-3');
  });

  it('pelo CNPJ da empresa, mesmo com outro nome no Asaas', () => {
    expect(escolherParcela({ valor: 4000, vence: dia('2026-11-26'), texto: 'Fulano 35751273000152' }, livres)?.id).toBe('agranel-2');
  });

  it('valor diferente, nome de outro cliente ou vencimento longe não vestem', () => {
    expect(escolherParcela({ valor: 381.12, vence: dia('2026-11-20'), texto: 'Antonio f junior' }, livres)).toBeNull();
    expect(escolherParcela({ valor: 397, vence: dia('2026-11-20'), texto: 'LUCAS MOREIRA' }, livres)).toBeNull();
    expect(escolherParcela({ valor: 397, vence: dia('2027-01-25'), texto: 'Antonio f junior' }, livres)).toBeNull();
  });

  it('o nome segue o padrão "Produto - Cliente - Parcela n/N"', () => {
    expect(nomeDaParcela({ produto: 'Operação ROOT (upsell)', cliente: 'Custeio' }, 2, 7)).toBe('Operação ROOT - Custeio - Parcela 2/7');
  });
});

describe('o que está no Asaas entra sozinho no acordo certo', () => {
  const cnpjCusteio = documentoComoChave('06.236.539/0001-20');
  const acordos = [
    { id: 'upsell', chavesNome: chavesDoAcordo({ cliente: 'Custeio', apelidos: 'upsell,CUSTEIO TECHNOLOGY' }), chavesDoc: cnpjCusteio },
    { id: 'imersao', chavesNome: chavesDoAcordo({ cliente: 'Custeio (Lucas Moreira)', apelidos: 'Lucas Martins,Lucas Moreira' }), chavesDoc: cnpjCusteio },
    { id: 'affari', chavesNome: chavesDoAcordo({ cliente: 'Affari', apelidos: 'Affari,Antonio f junior' }), chavesDoc: [] },
  ];

  it('o nome pesa mais que o CNPJ que dois acordos dividem', () => {
    expect(acordoDaCobranca('CUSTEIO TECHNOLOGY S/S LTDA 06236539000120', acordos)?.id).toBe('upsell');
    expect(acordoDaCobranca('LUCAS MOREIRA 12345678901', acordos)?.id).toBe('imersao');
    expect(acordoDaCobranca('Antonio f junior', acordos)?.id).toBe('affari');
  });

  it('só o CNPJ, com dois acordos nele, não decide: nada é criado sozinho', () => {
    expect(acordoDaCobranca('Fulano 06236539000120', acordos)).toBeNull();
    expect(acordoDaCobranca('Ninguém conhecido', acordos)).toBeNull();
  });

  it('a parcela livre mais perto da data veste a cobrança mesmo com o valor mudado no Asaas', () => {
    const livres = [{ id: 'a', vencimento: dia('2026-11-30') }, { id: 'b', vencimento: dia('2026-12-30') }];
    expect(parcelaMaisPerto(dia('2026-11-28'), livres)?.id).toBe('a');
    expect(parcelaMaisPerto(dia('2027-02-28'), livres)).toBeNull();
  });

  it('"Parcela n/N" segue a ordem das datas, não a de criação', () => {
    const o = ordemDasParcelas([
      { id: 'saldo', acordoId: 'juma', numero: 1, vencimento: dia('2026-11-30') },
      { id: 'entrada', acordoId: 'juma', numero: 2, vencimento: dia('2026-11-02') },
    ]);
    expect(o.get('entrada')).toEqual({ n: 1, total: 2 });
    expect(o.get('saldo')).toEqual({ n: 2, total: 2 });
  });
});

describe('a conta fixa projetada até o fim da janela', () => {
  it('desenha a partir do próximo vencimento não gerado, até a data de fim', () => {
    const celular = { proximoVencimento: dia('2027-01-22'), dataFim: dia('2027-06-22'), periodicidade: 'mensal' };
    const datas = ocorrenciasDoContrato(celular, dia('2026-10-30'), dia('2027-12-31'), proximoVencimentoDoContrato);
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(['2027-01-22', '2027-02-22', '2027-03-22', '2027-04-22', '2027-05-22', '2027-06-22']);
  });

  it('sem data de fim, vai até o fim da janela; anual pula de ano em ano', () => {
    const hostinger = { proximoVencimento: dia('2027-09-15'), dataFim: null, periodicidade: 'anual' };
    expect(ocorrenciasDoContrato(hostinger, dia('2026-10-30'), dia('2028-12-31'), proximoVencimentoDoContrato)).toHaveLength(2);
  });

  it('o contrato com tudo já gerado não desenha nada de novo (não soma em dobro)', () => {
    const curral = { proximoVencimento: dia('2027-11-06'), dataFim: dia('2027-10-06'), periodicidade: 'mensal' };
    expect(ocorrenciasDoContrato(curral, dia('2026-10-30'), dia('2028-04-30'), proximoVencimentoDoContrato)).toEqual([]);
  });
});
