'use client';

import { useEffect } from 'react';

/*
 * A MÃOZINHA (layout 26/10): em toda área do OS que rola para o lado (o quadro do
 * Trabalho, o funil, a esteira), clicar num espaço livre e arrastar leva a tela junto,
 * para os lados e para cima/baixo, sem precisar descer até a barra de rolagem.
 *
 * Só começa num espaço livre: botão, link, campo, cartão que se arrasta (mudar de etapa),
 * aba e tabela continuam como eram (na tabela, arrastar seleciona texto). Um elemento com
 * `data-sem-arrastar` também fica de fora. Arrastou de verdade (mais de 4px)? O clique
 * que viria ao soltar é engolido, para não abrir nada sem querer.
 */

const LIVRE_NAO =
  'a,button,input,select,textarea,label,summary,option,video,audio,iframe,table,pre,[contenteditable=""],[contenteditable="true"],[draggable="true"],[role="button"],[role="slider"],[role="tab"],[role="option"],[role="menuitem"],[role="dialog"],[aria-roledescription],[data-sem-arrastar]';

function rolaDeLado(n: HTMLElement): boolean {
  if (n.scrollWidth <= n.clientWidth + 1) return false;
  const ox = getComputedStyle(n).overflowX;
  return ox === 'auto' || ox === 'scroll';
}

function rolaParaBaixo(n: HTMLElement): boolean {
  if (n.scrollHeight <= n.clientHeight + 1) return false;
  const oy = getComputedStyle(n).overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/** A área que rola de lado onde o arrasto pode começar, ou nada. */
function areaDoArrasto(alvo: EventTarget | null): HTMLElement | null {
  if (!(alvo instanceof Element) || alvo.closest(LIVRE_NAO)) return null;
  for (let n: Element | null = alvo; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLElement && rolaDeLado(n)) return n;
  }
  return null;
}

export function ArrastarParaRolar() {
  useEffect(() => {
    let marcada: HTMLElement | null = null;
    let arrasto: { area: HTMLElement; x: number; y: number; esq: number; topo: number; pagina: boolean; andou: boolean } | null = null;

    // O cursor de mãozinha só onde o arrasto vale.
    const passar = (e: MouseEvent) => {
      if (arrasto) return;
      const area = areaDoArrasto(e.target);
      if (area === marcada) return;
      marcada?.removeAttribute('data-arrastavel');
      marcada = area;
      marcada?.setAttribute('data-arrastavel', '');
    };

    const descer = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const area = areaDoArrasto(e.target);
      if (!area) return;
      const pagina = !rolaParaBaixo(area);
      const vertical = pagina ? document.scrollingElement ?? document.documentElement : area;
      arrasto = { area, x: e.clientX, y: e.clientY, esq: area.scrollLeft, topo: vertical.scrollTop, pagina, andou: false };
    };

    const mover = (e: MouseEvent) => {
      if (!arrasto) return;
      const dx = e.clientX - arrasto.x;
      const dy = e.clientY - arrasto.y;
      if (!arrasto.andou) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        arrasto.andou = true;
        document.documentElement.setAttribute('data-arrastando', '');
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      arrasto.area.scrollLeft = arrasto.esq - dx;
      const vertical = arrasto.pagina ? document.scrollingElement ?? document.documentElement : arrasto.area;
      vertical.scrollTop = arrasto.topo - dy;
    };

    const engolirClique = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const soltar = () => {
      if (!arrasto) return;
      if (arrasto.andou) {
        document.documentElement.removeAttribute('data-arrastando');
        window.addEventListener('click', engolirClique, { capture: true, once: true });
        // Se o clique não vier (soltou fora da janela), o próximo clique de verdade não pode sumir.
        setTimeout(() => window.removeEventListener('click', engolirClique, { capture: true }), 0);
      }
      arrasto = null;
    };

    document.addEventListener('mouseover', passar);
    document.addEventListener('mousedown', descer);
    window.addEventListener('mousemove', mover, { passive: false });
    window.addEventListener('mouseup', soltar);
    window.addEventListener('blur', soltar);
    return () => {
      document.removeEventListener('mouseover', passar);
      document.removeEventListener('mousedown', descer);
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      window.removeEventListener('blur', soltar);
      window.removeEventListener('click', engolirClique, { capture: true });
      marcada?.removeAttribute('data-arrastavel');
      document.documentElement.removeAttribute('data-arrastando');
    };
  }, []);

  return null;
}
