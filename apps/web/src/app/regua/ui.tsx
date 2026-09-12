'use client';

import type { ReactNode } from 'react';
import type { Nivel } from './tipos';

/*
 * Peças visuais da tela da Régua. Nada aqui decide nada: a cor de um nível é
 * escolha de aparência, e o nível em si sempre chega pronto da API.
 */

/** Do mais frio ao mais quente. É estética, não regra — a régua mora no servidor. */
const COR: Record<Nivel, string> = {
  R0: 'bg-surface-2 text-muted',
  R1: 'bg-surface-2 text-text',
  R2: 'bg-good/15 text-good',
  R3: 'bg-brand/15 text-brand',
  R4: 'bg-warn/15 text-warn',
  R5: 'bg-bad/15 text-bad',
};

/**
 * `marca` existe para o teste conseguir apontar para O SELO, e não para o
 * cartão que o contém. O caso decisivo da tela é "o nível que aparece é o que o
 * servidor calculou": afirmá-lo sobre o texto do cartão inteiro é afirmar quase
 * nada, porque o motivo e a explicação repetem o nível ali do lado — a asserção
 * passaria com o selo mostrando outro degrau.
 */
export function Selo({
  nivel,
  grande = false,
  marca,
}: {
  nivel: Nivel;
  grande?: boolean;
  marca?: string;
}) {
  return (
    <span
      data-testid={marca}
      className={`inline-flex items-center rounded font-mono font-medium ${COR[nivel] ?? COR.R0} ${
        grande ? 'px-3 py-1 text-lg' : 'px-1.5 py-0.5 text-[11px]'
      }`}
    >
      {nivel}
    </span>
  );
}

export function Cartao({
  titulo,
  aviso,
  children,
}: {
  titulo?: string;
  aviso?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      {titulo && <h2 className="text-sm font-medium">{titulo}</h2>}
      {aviso && <p className="mt-1 text-xs text-muted">{aviso}</p>}
      <div className={titulo || aviso ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{children}</span>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export const inputCls =
  'rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
