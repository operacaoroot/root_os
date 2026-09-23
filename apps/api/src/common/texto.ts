/*
 * Texto que vai para uma coluna do Postgres não pode levar metade de um par
 * substituto (emoji, símbolo fora do plano básico): o Prisma recusa a escrita
 * inteira com "unexpected end of hex escape", e a linha não entra. `slice`
 * corta em unidade de 16 bits e parte o par; um corte feito ANTES, por quem
 * nos entregou o texto (o conector do Gmail corta o corpo em 20.000), também.
 */

/** Corta em ponto de código, nunca no meio de um par substituto. */
export function cortarSemPartirCaractere(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const pontos = Array.from(texto);
  let usado = 0;
  let i = 0;
  while (i < pontos.length && usado + pontos[i].length <= limite) {
    usado += pontos[i].length;
    i++;
  }
  return pontos.slice(0, i).join('');
}

/** Tira a metade de par substituto que chegou sozinha. O resto do texto fica como está. */
export function semSubstitutoSolto(texto: string): string {
  return texto.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
