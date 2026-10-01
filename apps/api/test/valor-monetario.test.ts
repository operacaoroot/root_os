import { describe, expect, it } from 'vitest';
import {
  ehValorMonetarioCanonico, formatarValorMonetario, lerValorDigitadoPtBr, moedaDoValor, motivoDaMoedaECasas,
  paraDigitarPtBr, valorMonetarioCanonico,
} from '@mktos/shared';

/*
 * A REGRA DO VALOR MONETÁRIO DO TRABALHO (ROOT-06a, com as erratas E11 e E13).
 *
 * A mesma função serve o importador do ClickUp, a API e a tela, então o que se
 * cobra aqui vale para os três: a origem (texto ou número JSON) vira o canônico
 * `BRL 1500.00` sem ponto flutuante e sem arredondar; o canônico é conferido do
 * jeito que a API confere; a digitação pt-BR ida e volta devolve o mesmo
 * canônico; e a tela mostra `R$ 1.500,00`.
 *
 * O gerador da ida e volta é exato (Math.imul, 32 bits) e o teste confere a
 * cobertura que ele produziu: de 1 a 12 dígitos inteiros, com sinal e com zero.
 * O gerador do protótipo da ROOT-06a passava de 2^53 e repetia 930 valores.
 */

const MOTIVO_DECIMAL = 'fora do formato decimal (sem expoente, vírgula, espaço, símbolo ou zero à esquerda)';
const MOTIVO_DIGITACAO = 'use vírgula para os centavos e ponto só para milhar';

describe('origem para canônico', () => {
  const casos: Array<[unknown, string, number, string]> = [
    ['1500', 'BRL', 2, 'BRL 1500.00'],
    ['1500.5', 'BRL', 2, 'BRL 1500.50'],
    ['1500.50', 'BRL', 2, 'BRL 1500.50'],
    [1500.5, 'BRL', 2, 'BRL 1500.50'],
    [1500, 'BRL', 2, 'BRL 1500.00'],
    ['0', 'BRL', 2, 'BRL 0.00'],
    [0, 'BRL', 2, 'BRL 0.00'],
    [-0, 'BRL', 2, 'BRL 0.00'],
    ['-0.00', 'BRL', 2, 'BRL 0.00'],
    ['-0', 'BRL', 2, 'BRL 0.00'],
    ['0.00', 'BRL', 2, 'BRL 0.00'],
    ['0.5', 'BRL', 2, 'BRL 0.50'],
    ['0.10', 'BRL', 2, 'BRL 0.10'],
    ['-20.5', 'BRL', 2, 'BRL -20.50'],
    [-1500.5, 'BRL', 2, 'BRL -1500.50'],
    ['1500.500', 'BRL', 2, 'BRL 1500.50'],
    ['999999999999.99', 'BRL', 2, 'BRL 999999999999.99'],
    [999999999999.99, 'BRL', 2, 'BRL 999999999999.99'],
    [123456789012.34, 'BRL', 2, 'BRL 123456789012.34'],
    ['999999999999.990', 'BRL', 2, 'BRL 999999999999.99'],
    [1500.1, 'BRL', 2, 'BRL 1500.10'],
    ['1500', 'BRL', 0, 'BRL 1500.00'],
    ['1500', 'BRL', 1, 'BRL 1500.00'],
    ['1500.5', 'BRL', 1, 'BRL 1500.50'],
    ['12', 'JPY', 0, 'JPY 12.00'],
    ['12.34', 'USD', 2, 'USD 12.34'],
  ];
  it.each(casos)('%j (%s, %i casas) vira %s', (bruto, moeda, casas, esperado) => {
    expect(valorMonetarioCanonico(bruto, moeda, casas)).toEqual({ valor: esperado });
  });

  const recusas: Array<[unknown, string, number, string]> = [
    ['1500.555', 'BRL', 2, 'mais casas que a precisão 2'],
    ['-0.001', 'BRL', 2, 'mais casas que a precisão 2'],
    ['999999999999.999', 'BRL', 2, 'mais casas que a precisão 2'],
    [0.30000000000000004, 'BRL', 2, 'mais casas que a precisão 2'],
    ['1500.55', 'BRL', 1, 'mais casas que a precisão 1'],
    ['12.3', 'JPY', 0, 'mais casas que a precisão 0'],
    ['1.500,00', 'BRL', 2, MOTIVO_DECIMAL],
    ['1e3', 'BRL', 2, MOTIVO_DECIMAL],
    [1e21, 'BRL', 2, MOTIVO_DECIMAL],
    [1e-7, 'BRL', 2, MOTIVO_DECIMAL],
    ['', 'BRL', 2, MOTIVO_DECIMAL],
    [' 1500', 'BRL', 2, MOTIVO_DECIMAL],
    ['1500.00\n', 'BRL', 2, MOTIVO_DECIMAL],
    ['01500', 'BRL', 2, MOTIVO_DECIMAL],
    ['00.5', 'BRL', 2, MOTIVO_DECIMAL],
    ['1500.', 'BRL', 2, MOTIVO_DECIMAL],
    ['.5', 'BRL', 2, MOTIVO_DECIMAL],
    ['+1500', 'BRL', 2, MOTIVO_DECIMAL],
    ['1_500', 'BRL', 2, MOTIVO_DECIMAL],
    ['١٥٠٠', 'BRL', 2, MOTIVO_DECIMAL],
    ['R$ 1500', 'BRL', 2, MOTIVO_DECIMAL],
    ['1000000000000', 'BRL', 2, 'mais de 12 dígitos inteiros (teto de Decimal(14,2))'],
    [9007199254740991, 'BRL', 2, 'mais de 12 dígitos inteiros (teto de Decimal(14,2))'],
    [12345678901234567000, 'BRL', 2, 'mais de 12 dígitos inteiros (teto de Decimal(14,2))'],
    [Number.NaN, 'BRL', 2, 'número não finito'],
    [Number.POSITIVE_INFINITY, 'BRL', 2, 'número não finito'],
    [null, 'BRL', 2, 'tipo de valor inválido'],
    [undefined, 'BRL', 2, 'tipo de valor inválido'],
    [true, 'BRL', 2, 'tipo de valor inválido'],
    [{ valor: 1500 }, 'BRL', 2, 'tipo de valor inválido'],
    ['1500', 'XXY', 2, 'moeda XXY não suportada'],
    ['1500', 'brl', 2, 'código de moeda fora do formato de três letras maiúsculas'],
    ['1500', 'BRLL', 2, 'código de moeda fora do formato de três letras maiúsculas'],
    ['1500', 'BRL', 3, 'precisão 3 não suportada (o valor guarda até 2 casas)'],
    ['1500', 'BRL', 2.5, 'precisão 2.5 não suportada (o valor guarda até 2 casas)'],
    ['1500', 'BRL', -1, 'precisão -1 não suportada (o valor guarda até 2 casas)'],
  ];
  it.each(recusas)('%j (%s, %i casas) é recusado: %s', (bruto, moeda, casas, motivo) => {
    expect(valorMonetarioCanonico(bruto, moeda, casas)).toEqual({ motivo });
  });

  it('o motivo da recusa nunca repete o valor', () => {
    for (const [bruto, moeda, casas] of recusas) {
      const texto = String(bruto);
      if (texto.length < 3) continue;
      expect(valorMonetarioCanonico(bruto, moeda, casas).motivo).not.toContain(texto);
    }
  });

  // E13: são códigos da ISO 4217 que o ICU não traz; a recusa não pode dizer que
  // estão fora da ISO.
  it.each(['XTS', 'XXX', 'BOV'])('%s é "moeda não suportada", não "fora da ISO 4217"', (codigo) => {
    expect(motivoDaMoedaECasas(codigo, 2)).toBe(`moeda ${codigo} não suportada`);
    expect(valorMonetarioCanonico('1500', codigo, 2).motivo).toBe(`moeda ${codigo} não suportada`);
    expect(ehValorMonetarioCanonico(`${codigo} 1.00`)).toBe(false);
  });
});

describe('canônico, como a API confere', () => {
  it.each(['BRL 1500.00', 'BRL -20.50', 'BRL 0.00', 'BRL -0.01', 'BRL 999999999999.99', 'USD 1.00', 'JPY 12.00'])(
    'aceita %j', (c) => expect(ehValorMonetarioCanonico(c)).toBe(true),
  );
  it.each([
    'BRL -0.00', 'BRL 1500.0', 'BRL 1500', 'BRL 01500.00', 'XXY 1.00', 'BRL 1500.00 ', ' BRL 1500.00',
    'brl 1.00', 'BRL 1.500,00', 'BRL 1000000000000.00', 'BRL  1.00', 'BRL 1.00', 'R$ 1500.00', '',
  ])('recusa %j', (c) => expect(ehValorMonetarioCanonico(c)).toBe(false));
  it('recusa o que não é texto', () => {
    for (const v of [null, undefined, 1500, { valor: 'BRL 1.00' }]) expect(ehValorMonetarioCanonico(v)).toBe(false);
  });
  it('a moeda sai do canônico e de mais nada', () => {
    expect(moedaDoValor('USD 12.34')).toBe('USD');
    expect(moedaDoValor('R$ 12,34')).toBeNull();
    expect(moedaDoValor(null)).toBeNull();
  });
});

describe('digitação pt-BR', () => {
  it.each([
    ['1.500,00', 'BRL 1500.00'], ['1500,5', 'BRL 1500.50'], ['1500', 'BRL 1500.00'], ['1.500', 'BRL 1500.00'],
    ['1,5', 'BRL 1.50'], ['1.500,5', 'BRL 1500.50'], ['-20,50', 'BRL -20.50'], ['-0,00', 'BRL 0.00'],
    ['0001500', 'BRL 1500.00'], [' 1.500,00 ', 'BRL 1500.00'], ['1500,00 ', 'BRL 1500.00'],
    ['12.345.678.901,23', 'BRL 12345678901.23'], ['999.999.999.999,99', 'BRL 999999999999.99'],
    ['-999.999.999.999,99', 'BRL -999999999999.99'],
  ])('%j vira %s', (digitado, esperado) => {
    expect(lerValorDigitadoPtBr(digitado, 'BRL')).toEqual({ valor: esperado });
  });
  it.each([
    '1500.00', '1.50', '1.5', '15 mil', 'R$ 1.500,00', '0,001', '12.34.567,00', '', ',5', '1.500,', '1.500,000',
    '−20,50', '1 500,00', '1 500,00',
  ])('%j é recusado com a orientação da tela', (digitado) => {
    expect(lerValorDigitadoPtBr(digitado, 'BRL')).toEqual({ motivo: MOTIVO_DIGITACAO });
  });
  it('mais de 12 dígitos inteiros recusa com o motivo do teto', () => {
    expect(lerValorDigitadoPtBr('1.000.000.000.000,00', 'BRL')).toEqual({
      motivo: 'mais de 12 dígitos inteiros (teto de Decimal(14,2))',
    });
  });
  it('canônico vira o texto de digitação, e o que não é canônico vira vazio', () => {
    expect(paraDigitarPtBr('BRL 1500.00')).toBe('1.500,00');
    expect(paraDigitarPtBr('BRL -20.50')).toBe('-20,50');
    expect(paraDigitarPtBr('BRL 0.00')).toBe('0,00');
    expect(paraDigitarPtBr('BRL 999999999999.99')).toBe('999.999.999.999,99');
    expect(paraDigitarPtBr('R$ 1.500,00')).toBe('');
  });
});

describe('exibição na tela', () => {
  it.each([
    ['BRL 1500.00', 'R$ 1.500,00'],
    ['BRL -20.50', '-R$ 20,50'],
    ['BRL 0.00', 'R$ 0,00'],
    ['BRL 0.01', 'R$ 0,01'],
    ['BRL 999999999999.99', 'R$ 999.999.999.999,99'],
    ['BRL 999999999999.95', 'R$ 999.999.999.999,95'],
    ['BRL -999999999999.99', '-R$ 999.999.999.999,99'],
    ['USD 12.34', 'US$ 12,34'],
    // E13: sempre duas casas, também em moeda sem centavos.
    ['JPY 12.50', 'JP¥ 12,50'],
    ['JPY 12.00', 'JP¥ 12,00'],
  ])('%s aparece como %j', (canonico, tela) => {
    expect(formatarValorMonetario(canonico)).toBe(tela);
  });
  it('texto que não é canônico aparece como está', () => {
    expect(formatarValorMonetario('R$ 15 mil')).toBe('R$ 15 mil');
    expect(formatarValorMonetario('BRL -0.00')).toBe('BRL -0.00');
  });
});

/** mulberry32: aritmética inteira de 32 bits, sem perder exatidão em nenhum passo. */
function gerador(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe('ida e volta (E11)', () => {
  const proximo = gerador(0x06a);
  const canonicos: string[] = ['BRL 0.00', 'BRL 0.01', 'BRL -0.01', 'BRL 0.99', 'BRL 999999999999.99', 'BRL -999999999999.99'];
  for (let i = 0; i < 20_000; i++) {
    const digitos = 1 + (i % 12);
    let inteiro = String(1 + (proximo() % 9));
    for (let k = 1; k < digitos; k++) inteiro += String(proximo() % 10);
    if (digitos === 1 && proximo() % 10 === 0) inteiro = '0';
    const centavos = String(proximo() % 100).padStart(2, '0');
    const negativo = proximo() % 3 === 0 && !(inteiro === '0' && centavos === '00');
    canonicos.push(`BRL ${negativo ? '-' : ''}${inteiro}.${centavos}`);
  }

  it('a amostra cobre de 1 a 12 dígitos inteiros, sinal e zero', () => {
    const digitos = new Set(canonicos.map((c) => /^BRL -?(\d+)\./.exec(c)![1].length));
    expect([...digitos].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(canonicos.some((c) => c.includes('-'))).toBe(true);
    expect(canonicos.some((c) => c.startsWith('BRL 0.'))).toBe(true);
    expect(canonicos).toContain('BRL 0.00');
    expect(new Set(canonicos).size).toBeGreaterThan(18_000);
  });

  it('canônico, digitação e origem (texto e número JSON) voltam ao mesmo canônico', () => {
    const falhas: string[] = [];
    for (const c of canonicos) {
      const decimal = c.slice(4);
      const ok = ehValorMonetarioCanonico(c)
        && lerValorDigitadoPtBr(paraDigitarPtBr(c), 'BRL').valor === c
        && valorMonetarioCanonico(decimal, 'BRL', 2).valor === c
        // Até 14 algarismos significativos o número JSON volta exato pelo `String()`.
        && valorMonetarioCanonico(Number(decimal), 'BRL', 2).valor === c;
      if (!ok) falhas.push(c);
    }
    expect(falhas).toEqual([]);
  });
});
