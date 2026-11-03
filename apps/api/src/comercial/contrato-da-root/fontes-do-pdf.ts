/*
 * AS FONTES BASE-14 DO PDF DO CONTRATO (Contratos, F2, 02/11/2026) — puro.
 *
 * Larguras das métricas AFM da Adobe (Times-Roman e Times-Bold, tiradas das tabelas do AFM
 * padrão, glifo a glifo, pela codificação WinAnsi), em milésimos do corpo, do código 32 ao
 * 255. Courier é monoespaçada: 600 em tudo. É dado, não se calcula: sem a largura real a
 * quebra de linha e a justificação erram a margem.
 */

export type FonteDoPdf = 'Times-Roman' | 'Times-Bold' | 'Courier';

const LARGURAS_TIMES_ROMAN: readonly number[] = [
  250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,
  500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,
  556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,
  500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,350,
  500,350,333,500,444,1000,500,500,333,1000,556,333,889,350,611,350,350,333,333,444,444,350,500,1000,
  333,980,389,333,722,350,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,
  400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,
  611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,
  444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,
  500,500,500,500,500,500,500,500,
];

const LARGURAS_TIMES_BOLD: readonly number[] = [
  250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,
  500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,
  611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,
  556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,350,
  500,350,333,500,500,1000,500,500,333,1000,556,333,1000,350,667,350,350,333,333,500,500,350,500,1000,
  333,1000,389,333,722,350,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,
  400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,
  667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,
  500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,
  500,556,556,556,556,500,556,500,
];

const CODIGOS_DE_32_A_255 = 224;
const LARGURAS_COURIER: readonly number[] = new Array<number>(CODIGOS_DE_32_A_255).fill(600);

const LARGURAS: Record<FonteDoPdf, readonly number[]> = {
  'Times-Roman': LARGURAS_TIMES_ROMAN,
  'Times-Bold': LARGURAS_TIMES_BOLD,
  Courier: LARGURAS_COURIER,
};

/** A tabela `/Widths` da fonte, do código 32 ao 255. */
export function tabelaDeLarguras(fonte: FonteDoPdf): readonly number[] {
  return LARGURAS[fonte];
}

/** Os caracteres da faixa 0x80–0x9F do WinAnsi (cp1252); o resto de 0xA0 a 0xFF é latin-1. */
const WIN_ANSI_ALTO: ReadonlyMap<number, number> = new Map(
  [
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
    [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
    [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ] as const,
);

/**
 * Um texto em WinAnsi: cada caractere do retorno é um byte. O que não existe em WinAnsi vira
 * `?` e entra em `avisos`, nunca quebra. Espaço duro vira espaço; hífen opcional e caractere
 * de controle somem.
 */
export function paraWinAnsi(texto: string, avisos: Set<string>): string {
  let saida = '';
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0) as number;
    if (c === 0xa0 || c === 0x09) saida += ' ';
    else if (c === 0xad || c < 0x20 || c === 0x7f) continue;
    else if (c < 0x7f || (c > 0xa0 && c <= 0xff)) saida += ch;
    else if (WIN_ANSI_ALTO.has(c)) saida += String.fromCharCode(WIN_ANSI_ALTO.get(c) as number);
    else {
      saida += '?';
      avisos.add(`caractere fora do WinAnsi trocado por "?": ${ch} (U+${c.toString(16).toUpperCase().padStart(4, '0')})`);
    }
  }
  return saida;
}

/** Os caracteres que `paraWinAnsi` trocaria por "?", sem repetir. */
export function caracteresForaDoWinAnsi(texto: string): string[] {
  const avisos = new Set<string>();
  const fora = new Set<string>();
  for (const ch of String(texto ?? '').normalize('NFC')) {
    avisos.clear();
    paraWinAnsi(ch, avisos);
    if (avisos.size) fora.add(ch);
  }
  return [...fora];
}

/** A largura em pontos de um texto JÁ em WinAnsi. */
export function larguraDoTexto(winAnsi: string, fonte: FonteDoPdf, corpo: number): number {
  const tabela = LARGURAS[fonte];
  let soma = 0;
  for (let i = 0; i < winAnsi.length; i++) soma += tabela[winAnsi.charCodeAt(i) - 32] ?? 0;
  return (soma * corpo) / 1000;
}
