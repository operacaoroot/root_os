'use client';

import { memo, useState } from 'react';
import type { TotemCatalogoProduto } from '@mktos/shared';

import { IconeDoSelo } from './IconeDoSelo';
import { Juta, Reticula } from './Marca';
import { fundoDaMarca, inicialDoNome } from './vitrine';

const MAXIMO_DE_SELOS_NO_CARTAO = 4;

/*
 * Quase todo o catálogo vem sem foto. Uma inicial grande por cartão viraria
 * uma parede de letras repetidas (em ordem alfabética, a tela inteira seria
 * "C"), então o cartão sem foto vira uma etiqueta da loja: a categoria em
 * cima e o nome em Fraunces sobre a cor da marca, com a inicial só de marca
 * d'água. Foto que não carrega cai no mesmo desenho.
 *
 * O cartão é memorizado e recebe `aoAbrir` estável: com a grade cheia, digitar
 * uma letra não redesenha os cartões que continuam na tela.
 */
export const CartaoDoProduto = memo(function CartaoDoProduto({
  produto,
  aoAbrir,
  prioridade = false,
}: {
  produto: TotemCatalogoProduto;
  aoAbrir: (produto: TotemCatalogoProduto) => void;
  prioridade?: boolean;
}) {
  const [quebrada, setQuebrada] = useState<string | null>(null);
  const foto = produto.imagemUrl && quebrada !== produto.imagemUrl ? produto.imagemUrl : null;
  const selos = produto.selos.slice(0, MAXIMO_DE_SELOS_NO_CARTAO);
  const sobra = produto.selos.length - selos.length;
  return (
    <button
      type="button"
      onClick={() => aoAbrir(produto)}
      className="group flex flex-col overflow-hidden rounded-[18px] bg-[color:var(--q-cartao)] text-left text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)] [contain-intrinsic-size:auto_380px] [content-visibility:auto] active:translate-y-px active:bg-[color:var(--q-afundado)]"
    >
      {foto ? (
        <>
          <img
            src={foto}
            alt=""
            draggable={false}
            decoding="async"
            loading={prioridade ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            className="block aspect-[4/3] w-full bg-[color:var(--q-afundado)] object-cover"
            onError={() => setQuebrada(foto)}
          />
          <span className="line-clamp-2 px-5 pt-3 text-[26px] font-semibold leading-[1.15]">{produto.nome}</span>
        </>
      ) : (
        <Etiqueta nome={produto.nome} categoria={produto.categoria} />
      )}
      <span className="mt-auto flex min-h-[64px] items-center justify-between gap-3 px-5 py-3">
        <span className="font-[family-name:var(--q-fonte-chamada)] text-[18px] font-medium uppercase tracking-[.08em] text-[color:var(--q-tinta-suave)]">
          Cód. {produto.codigo}
        </span>
        {selos.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-[color:var(--q-destaque-tinta)]">
            {selos.map((s) => (
              <IconeDoSelo key={s} selo={s} comTitulo className="h-7 w-7" />
            ))}
            {sobra > 0 && <span className="text-[16px] font-semibold">+{sobra}</span>}
          </span>
        )}
      </span>
    </button>
  );
});

function tamanhoDoNome(nome: string): string {
  if (nome.length > 44) return 'text-[24px]';
  if (nome.length > 26) return 'text-[28px]';
  return 'text-[32px]';
}

function Etiqueta({ nome, categoria }: { nome: string; categoria: string | null }) {
  const cores = fundoDaMarca(nome);
  return (
    <span
      className="relative flex aspect-[4/3] w-full grow flex-col overflow-hidden px-5 pb-4 pt-4"
      style={{ backgroundColor: cores.fundo, color: cores.texto }}
    >
      <Juta />
      <Reticula className="-right-4 -top-4 h-28 w-28" passo={16} cor={cores.tinta} />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-10 right-2 select-none font-[family-name:var(--q-fonte-display)] text-[190px] font-semibold leading-none opacity-[.14]"
        style={{ color: cores.tinta }}
      >
        {inicialDoNome(nome)}
      </span>
      {categoria?.trim() && (
        <span
          className="relative line-clamp-1 pr-16 font-[family-name:var(--q-fonte-chamada)] text-[17px] font-medium uppercase tracking-[.14em]"
          style={{ color: cores.tinta }}
        >
          {categoria}
        </span>
      )}
      <span
        className={`relative mt-auto line-clamp-3 font-[family-name:var(--q-fonte-display)] font-semibold leading-[1.08] ${tamanhoDoNome(nome)}`}
      >
        {nome}
      </span>
    </span>
  );
}
