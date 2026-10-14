/*
 * O teclado no funil (lane UX): os cartões são links; as setas andam entre
 * eles sem passar pelo Tab de cada botão. Fica fora do page.tsx porque página
 * do App Router não exporta nada além do componente.
 */
import type React from 'react';

/** As setas andam entre os cartões: para cima e para baixo na coluna, para os lados entre colunas. */
export function moverFocoNoFunil(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const atual = (e.target as HTMLElement).closest<HTMLElement>('[data-cartao-do-funil]');
  if (!atual) return;
  const grade = e.currentTarget;
  const colunas = Array.from(grade.querySelectorAll<HTMLElement>('[data-coluna-do-funil]'));
  const coluna = atual.closest<HTMLElement>('[data-coluna-do-funil]');
  if (!coluna) return;
  const daColuna = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-cartao-do-funil]'));
  const lista = daColuna(coluna);
  const i = lista.indexOf(atual);
  let alvo: HTMLElement | undefined;
  if (e.key === 'ArrowDown') alvo = lista[i + 1];
  else if (e.key === 'ArrowUp') alvo = lista[i - 1];
  else {
    const passo = e.key === 'ArrowRight' ? 1 : -1;
    for (let c = colunas.indexOf(coluna) + passo; c >= 0 && c < colunas.length; c += passo) {
      const outra = daColuna(colunas[c]);
      if (outra.length) {
        alvo = outra[Math.min(i, outra.length - 1)];
        break;
      }
    }
  }
  if (!alvo) return;
  e.preventDefault();
  alvo.focus();
}
