'use client';

import { useId } from 'react';

import { iniciais } from './lista-do-funil';

/*
 * O RESPONSÁVEL COMO AVATAR (rodada de produção 3, I5, 22/10/2026).
 *
 * Um círculo com as iniciais e o nome num balão que aparece ao passar o mouse e
 * no foco do teclado (o leitor de tela lê o nome pelo rótulo). Isolado aqui,
 * pequeno, para a troca pelo avatar com foto (lane D) ser uma linha só.
 * Sem responsável: o círculo tracejado e a frase "sem responsável".
 */
export function CelulaDoResponsavel({ nome, testId }: { nome: string | null | undefined; testId?: string }) {
  const id = useId();
  const n = nome?.trim() || null;
  const texto = n ?? 'sem responsável';
  return (
    <span
      className="group relative inline-flex align-middle outline-none"
      tabIndex={0}
      role="img"
      aria-label={n ? `Responsável: ${n}` : 'Sem responsável'}
      aria-describedby={id}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-os-mono text-[10.5px] font-semibold ${
          n ? 'bg-brand/15 text-brand' : 'border border-dashed border-border text-dim'
        } group-focus-visible:ring-2 group-focus-visible:ring-brand`}
      >
        {n ? iniciais(n) : '?'}
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-text opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {texto}
      </span>
    </span>
  );
}
