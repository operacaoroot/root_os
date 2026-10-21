/*
 * NÚMERO POR EXTENSO, NOS DOIS SENTIDOS (rodada dos agentes, CO-13 e CO-14) — puro.
 *
 * O construtor da minuta (CO-13) escreve o valor por extenso a partir do número
 * da proposta aceita: o extenso é do SISTEMA, nunca do modelo. O revisor (CO-14)
 * faz o caminho contrário: lê "R$ 2.970,00 (dois mil, novecentos e setenta
 * reais)" e confere se o extenso diz o mesmo que o algarismo (o defeito mais
 * comum do acervo de contratos). Português do Brasil, até centenas de milhões.
 */

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 a 999 por extenso. */
function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/** Um inteiro de 0 a 999.999.999 por extenso ("mil e duzentos", "dois milhões e trezentos mil"). */
export function inteiroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new RangeError(`fora do alcance: ${n}`);
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  // `base`: o número de 1 a 999 do grupo (as centenas dos milhões, dos milhares ou do resto).
  const grupos: { texto: string; base: number }[] = [];
  if (milhoes) grupos.push({ texto: milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`, base: milhoes });
  if (milhares) grupos.push({ texto: milhares === 1 ? 'mil' : `${ate999(milhares)} mil`, base: milhares });
  if (resto) grupos.push({ texto: ate999(resto), base: resto });
  // O "e" entre grupos: só antes do último, quando ele é menor que cem ou centena redonda ("mil e duzentos").
  let saida = grupos[0].texto;
  for (let i = 1; i < grupos.length; i++) {
    const g = grupos[i];
    const comE = i === grupos.length - 1 && (g.base < 100 || g.base % 100 === 0);
    saida += comE ? ` e ${g.texto}` : ` ${g.texto}`;
  }
  return saida;
}

/** Centavos em reais por extenso ("dois mil novecentos e setenta reais", "um real e cinquenta centavos"). */
export function reaisPorExtenso(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos < 0) throw new RangeError(`centavos inválidos: ${centavos}`);
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  const partes: string[] = [];
  if (reais) {
    const exatoEmMilhoes = reais % 1_000_000 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${exatoEmMilhoes ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cents) partes.push(`${inteiroPorExtenso(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero reais';
}

const VALOR_DA_PALAVRA: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
};

function palavras(texto: string): string[] {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/qüinqu|quinqu/g, 'cinqu')
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Um inteiro escrito por extenso, ou `null` se tem palavra que não é número. */
function inteiroDasPalavras(ps: string[]): number | null {
  let total = 0;
  let grupo = 0;
  let viu = false;
  for (const p of ps) {
    if (p === 'e' || p === 'de') continue;
    if (p === 'mil') {
      total += (grupo || 1) * 1000;
      grupo = 0;
      viu = true;
      continue;
    }
    if (p === 'milhao' || p === 'milhoes') {
      total += (grupo || 1) * 1_000_000;
      grupo = 0;
      viu = true;
      continue;
    }
    if (!(p in VALOR_DA_PALAVRA)) return null;
    grupo += VALOR_DA_PALAVRA[p];
    viu = true;
  }
  return viu ? total + grupo : null;
}

/**
 * O valor em CENTAVOS que um texto por extenso diz ("dois mil, novecentos e setenta reais e
 * cinquenta centavos" → 297050). Sem "reais" e sem "centavos", lê como inteiro (×100). `null`
 * quando alguma palavra não é número (o revisor diz "não reconheci", em vez de chutar).
 */
export function centavosDoExtenso(texto: string): number | null {
  const ps = palavras(texto);
  if (!ps.length) return null;
  const iReal = ps.findIndex((p) => p === 'real' || p === 'reais');
  const iCent = ps.findIndex((p) => p === 'centavo' || p === 'centavos');
  if (iReal < 0 && iCent < 0) {
    const n = inteiroDasPalavras(ps);
    return n === null ? null : n * 100;
  }
  let reais = 0;
  let cents = 0;
  if (iReal >= 0) {
    const r = inteiroDasPalavras(ps.slice(0, iReal));
    if (r === null) return null;
    reais = r;
  }
  if (iCent >= 0) {
    const c = inteiroDasPalavras(ps.slice(iReal >= 0 ? iReal + 1 : 0, iCent));
    if (c === null) return null;
    cents = c;
  }
  return reais * 100 + cents;
}

/** Um inteiro por extenso ("três", "doze") ou `null`. */
export function inteiroDoExtenso(texto: string): number | null {
  return inteiroDasPalavras(palavras(texto));
}

/** "R$ 2.970,00" → 297000; "2970" → 297000; `null` quando não é número. */
export function centavosDoAlgarismo(texto: string): number | null {
  const limpo = String(texto ?? '').replace(/R\$\s*/i, '').trim();
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(limpo)) return null;
  const [inteiro, frac = ''] = limpo.split(',');
  const reais = Number(inteiro.replace(/\./g, ''));
  const cents = frac ? Number(frac.padEnd(2, '0')) : 0;
  return reais * 100 + cents;
}
