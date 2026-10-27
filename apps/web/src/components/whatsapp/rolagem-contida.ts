/*
 * A RODA DO MOUSE PRESA DENTRO DO POPUP (leva 5, L7, 27/10/2026).
 *
 * Pedido do Rodrigo: a roda do mouse tem de rolar o Chat quando o cursor está
 * sobre ele, e nunca a página atrás. `overscroll-behavior: contain` resolve
 * metade: o Chrome só o respeita num container que TEM o que rolar. Quando a
 * lista cabe inteira (conversa curta, lista com três contatos), o container não
 * conta como rolável, a roda "encadeia" para a página e o OS inteiro desce com
 * o popup parado em cima. É por isso que existe esta trava, nativa e com
 * `passive: false` (o `onWheel` do React é passivo e ignora `preventDefault`).
 *
 * A regra: a roda só segue para o navegador se algum elemento entre o alvo e a
 * raiz do popup consegue rolar NA DIREÇÃO pedida. Senão, o evento morre aqui e a
 * página fica onde estava. Horizontal e zoom (Ctrl) não são da nossa conta.
 */

/** O elemento rola na vertical, e ainda tem para onde ir no sentido de `deltaY`? */
export function rolavelNaDirecao(el: HTMLElement, deltaY: number): boolean {
  const overflow = (el.ownerDocument.defaultView ?? window).getComputedStyle(el).overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  if (el.scrollHeight <= el.clientHeight) return false;
  if (deltaY < 0) return el.scrollTop > 0;
  if (deltaY > 0) return Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight;
  return false;
}

/** Entre o alvo e a raiz (inclusive), algum container consegue consumir esta roda? */
export function algoRolaDentro(alvo: EventTarget | null, raiz: HTMLElement, deltaY: number): boolean {
  let el: HTMLElement | null = alvo instanceof HTMLElement ? alvo : null;
  while (el && raiz.contains(el)) {
    if (rolavelNaDirecao(el, deltaY)) return true;
    if (el === raiz) break;
    el = el.parentElement;
  }
  return false;
}

/**
 * Liga a trava na raiz do popup. Devolve a função que a desliga.
 *
 * Fica fora do React de propósito: desde o React 17 o `wheel` é registrado como
 * passivo, e `preventDefault` num ouvinte passivo é ignorado com aviso no console.
 */
export function conterRodaDoMouse(raiz: HTMLElement | null): () => void {
  if (!raiz) return () => {};
  const aoRodar = (e: WheelEvent) => {
    if (e.ctrlKey || e.deltaY === 0) return;
    if (!algoRolaDentro(e.target, raiz, e.deltaY)) e.preventDefault();
  };
  raiz.addEventListener('wheel', aoRodar, { passive: false });
  return () => raiz.removeEventListener('wheel', aoRodar);
}
