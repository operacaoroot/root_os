import { describe, it, expect } from 'vitest';
import {
  FAIXA_PADRAO,
  diasDaGrade,
  faixaDeHoras,
  inicioDaSemana,
  mover,
  periodoDaBusca,
  posicaoNaFaixa,
  rotuloDoPeriodo,
} from '@/app/agenda/grade';
import type { EventoDaAgenda } from '@/app/agenda/tipos';

/*
 * AS DUAS GRADES DA AGENDA.
 *
 * Esta suíte existe porque erro de calendário não estoura: ele desenha a
 * reunião de quinta na quarta, ou esconde a das 20h, e a tela continua bonita.
 * Cada caso aqui é uma dessas maneiras silenciosas de errar.
 */

const evento = (p: Partial<EventoDaAgenda> & { id: string }): EventoDaAgenda => ({
  title: 'Reunião Online - Cliente - Pedro',
  reuniao: null,
  start: null,
  end: null,
  diaInteiro: false,
  location: null,
  description: null,
  link: null,
  meet: null,
  status: 'confirmed',
  organizador: null,
  attendees: [],
  ...p,
});

describe('os dias desenhados', () => {
  it('a semana começa no domingo e tem sete dias', () => {
    // 24/09/2026 é uma quinta-feira.
    const dias = diasDaGrade('semana', new Date(2026, 8, 24));
    expect(dias).toHaveLength(7);
    expect(dias[0].getDay()).toBe(0);
    expect(dias.map((d) => d.getDate())).toEqual([20, 21, 22, 23, 24, 25, 26]);
  });

  it('o mês tem sempre 42 células, para a grade não pular de altura', () => {
    for (const mes of [0, 1, 4, 8, 11]) {
      const dias = diasDaGrade('mes', new Date(2026, mes, 1));
      expect(dias).toHaveLength(42);
      expect(dias[0].getDay()).toBe(0);
    }
  });

  it('a grade do mês abre no domingo anterior ao dia 1º e cobre o mês inteiro', () => {
    const dias = diasDaGrade('mes', new Date(2026, 8, 15)); // setembro/2026
    const doMes = dias.filter((d) => d.getMonth() === 8);
    expect(doMes).toHaveLength(30);
    expect(doMes[0].getDate()).toBe(1);
    expect(doMes[29].getDate()).toBe(30);
  });

  it('inicioDaSemana zera a hora — senão a comparação de dia erra à noite', () => {
    const d = inicioDaSemana(new Date(2026, 8, 24, 23, 45));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe('o período pedido à API', () => {
  it('termina na meia-noite do dia SEGUINTE ao último desenhado', () => {
    // timeMax do Google é exclusivo: parar na meia-noite do último dia
    // esconderia tudo o que acontece nele.
    const { de, ate } = periodoDaBusca('semana', new Date(2026, 8, 24));
    expect(de.getDate()).toBe(20);
    expect(ate.getDate()).toBe(27);
    expect(ate.getHours()).toBe(0);
  });

  it('no mês, cobre as seis semanas da grade', () => {
    const { de, ate } = periodoDaBusca('mes', new Date(2026, 8, 1));
    expect(Math.round((ate.getTime() - de.getTime()) / 86_400_000)).toBe(42);
  });
});

describe('andar no tempo', () => {
  it('na semana anda sete dias, inclusive virando o mês', () => {
    expect(mover('semana', new Date(2026, 8, 28), 1).getDate()).toBe(5);
    expect(mover('semana', new Date(2026, 8, 28), 1).getMonth()).toBe(9);
    expect(mover('semana', new Date(2026, 8, 3), -1).getDate()).toBe(27);
  });

  it('no mês anda de mês e vira o ano', () => {
    expect(mover('mes', new Date(2026, 11, 1), 1).getFullYear()).toBe(2027);
    expect(mover('mes', new Date(2026, 0, 1), -1).getMonth()).toBe(11);
  });
});

describe('o rótulo entre as setas', () => {
  it('no mês, mês e ano', () => {
    expect(rotuloDoPeriodo('mes', new Date(2026, 8, 1))).toBe('setembro de 2026');
  });

  it('na semana dentro do mesmo mês, o mês é dito uma vez', () => {
    expect(rotuloDoPeriodo('semana', new Date(2026, 8, 24))).toBe('20 – 26 de setembro');
  });

  it('na semana que vira o mês, os dois meses aparecem', () => {
    expect(rotuloDoPeriodo('semana', new Date(2026, 8, 30))).toBe('27 de setembro – 3 de outubro');
  });
});

describe('a régua de horas da semana', () => {
  it('sem evento, fica no expediente', () => {
    expect(faixaDeHoras([])).toEqual(FAIXA_PADRAO);
  });

  it('abre para caber a reunião das 7h e a das 21h', () => {
    const faixa = faixaDeHoras([
      evento({ id: '1', start: new Date(2026, 8, 24, 7, 0).toISOString(), end: new Date(2026, 8, 24, 8, 0).toISOString() }),
      evento({ id: '2', start: new Date(2026, 8, 25, 20, 0).toISOString(), end: new Date(2026, 8, 25, 21, 0).toISOString() }),
    ]);
    expect(faixa.primeira).toBe(7);
    expect(faixa.ultima).toBe(21);
  });

  it('quem termina 19h30 ganha a linha das 20h', () => {
    const faixa = faixaDeHoras([
      evento({ id: '1', start: new Date(2026, 8, 24, 18, 0).toISOString(), end: new Date(2026, 8, 24, 19, 30).toISOString() }),
    ]);
    expect(faixa.ultima).toBe(20);
  });

  it('dia inteiro não mexe na régua — ele mora na faixa de cima', () => {
    expect(faixaDeHoras([evento({ id: '1', diaInteiro: true, start: '2026-09-24' })])).toEqual(FAIXA_PADRAO);
  });
});

describe('onde o evento fica na coluna', () => {
  const faixa = { primeira: 8, ultima: 20 }; // 12 horas desenhadas

  it('as 14h ficam na metade de uma régua de 8h às 20h', () => {
    const pos = posicaoNaFaixa(
      evento({ id: '1', start: new Date(2026, 8, 24, 14, 0).toISOString(), end: new Date(2026, 8, 24, 15, 0).toISOString() }),
      faixa,
    )!;
    expect(pos.topo).toBeCloseTo(50, 5);
    expect(pos.altura).toBeCloseTo(100 / 12, 5); // uma hora em doze
  });

  it('dia inteiro não tem lugar na régua', () => {
    expect(posicaoNaFaixa(evento({ id: '1', diaInteiro: true, start: '2026-09-24' }), faixa)).toBeNull();
  });

  it('o que começa antes da régua é cortado na borda, não empurrado', () => {
    const pos = posicaoNaFaixa(
      evento({ id: '1', start: new Date(2026, 8, 24, 6, 0).toISOString(), end: new Date(2026, 8, 24, 9, 0).toISOString() }),
      faixa,
    )!;
    expect(pos.topo).toBe(0);
    expect(pos.altura).toBeCloseTo(100 / 12, 5); // só a hora que cabe (8h–9h)
  });

  it('o que acaba depois da régua também é cortado, e não estoura a coluna', () => {
    const pos = posicaoNaFaixa(
      evento({ id: '1', start: new Date(2026, 8, 24, 19, 0).toISOString(), end: new Date(2026, 8, 24, 23, 0).toISOString() }),
      faixa,
    )!;
    expect(pos.topo + pos.altura).toBeLessThanOrEqual(100.0001);
  });

  it('reunião relâmpago ainda ganha altura clicável', () => {
    const pos = posicaoNaFaixa(
      evento({ id: '1', start: new Date(2026, 8, 24, 10, 0).toISOString(), end: new Date(2026, 8, 24, 10, 5).toISOString() }),
      faixa,
    )!;
    expect(pos.altura).toBeGreaterThanOrEqual((15 / 720) * 100);
  });

  it('o que está inteiramente fora da régua some, em vez de encostar na borda', () => {
    expect(
      posicaoNaFaixa(
        evento({ id: '1', start: new Date(2026, 8, 24, 5, 0).toISOString(), end: new Date(2026, 8, 24, 6, 0).toISOString() }),
        faixa,
      ),
    ).toBeNull();
  });
});
