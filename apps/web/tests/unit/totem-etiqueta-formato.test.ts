/**
 * OS TEXTOS DA ETIQUETA — a ficha que o QR abre (`/p/<codigo>`) e a etiqueta
 * térmica que o painel imprime.
 *
 * Preço só aparece quando a API mandou; a validade fala a situação que a API
 * calculou; o QR aponta para o host de quem imprimiu; e o CSS de impressão
 * troca o tamanho do papel sem margem.
 */
import { describe, expect, it } from 'vitest';
import { totemLoteDataDoDia } from '@mktos/shared';

import {
  codigoLegivel,
  linhaNutricional,
  precoDaFicha,
  textoDaPorcao,
  textoDaValidade,
  urlCurtaDaEtiqueta,
  urlDaEtiqueta,
} from '@/app/p/formato';
import { cssDaImpressao, ehFormatoDeEtiqueta, svgDoQr } from '@/app/totem-gestao/etiquetas/impressao';

describe('preço da ficha', () => {
  it('sem preço não há linha', () => {
    expect(precoDaFicha(undefined, undefined)).toBeNull();
    expect(precoDaFicha(null, 'kg')).toBeNull();
  });

  it('formata em reais com a unidade por extenso', () => {
    expect(precoDaFicha(8990, 'kg')).toBe('R$ 89,90 o quilo');
    expect(precoDaFicha(129, '100g')).toBe('R$ 1,29 a cada 100 g');
    expect(precoDaFicha(123456, 'un')).toBe('R$ 1.234,56 a unidade');
    expect(precoDaFicha(500, null)).toBe('R$ 5,00');
  });
});

describe('código e endereço da etiqueta', () => {
  it('separa o código em dois blocos de cinco', () => {
    expect(codigoLegivel('ABCDE12345')).toBe('ABCDE-12345');
    expect(codigoLegivel('ABC')).toBe('ABC');
  });

  it('o QR aponta para /p/<codigo> no host de quem imprimiu', () => {
    expect(urlDaEtiqueta('https://sragranel.operacaoroot.com', 'ABCDE12345')).toBe(
      'https://sragranel.operacaoroot.com/p/ABCDE12345',
    );
    expect(urlDaEtiqueta('http://localhost:4000/', 'ABCDE12345')).toBe('http://localhost:4000/p/ABCDE12345');
  });

  it('a URL impressa sai sem o protocolo', () => {
    expect(urlCurtaDaEtiqueta('https://sragranel.operacaoroot.com', 'ABCDE12345')).toBe(
      'sragranel.operacaoroot.com/p/ABCDE12345',
    );
  });
});

describe('texto da validade', () => {
  const hoje = totemLoteDataDoDia('2026-10-11');

  it('vencido pede para avisar a loja', () => {
    expect(textoDaValidade('vencido', '2026-10-10', hoje)).toBe('Lote vencido em 10/10/2026. Avise a equipe da loja.');
  });

  it('atenção conta os dias', () => {
    expect(textoDaValidade('atencao', '2026-10-11', hoje)).toBe('Vence hoje, 11/10/2026.');
    expect(textoDaValidade('atencao', '2026-10-12', hoje)).toBe('Vence amanhã, 12/10/2026.');
    expect(textoDaValidade('atencao', '2026-10-21', hoje)).toBe('Vence em 10 dias, em 21/10/2026.');
  });

  it('no prazo mostra a data', () => {
    expect(textoDaValidade('ok', '2027-01-31', hoje)).toBe('Dentro da validade, que vai até 31/01/2027.');
  });
});

describe('porção e tabela nutricional', () => {
  it('monta a porção com e sem descrição', () => {
    expect(textoDaPorcao(null, null)).toBeNull();
    expect(textoDaPorcao(40, '2 colheres de sopa')).toBe('Porção de 40 g (2 colheres de sopa)');
    expect(textoDaPorcao(12.5, null)).toBe('Porção de 12,5 g');
    expect(textoDaPorcao(null, '1 unidade')).toBe('Porção: 1 unidade');
  });

  it('usa vírgula decimal e traço sem %VD', () => {
    expect(linhaNutricional({ nutriente: 'Proteínas', quantidade: 12.5, unidade: 'g', vd: 17 })).toEqual({
      quantidade: '12,5 g',
      vd: '17%',
    });
    expect(linhaNutricional({ nutriente: 'Açúcares', quantidade: 0, unidade: 'g', vd: null }).vd).toBe('—');
  });
});

describe('impressão da etiqueta', () => {
  it('cada formato vira um @page do tamanho do papel, sem margem', () => {
    expect(cssDaImpressao('60x40')).toContain('@page { size: 60mm 40mm; margin: 0; }');
    expect(cssDaImpressao('100x50')).toContain('@page { size: 100mm 50mm; margin: 0; }');
  });

  it('a impressão esconde o painel e mostra só a folha', () => {
    const css = cssDaImpressao('60x40');
    expect(css).toContain('body > *:not(#folha-de-etiquetas) { display: none !important; }');
    expect(css).toContain('#folha-de-etiquetas { display: block; }');
  });

  it('só aceita os dois formatos', () => {
    expect(ehFormatoDeEtiqueta('60x40')).toBe(true);
    expect(ehFormatoDeEtiqueta('100x50')).toBe(true);
    expect(ehFormatoDeEtiqueta('80x40')).toBe(false);
    expect(ehFormatoDeEtiqueta(null)).toBe(false);
  });

  it('o QR sai em SVG preto no branco', async () => {
    const svg = await svgDoQr('https://sragranel.operacaoroot.com/p/ABCDE12345');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#000000');
  });
});
