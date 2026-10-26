'use client';

import { useCallback, useEffect, useState } from 'react';
import { CHAVE_DA_DENSIDADE, DENSIDADES, DENSIDADE_PADRAO, lerDensidade, type Densidade } from '@/lib/quadro-denso';

/*
 * A DENSIDADE DOS CARDS, UMA SÓ PARA O OS (layout 26/10/2026).
 *
 * Todo quadro de cards (Trabalho, Implantação, Funil de vendas) usa este mesmo
 * seletor "compacto · médio · cheio" e a mesma preferência guardada neste
 * navegador: escolher num quadro vale para todos. O que cada densidade mostra:
 *   · compacto: o nome, a etapa, o responsável e selos curtos (o resto vira selo);
 *   · médio: + a próxima ação e os avisos numa linha;
 *   · cheio: tudo, com os avisos por extenso.
 */

const EVENTO = 'root-os:densidade';

/** A densidade escolhida (a mesma em todos os quadros) e como trocar. */
export function useDensidade(): [Densidade, (d: Densidade) => void] {
  const [densidade, setDensidade] = useState<Densidade>(DENSIDADE_PADRAO);
  useEffect(() => {
    const ler = () => {
      try { setDensidade(lerDensidade(window.localStorage.getItem(CHAVE_DA_DENSIDADE))); } catch { /* sem armazenamento: padrão */ }
    };
    ler();
    window.addEventListener(EVENTO, ler);
    window.addEventListener('storage', ler);
    return () => { window.removeEventListener(EVENTO, ler); window.removeEventListener('storage', ler); };
  }, []);
  const escolher = useCallback((d: Densidade) => {
    setDensidade(d);
    try { window.localStorage.setItem(CHAVE_DA_DENSIDADE, d); } catch { /* sem armazenamento: vale só nesta visita */ }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [densidade, escolher];
}

/** O seletor "compacto · médio · cheio", igual em todo quadro. */
export function SeletorDeDensidade({ densidade, aoEscolher, testId }: { densidade: Densidade; aoEscolher: (d: Densidade) => void; testId: string }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Densidade dos cards">
      {DENSIDADES.map((d) => (
        <button
          key={d.chave}
          type="button"
          data-testid={`${testId}-${d.chave}`}
          aria-pressed={densidade === d.chave}
          onClick={() => aoEscolher(d.chave)}
          className={`px-2.5 py-1.5 font-os-mono text-[11px] max-md:min-h-[44px] ${densidade === d.chave ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
        >
          {d.rotulo}
        </button>
      ))}
    </div>
  );
}
