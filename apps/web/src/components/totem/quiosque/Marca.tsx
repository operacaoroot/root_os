'use client';

import { useState, type CSSProperties } from 'react';

import { fundoDaMarca, inicialDoNome } from './vitrine';

export const TOTEM_LOGO_PADRAO = '/totem/selo-sr-agranel-150.jpg';

/*
 * As texturas e o substituto da foto, no desenho do design system do Senhor
 * aGranel: a juta dos posts (ruído fractal em soft-light) e a retícula de
 * pontos laranja no canto. A juta vai como ladrilho em data-URI, e não como
 * <svg> com filtro na tela inteira, para o navegador rasterizar uma vez só.
 */

const JUTA = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>" +
    "<filter id='j' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='.85 .3' numOctaves='2' seed='4' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 .96  0 0 0 0 .92  0 0 0 0 .78  0 0 0 1 0'/>" +
    "</filter><rect width='100%' height='100%' filter='url(#j)'/></svg>",
)}")`;

export function Juta({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 opacity-[.55] mix-blend-soft-light ${className}`}
      style={{ backgroundImage: JUTA, backgroundSize: '240px 240px' }}
    />
  );
}

export function Reticula({
  className = '',
  passo = 22,
  cor = '#CB8139',
}: {
  className?: string;
  passo?: number;
  cor?: string;
}) {
  const mascara = 'radial-gradient(circle at 70% 70%, #000 0 30%, transparent 70%)';
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${className}`}
      style={{
        background: `radial-gradient(circle, ${cor} 32%, transparent 36%) 0 0 / ${passo}px ${passo}px`,
        WebkitMaskImage: mascara,
        maskImage: mascara,
        opacity: 0.9,
      }}
    />
  );
}

/**
 * A foto do produto, ou a inicial do nome sobre um fundo da marca quando não
 * há foto ou ela não carrega (endereço quebrado, aparelho sem rede e sem a
 * cópia guardada). Ocupa sempre a caixa que recebe, para o layout não pular.
 */
export function ImagemOuInicial({
  src,
  nome,
  className = '',
  classeDaInicial = 'text-[64px]',
  prioridade = false,
}: {
  src: string | null | undefined;
  nome: string;
  className?: string;
  classeDaInicial?: string;
  prioridade?: boolean;
}) {
  const [quebrada, setQuebrada] = useState<string | null>(null);
  if (src && quebrada !== src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        loading={prioridade ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        className={`block object-cover ${className}`}
        onError={() => setQuebrada(src)}
      />
    );
  }
  const cores = fundoDaMarca(nome);
  return (
    <div
      aria-hidden
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ backgroundColor: cores.fundo, color: cores.tinta } as CSSProperties}
    >
      <Juta />
      <span className={`relative font-[family-name:var(--q-fonte-display)] font-semibold leading-none ${classeDaInicial}`}>
        {inicialDoNome(nome)}
      </span>
    </div>
  );
}

/** O logo da loja, ou o selo da marca se ele não carregar. O manual não deixa o selo passar de 75 px. */
export function Selo({ src, className = '' }: { src: string | null | undefined; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <img
      src={falhou || !src ? TOTEM_LOGO_PADRAO : src}
      alt=""
      width={75}
      height={75}
      draggable={false}
      className={`h-[75px] w-[75px] shrink-0 rounded-full object-contain ${className}`}
      onError={() => setFalhou(true)}
    />
  );
}
