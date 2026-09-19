import { describe, expect, it } from 'vitest';
import { configurarBodyParser } from '../src/common/configurar-body-parser';

describe('parser HTTP da remessa', () => {
  it('mantém formulário e JSON comum no limite antigo, abrindo apenas remessa JSON', () => {
    const parsers: Array<{ tipo: string; opcoes: Record<string, any> }> = [];
    configurarBodyParser({
      useBodyParser(tipo, opcoes) { parsers.push({ tipo, opcoes: opcoes ?? {} }); },
    });

    expect(parsers.map(({ tipo }) => tipo)).toEqual(['json', 'json', 'urlencoded']);
    expect(parsers[0].opcoes.limit).toBe('12mb');
    expect(parsers[1].opcoes.limit).toBe('100kb');
    expect(parsers[2].opcoes.limit).toBe('100kb');

    const remessa = { path: '/api/conector/remessa', headers: { 'content-type': 'application/json' } };
    const caminhoParecido = { path: '/outro/conector/remessa', headers: { 'content-type': 'application/json' } };
    const prefixoParecido = { path: '/outro/api/conector/remessa', headers: { 'content-type': 'application/json' } };
    const remessaSemJson = { path: '/api/conector/remessa', headers: { 'content-type': 'application/x-www-form-urlencoded' } };
    const comum = { path: '/api/auth/login', headers: { 'content-type': 'application/json; charset=utf-8' } };
    expect(parsers[0].opcoes.type(remessa)).toBe(true);
    expect(parsers[0].opcoes.type(caminhoParecido)).toBe(false);
    expect(parsers[0].opcoes.type(prefixoParecido)).toBe(false);
    expect(parsers[0].opcoes.type(remessaSemJson)).toBe(false);
    expect(parsers[1].opcoes.type(comum)).toBe(true);
    expect(parsers[1].opcoes.type(remessa)).toBe(false);
  });
});
