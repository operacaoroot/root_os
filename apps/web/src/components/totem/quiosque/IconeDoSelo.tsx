'use client';

import { useId } from 'react';
import { TOTEM_ROTULO_DO_SELO, type TotemSelo } from '@mktos/shared';

/*
 * Os ícones dos selos, desenhados para o quiosque: grade de 24, traço de 2 px
 * em `currentColor`, pontas redondas. Os selos de "sem" levam o risco na
 * diagonal com um vão no desenho por baixo, para o risco não sumir no traço.
 */

const RISCO = 'M3 3l18 18';

const DESENHOS: Record<TotemSelo, { riscado: boolean; formas: React.ReactNode }> = {
  vegano: {
    riscado: false,
    formas: (
      <>
        <path d="M4 20c0-9 6-16 16-16 0 10-7 16-16 16z" />
        <path d="M4 20l10-10" />
      </>
    ),
  },
  vegetariano: {
    riscado: false,
    formas: (
      <>
        <path d="M4 20h16" />
        <path d="M12 20v-8" />
        <path d="M12 13c-4 0-6-2-6-6 4 0 6 2 6 6z" />
        <path d="M12 11c0-4 2-6 6-6 0 4-2 6-6 6z" />
      </>
    ),
  },
  sem_gluten: {
    riscado: true,
    formas: (
      <>
        <path d="M12 21V8" />
        <path d="M12 8c-1.6-1.2-1.6-3.8 0-5 1.6 1.2 1.6 3.8 0 5z" />
        <path d="M12 12c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4z" />
        <path d="M12 12c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4z" />
        <path d="M12 16c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4z" />
        <path d="M12 16c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4z" />
      </>
    ),
  },
  sem_lactose: {
    riscado: true,
    formas: (
      <>
        <path d="M9 3h6" />
        <path d="M10 3v3l-3 4v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10l-3-4V3" />
        <path d="M7 13h10" />
      </>
    ),
  },
  organico: {
    riscado: false,
    formas: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 16c0-5 3-8 8-8 0 5-3 8-8 8z" />
        <path d="M8 16l4-4" />
      </>
    ),
  },
  integral: {
    riscado: false,
    formas: (
      <g transform="rotate(35 12 12)">
        <ellipse cx="12" cy="12" rx="5.5" ry="8.5" />
        <path d="M12 4.5c-2 3-2 12 0 15" />
      </g>
    ),
  },
  sem_acucar: {
    riscado: true,
    formas: (
      <>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M4 7.5l8 4.5 8-4.5" />
        <path d="M12 12v9" />
      </>
    ),
  },
  sem_conservantes: {
    riscado: true,
    formas: (
      <>
        <path d="M9 3h6" />
        <path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
        <path d="M7.5 15h9" />
      </>
    ),
  },
  nao_transgenico: {
    riscado: true,
    formas: (
      <>
        <path d="M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9" />
        <path d="M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9" />
        <path d="M9.5 5.5h5M9.5 10.5h5M9.5 13.5h5M9.5 18.5h5" />
      </>
    ),
  },
};

export function IconeDoSelo({
  selo,
  className = 'h-6 w-6',
  comTitulo = false,
}: {
  selo: TotemSelo;
  className?: string;
  /** Ícone sozinho, sem o rótulo escrito do lado, precisa do nome para o leitor de tela. */
  comTitulo?: boolean;
}) {
  const id = `selo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const desenho = DESENHOS[selo];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={comTitulo ? 'img' : undefined}
      aria-hidden={comTitulo ? undefined : true}
      aria-label={comTitulo ? TOTEM_ROTULO_DO_SELO[selo] : undefined}
      focusable="false"
    >
      {desenho.riscado ? (
        <>
          <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="#fff" />
            <path d={RISCO} stroke="#000" strokeWidth={6} />
          </mask>
          <g mask={`url(#${id})`}>{desenho.formas}</g>
          <path d={RISCO} />
        </>
      ) : (
        desenho.formas
      )}
    </svg>
  );
}
