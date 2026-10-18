import { describe, expect, it } from 'vitest';
import { OPERACAO_ESTADOS } from '@mktos/shared';
import { ROTULO_DO_ESTADO, TOM_DO_ESTADO, atrasado, data, diasEntre, hoje, reais } from '@/app/operacao/formato';

describe('formatos do painel da operação', () => {
  it('centavos viram reais no padrão brasileiro', () => {
    expect(reais(5_516_250).replace(/\s/g, ' ')).toBe('R$ 55.162,50');
    expect(reais(0).replace(/\s/g, ' ')).toBe('R$ 0,00');
  });

  it('datas AAAA-MM-DD viram DD/MM/AAAA sem passar por fuso', () => {
    expect(data('2026-10-14')).toBe('14/10/2026');
    expect(data('2026-01-01', true)).toBe('01/01');
    expect(data(null)).toBe('–');
  });

  it('hoje usa o calendário local, não o UTC', () => {
    expect(hoje(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14');
    expect(hoje(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
  });

  it('só está atrasado o que tem prazo vencido e não foi feito', () => {
    expect(atrasado('2026-10-13', false, '2026-10-14')).toBe(true);
    expect(atrasado('2026-10-14', false, '2026-10-14')).toBe(false);
    expect(atrasado('2026-10-13', true, '2026-10-14')).toBe(false);
    expect(atrasado(null, false, '2026-10-14')).toBe(false);
  });

  it('dias entre datas atravessam mês e fevereiro sem erro de um dia', () => {
    expect(diasEntre('2026-09-21', '2026-10-14')).toBe(23);
    expect(diasEntre('2026-10-14', '2026-10-14')).toBe(0);
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('todo estado do contrato tem tom e rótulo, e nenhum usa a cor da marca', () => {
    for (const estado of OPERACAO_ESTADOS) {
      expect(TOM_DO_ESTADO[estado]).not.toBe('brand');
      expect(ROTULO_DO_ESTADO[estado]).toBeTruthy();
    }
  });
});
