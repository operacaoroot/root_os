'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { NavItem } from '@mktos/shared';
import { rotuloDoDestino } from './navegacao-modulos';

/*
 * O BALÃO DA ÁREA no menu recolhido (rodada da interface, 20/10/2026, U1, item 3).
 *
 * Com o menu em 64 px (só ícones), passar o mouse, focar pelo teclado ou tocar no
 * ícone de uma área abre este balão ao lado, com as subseções dela. Quem abre, fecha
 * e decide qual balão está aberto é o `Sidebar` (um por vez); aqui mora o desenho e
 * o teclado de dentro: setas andam pelos links, Home e End vão às pontas, Esc fecha
 * e devolve o foco ao ícone. Enter abre o link, como todo link.
 *
 * Fica no DOM logo depois do ícone, e não num portal: assim o Tab sai do ícone e
 * entra nos links, e do último link vai ao ícone seguinte, sem foco preso. A posição
 * é `fixed`, calculada do retângulo do ícone (`getBoundingClientRect`), porque o menu
 * rola (`overflow-y-auto`) e um balão absoluto seria cortado por ele. Para o `fixed`
 * valer na tela, o menu não pode ter `transform` no desktop: o `Sidebar` põe
 * `transform-none` de 820 px para cima.
 */

const MARGEM = 8;

export function BalaoDaArea({
  id,
  titulo,
  itens,
  atual,
  ancora,
  aoFechar,
  aoNavegar,
}: {
  id: string;
  titulo: string;
  itens: readonly NavItem[];
  /** A `key` do item da rota atual, para o `aria-current`. */
  atual?: string;
  /** O ícone da área: o balão se alinha a ele e devolve o foco a ele. */
  ancora: HTMLElement | null;
  /** `devolverFoco` = o fechamento veio do Esc e o foco volta ao ícone. */
  aoFechar: (devolverFoco: boolean) => void;
  aoNavegar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!ancora) return;
    const r = ancora.getBoundingClientRect();
    const altura = caixa.current?.offsetHeight ?? 0;
    const alturaDaJanela = window.innerHeight || 0;
    // Alinha o topo ao do ícone; se passaria do fim da janela, sobe o que faltar.
    let top = r.top;
    if (alturaDaJanela && altura && top + altura > alturaDaJanela - MARGEM) top = Math.max(MARGEM, alturaDaJanela - altura - MARGEM);
    setPosicao({ top, left: r.right + 4 });
  }, [ancora, itens.length]);

  function links(): HTMLAnchorElement[] {
    return Array.from(caixa.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    const todos = links();
    const i = todos.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      aoFechar(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!todos.length) return;
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      todos[(i + passo + todos.length) % todos.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      todos[e.key === 'Home' ? 0 : todos.length - 1]?.focus();
    }
  }

  return (
    <div
      ref={caixa}
      id={id}
      role="group"
      aria-labelledby={`${id}-titulo`}
      data-balao-da-area
      onKeyDown={aoTeclar}
      style={{ position: 'fixed', top: posicao?.top ?? 0, left: posicao?.left ?? 0, visibility: posicao ? 'visible' : 'hidden' }}
      className="z-[70] min-w-[200px] max-w-[280px] rounded-root border border-border-strong bg-bg2 py-2 font-os-mono shadow-[0_8px_24px_rgb(0_0_0/0.35)]"
    >
      <p id={`${id}-titulo`} className="px-3 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted">
        {titulo}
      </p>
      <ul className="m-0 list-none p-0">
        {itens.map((item) => {
          const aqui = item.key === atual;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                onClick={aoNavegar}
                aria-current={aqui ? 'page' : undefined}
                title={item.key === 'fluxos' ? 'Processos: em preparação' : undefined}
                className={`flex min-h-9 items-center gap-2 px-3 py-2 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${aqui ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
              >
                {rotuloDoDestino(item)}
                {item.key === 'fluxos' && <span className="text-[10px]">em preparação</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
