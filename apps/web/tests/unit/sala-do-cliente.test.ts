import { describe, expect, it } from 'vitest';

import { abrirSala, dataCurta, explicarEstado, localSPParaIso, reais, rotuloDoHorario, soDigitos } from '../../src/lib/sala-do-cliente';

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

  it('B-11: abrir a sala é um POST de visita, uma vez por abertura, e a resposta é o estado', async () => {
    const pedidos: string[] = [];
    let soltar: (v: { estagio: string }) => void = () => undefined;
    const post = (caminho: string) => {
      pedidos.push(caminho);
      return new Promise<{ estagio: string }>((r) => (soltar = r));
    };
    // O modo estrito monta a página duas vezes: o segundo pedido reusa o primeiro.
    const a = abrirSala('/sala/tok', post);
    const b = abrirSala('/sala/tok', post);
    expect(pedidos).toEqual(['/sala/tok/visita']);
    soltar({ estagio: 'conversa' });
    expect(await a).toEqual({ estagio: 'conversa' });
    expect(await b).toEqual({ estagio: 'conversa' });
    // Terminado o pedido, abrir de novo conta outra visita.
    const c = abrirSala('/sala/tok', post);
    soltar({ estagio: 'proposta' });
    await c;
    expect(pedidos).toEqual(['/sala/tok/visita', '/sala/tok/visita']);
  });

  it('B-11: a visita que falha libera a próxima abertura', async () => {
    const pedidos: string[] = [];
    await expect(abrirSala('/sala/falha', async (c) => (pedidos.push(c), Promise.reject(new Error('429'))))).rejects.toThrow('429');
    await abrirSala('/sala/falha', async (c) => (pedidos.push(c), { ok: true }));
    expect(pedidos).toEqual(['/sala/falha/visita', '/sala/falha/visita']);
  });
});
