'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TotemCatalogoProduto } from '@mktos/shared';

import { CartaoDoProduto } from './CartaoDoProduto';

/*
 * A grade monta os cartões aos poucos. Com perto de mil produtos, montar
 * todos de uma vez travaria o toque em "Todos" por um segundo inteiro no
 * aparelho do quiosque. Entra um lote e, quando a rolagem chega perto do fim,
 * o próximo; o botão do pé faz o mesmo para quem chega lá antes (e para o
 * leitor de tela).
 *
 * `chave` diz quando a lista é outra (nova busca, outra categoria): aí a grade
 * volta ao primeiro lote e ao topo. A sincronia que troca o catálogo com a
 * mesma chave não mexe na rolagem de quem está olhando.
 */

export const LOTE_DA_GRADE = 48;
const CARTOES_COM_PRIORIDADE = 6;

export function GradeDeProdutos({
  produtos,
  chave,
  aoAbrir,
  rolagem,
  larguraMinima = 260,
}: {
  produtos: readonly TotemCatalogoProduto[];
  chave: string;
  aoAbrir: (produto: TotemCatalogoProduto) => void;
  /** A caixa que rola a grade; sem ela o observador mede contra a janela. */
  rolagem?: RefObject<HTMLElement | null>;
  larguraMinima?: number;
}) {
  const [estado, setEstado] = useState({ chave, limite: LOTE_DA_GRADE });
  const limite = estado.chave === chave ? estado.limite : LOTE_DA_GRADE;
  const faltam = Math.max(0, produtos.length - limite);
  const pe = useRef<HTMLDivElement>(null);

  function crescer() {
    setEstado((atual) => ({
      chave,
      limite: (atual.chave === chave ? atual.limite : LOTE_DA_GRADE) + LOTE_DA_GRADE,
    }));
  }
  const crescerRef = useRef(crescer);
  crescerRef.current = crescer;

  useEffect(() => {
    const caixa = rolagem?.current;
    if (caixa) caixa.scrollTop = 0;
  }, [chave, rolagem]);

  useEffect(() => {
    const alvo = pe.current;
    if (!alvo || faltam === 0 || typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) crescerRef.current();
      },
      { root: rolagem?.current ?? null, rootMargin: '0px 0px 900px 0px' },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [chave, limite, faltam, rolagem]);

  return (
    <>
      <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${larguraMinima}px, 1fr))` }}>
        {produtos.slice(0, limite).map((p, i) => (
          <CartaoDoProduto key={p.id} produto={p} prioridade={i < CARTOES_COM_PRIORIDADE} aoAbrir={aoAbrir} />
        ))}
      </div>
      {faltam > 0 && (
        <div ref={pe} className="flex justify-center pt-6">
          <button
            type="button"
            onClick={crescer}
            className="flex min-h-16 items-center gap-3 rounded-full border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] px-8 text-[22px] font-semibold text-[color:var(--q-tinta)] active:bg-[color:var(--q-afundado)]"
          >
            <ChevronDown aria-hidden className="h-7 w-7" />
            {faltam === 1 ? 'Mostrar o último produto' : `Mostrar mais (faltam ${faltam})`}
          </button>
        </div>
      )}
    </>
  );
}
