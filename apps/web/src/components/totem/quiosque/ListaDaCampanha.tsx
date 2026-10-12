'use client';

import { useMemo, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { TotemCatalogoCampanha, TotemCatalogoProduto } from '@mktos/shared';

import { GradeDeProdutos } from './GradeDeProdutos';
import { Juta } from './Marca';
import { produtosDaCampanha } from './vitrine';

/** Os produtos de um banner de ação `produtos`, com a chamada do banner no título. */
export function ListaDaCampanha({
  campanha,
  produtos,
  aoAbrirProduto,
  aoVoltar,
}: {
  campanha: TotemCatalogoCampanha;
  produtos: readonly TotemCatalogoProduto[];
  aoAbrirProduto: (p: TotemCatalogoProduto) => void;
  aoVoltar: () => void;
}) {
  const lista = useMemo(() => produtosDaCampanha(campanha, produtos), [campanha, produtos]);
  const rolagem = useRef<HTMLElement>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lista-da-campanha-titulo"
      className="fixed inset-0 z-[25] flex flex-col bg-[color:var(--q-fundo)] text-[color:var(--q-sobre-fundo)]"
    >
      <header className="relative flex flex-wrap items-center gap-x-6 gap-y-3 overflow-hidden border-b-4 border-[#CB8139] bg-[color:var(--q-primaria)] px-6 py-5 text-[color:var(--q-sobre-primaria)]">
        <Juta />
        <button
          type="button"
          onClick={aoVoltar}
          className="relative flex min-h-16 shrink-0 items-center gap-3 rounded-[10px] bg-[#CB8139] px-6 text-[24px] font-semibold text-[#16200F] active:brightness-95"
        >
          <ArrowLeft aria-hidden className="h-8 w-8" />
          Voltar
        </button>
        <div className="relative min-w-0 flex-1">
          <p className="font-[family-name:var(--q-fonte-chamada)] text-[18px] font-medium uppercase tracking-[.14em] text-[color:var(--q-primaria-rotulo)]">
            {campanha.nome}
          </p>
          <h1
            id="lista-da-campanha-titulo"
            className="font-[family-name:var(--q-fonte-display)] text-[clamp(32px,4vw,52px)] font-semibold leading-[1.08]"
          >
            {campanha.chamada}
          </h1>
        </div>
      </header>
      <main ref={rolagem} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        {campanha.textoApoio?.trim() && (
          <p className="max-w-[1100px] pb-5 text-[24px] leading-snug text-[color:var(--q-sobre-fundo-suave)]">
            {campanha.textoApoio}
          </p>
        )}
        {lista.length === 0 ? (
          <p className="text-[24px]">Os produtos deste destaque não estão mais no catálogo da loja.</p>
        ) : (
          <GradeDeProdutos
            produtos={lista}
            chave={campanha.id}
            aoAbrir={aoAbrirProduto}
            rolagem={rolagem}
            larguraMinima={300}
          />
        )}
      </main>
    </div>
  );
}
