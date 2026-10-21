import { describe, expect, it } from 'vitest';

import {
  diaComSemana, diaCompleto, diaCurto, diaDe, instanteComSemana, instanteCurto, proximaDataDoCartao,
} from '@/lib/datas-do-cartao';

/*
 * AS DATAS DO CARTÃO (rodada de produção 1, 21/10/2026): São Paulo para instante, UTC
 * para o DIA gravado à meia-noite UTC, e nada (nunca "Invalid Date") para o ilegível.
 */
describe('datas do cartão', () => {
  it('instante em São Paulo: 02h UTC de 22/10 ainda é 21/10 em Brasília', () => {
    expect(diaCurto('2026-10-22T02:00:00.000Z')).toBe('21/10');
    expect(diaCompleto('2026-10-22T02:00:00.000Z')).toBe('21/10/2026');
    expect(diaDe('2026-10-22T02:00:00.000Z')).toBe('2026-10-21');
    expect(instanteCurto('2026-10-22T02:00:00.000Z')).toBe('21/10/2026, 23:00');
  });

  it('o DIA do trilho (meia-noite UTC) não escorrega para o dia anterior', () => {
    expect(diaCurto('2026-09-22T00:00:00.000Z')).toBe('22/09');
    expect(diaComSemana('2026-09-22T00:00:00.000Z')).toBe('terça-feira, 22/09/2026');
    expect(instanteComSemana('2026-09-22T00:00:00.000Z')).toBe('terça-feira, 22/09/2026');
  });

  it('o dia da semana e a hora no balão', () => {
    expect(diaComSemana('2026-10-21T15:00:00.000Z')).toBe('quarta-feira, 21/10/2026');
    expect(instanteComSemana('2026-10-21T17:05:00.000Z')).toBe('quarta-feira, 21/10/2026 às 14:05');
  });

  it('sem data ou data ilegível: nada, nunca "Invalid Date"', () => {
    for (const v of [null, undefined, '', 'ontem', '2026-13-45T99:00:00Z']) {
      expect(diaCurto(v)).toBeNull();
      expect(diaComSemana(v)).toBeNull();
      expect(instanteCurto(v)).toBeNull();
    }
  });

  it('a próxima data: a mais próxima de hoje em diante; sem futura, a que passou mais perto; sem nenhuma, nada', () => {
    const agora = new Date('2026-10-21T15:00:00.000Z');
    expect(proximaDataDoCartao({ dueDate: '2026-10-30T15:00:00.000Z', proximoPassoEm: '2026-10-24T00:00:00.000Z' }, agora)).toEqual({ iso: '2026-10-24T00:00:00.000Z', origem: 'proximo_passo', passou: false });
    expect(proximaDataDoCartao({ dueDate: '2026-10-21T15:00:00.000Z' }, agora)).toEqual({ iso: '2026-10-21T15:00:00.000Z', origem: 'prazo', passou: false });
    expect(proximaDataDoCartao({ dueDate: '2026-10-10T15:00:00.000Z', proximoPassoEm: '2026-10-15T15:00:00.000Z' }, agora)).toMatchObject({ origem: 'proximo_passo', passou: true });
    expect(proximaDataDoCartao({ dueDate: null, proximoPassoEm: null }, agora)).toBeNull();
    expect(proximaDataDoCartao({ dueDate: 'lixo' }, agora)).toBeNull();
  });
});
