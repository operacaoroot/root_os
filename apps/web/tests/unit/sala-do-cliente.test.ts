import { describe, expect, it } from 'vitest';

import { dataCurta, explicarEstado, localSPParaIso, reais, rotuloDoHorario, soDigitos } from '../../src/lib/sala-do-cliente';

describe('a sala do cliente na tela', () => {
  it('reais a partir de centavos, sem inventar quando falta', () => {
    expect(reais(1_199_700)).toBe('R$ 11.997');
    expect(reais(399_950)).toBe('R$ 3.999,50');
    expect(reais(null)).toBe('[a decidir]');
  });

  it('o horário em São Paulo, qualquer que seja o fuso do navegador', () => {
    expect(rotuloDoHorario('2026-10-16T10:00:00-03:00')).toBe('Sex 16/10 · 10h');
    expect(rotuloDoHorario('2026-10-16T13:30:00Z')).toBe('Sex 16/10 · 10h30');
    expect(dataCurta('2026-10-24T23:59:00-03:00')).toBe('24/10');
  });

  it('o campo de data e hora vira ISO com o fuso de São Paulo', () => {
    expect(localSPParaIso('2026-10-20T14:00')).toBe('2026-10-20T14:00:00-03:00');
    expect(localSPParaIso('ontem')).toBeNull();
  });

  it('só dígitos e o estado da mensagem em frase', () => {
    expect(soDigitos('12.345.678/0001-99')).toBe('12345678000199');
    expect(explicarEstado('na_fila')).toMatch(/outra pessoa confirma/);
  });
});
