import { describe, expect, it } from 'vitest';
import { diasDesde, formatarHoras, hojeEmBrasilia, minutosDeTexto } from '@/lib/horas';

/*
 * As contas de hora da esteira de clientes. Pequenas, e é por isso que têm
 * teste: um "1,5" lido como 15 minutos ou uma idade de "-1d" passam despercebidos
 * na tela e envenenam o número que decide preço.
 */

describe('esteira: formatar e ler horas', () => {
  it('formata minutos como se fala', () => {
    expect(formatarHoras(45)).toBe('45min');
    expect(formatarHoras(60)).toBe('1h');
    expect(formatarHoras(90)).toBe('1h30');
    expect(formatarHoras(125)).toBe('2h05');
    expect(formatarHoras(1440)).toBe('24h');
  });

  it('lê "1,5", "1.5" e "1:30" como os mesmos 90 minutos', () => {
    expect(minutosDeTexto('1,5')).toBe(90);
    expect(minutosDeTexto('1.5')).toBe(90);
    expect(minutosDeTexto('1:30')).toBe(90);
    expect(minutosDeTexto(' 2 ')).toBe(120);
    expect(minutosDeTexto('0,25')).toBe(15);
  });

  it('recusa o que não é hora: vazio, zero, negativo, mais de 24h, minuto inválido', () => {
    for (const ruim of ['', '0', '-1', '24,5', '25:00', '1:75', 'uma hora', '1,5h']) {
      expect(minutosDeTexto(ruim)).toBeNull();
    }
  });
});

describe('esteira: idade do cartão e o dia de hoje', () => {
  const agora = new Date('2026-09-17T15:00:00Z');

  it('conta dias inteiros na etapa', () => {
    expect(diasDesde('2026-09-17T09:00:00Z', agora)).toBe(0);
    expect(diasDesde('2026-09-05T15:00:00Z', agora)).toBe(12);
  });

  it('sem data não há idade — nunca "0d" inventado', () => {
    expect(diasDesde(null, agora)).toBeNull();
    expect(diasDesde(undefined, agora)).toBeNull();
  });

  it('relógio adiantado do servidor não vira idade negativa', () => {
    expect(diasDesde('2026-09-17T16:00:00Z', agora)).toBe(0);
  });

  it('"hoje" é o de Brasília, igual ao da API', () => {
    expect(hojeEmBrasilia(new Date('2026-09-17T01:30:00Z'))).toBe('2026-09-16');
  });
});
