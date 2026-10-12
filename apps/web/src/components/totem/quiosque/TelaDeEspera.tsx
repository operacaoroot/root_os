'use client';

import { Hand } from 'lucide-react';
import type { TotemCatalogo } from '@mktos/shared';

import { Banners } from './Banners';
import { Selo } from './Marca';

/*
 * O descanso de tela. Depois do tempo de inatividade, o totem vira vitrine de
 * novo: os banners da loja em tela cheia, girando sozinhos, e a faixa
 * "toque para consultar". Um toque em qualquer lugar volta para o início.
 * Sem banner cadastrado, fica o selo com as boas-vindas.
 */

export function TelaDeEspera({
  catalogo,
  online,
  boasVindas,
  aoSair,
}: {
  catalogo: TotemCatalogo;
  online: boolean;
  boasVindas: string;
  aoSair: () => void;
}) {
  const config = catalogo.config;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Toque para consultar"
      onClick={aoSair}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') aoSair();
      }}
      className="fixed inset-0 z-[38] flex cursor-pointer flex-col bg-[color:var(--q-primaria)] outline-none"
    >
      <Banners
        campanhas={catalogo.campanhas ?? []}
        modo="espera"
        online={online}
        cadastroLigado={config.cadastroLigado}
        logoUrl={config.logoUrl}
        nomeExibicao={config.nomeExibicao}
        boasVindas={boasVindas}
        className="min-h-0 flex-1"
      />
      <div className="relative flex items-center gap-6 border-t-4 border-[#CB8139] bg-[#16200F] px-[clamp(24px,4vw,64px)] py-[clamp(20px,2.6vh,36px)] text-[#F5F3EC]">
        <Selo src={config.logoUrl} />
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--q-fonte-chamada)] text-[clamp(36px,4.6vw,72px)] font-bold uppercase leading-[.9] tracking-[.02em]">
            Toque para consultar
          </p>
          <p className="mt-2 text-[clamp(18px,1.8vw,26px)] text-[#C9CBB5]">
            Ingredientes, tabela nutricional, lote e validade de cada produto.
          </p>
        </div>
        <span
          aria-hidden
          className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-full bg-[#CB8139] text-[#16200F] motion-safe:animate-pulse"
        >
          <Hand className="h-12 w-12" strokeWidth={2.2} />
        </span>
      </div>
    </div>
  );
}
