import { toString as qrEmTexto } from 'qrcode';

/*
 * As medidas da etiqueta térmica e o CSS de impressão, em funções puras para o
 * teste conferir o `@page` sem abrir o diálogo do navegador.
 */

export const FORMATOS_DE_ETIQUETA = {
  '60x40': { rotulo: '60 x 40 mm', larguraMm: 60, alturaMm: 40, qrMm: 22, nomePt: 8, linhaPt: 7, urlPt: 5.5 },
  '100x50': { rotulo: '100 x 50 mm', larguraMm: 100, alturaMm: 50, qrMm: 32, nomePt: 12, linhaPt: 9, urlPt: 7 },
} as const;

export type FormatoDeEtiqueta = keyof typeof FORMATOS_DE_ETIQUETA;

export function ehFormatoDeEtiqueta(valor: unknown): valor is FormatoDeEtiqueta {
  return typeof valor === 'string' && valor in FORMATOS_DE_ETIQUETA;
}

export const ID_DA_FOLHA = 'folha-de-etiquetas';

/**
 * Uma etiqueta por página, do tamanho exato do papel e sem margem. A folha fica
 * direto no `body` (portal), e a impressão esconde todo o resto do painel: com
 * `visibility` o resto ainda ocuparia altura e a impressora puxaria etiquetas em
 * branco no fim.
 */
export function cssDaImpressao(formato: FormatoDeEtiqueta): string {
  const f = FORMATOS_DE_ETIQUETA[formato];
  return [
    `@page { size: ${f.larguraMm}mm ${f.alturaMm}mm; margin: 0; }`,
    `#${ID_DA_FOLHA} { display: none; }`,
    '.qr-da-etiqueta svg { display: block; width: 100%; height: 100%; }',
    '@media print {',
    '  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }',
    `  body > *:not(#${ID_DA_FOLHA}) { display: none !important; }`,
    `  #${ID_DA_FOLHA} { display: block; }`,
    '  .etiqueta-impressa { break-after: page; page-break-after: always; }',
    '  .etiqueta-impressa:last-child { break-after: auto; page-break-after: auto; }',
    '}',
  ].join('\n');
}

/**
 * O QR em SVG, preto no branco. A margem de 2 módulos soma com o respiro da
 * etiqueta: sem ela, o texto ao lado encosta no QR e a câmera do celular erra.
 */
export function svgDoQr(url: string): Promise<string> {
  return qrEmTexto(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}
