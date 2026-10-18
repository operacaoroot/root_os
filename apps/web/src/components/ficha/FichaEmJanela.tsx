'use client';

import { useEffect, useState } from 'react';
import { EVENTO_DA_FICHA, fecharFicha, fichaNaUrl } from '@/lib/ficha';
import { FichaDoCliente } from './FichaDoCliente';

/** A ficha por cima da tela atual. Montada uma vez no AppShell; abre por `abrirFicha(id)`. */
export function FichaEmJanela() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const ler = () => setId(fichaNaUrl());
    ler();
    window.addEventListener(EVENTO_DA_FICHA, ler);
    window.addEventListener('popstate', ler);
    return () => {
      window.removeEventListener(EVENTO_DA_FICHA, ler);
      window.removeEventListener('popstate', ler);
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const esc = (e: KeyboardEvent) => {
      // Esc fecha a janela, mas não quando a transcrição (que tem o próprio fechar) está aberta.
      if (e.key === 'Escape' && !document.querySelector('[data-transcricao]')) fecharFicha();
    };
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = antes;
      window.removeEventListener('keydown', esc);
    };
  }, [id]);

  if (!id) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/45" onClick={fecharFicha}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ficha do cliente"
        className="h-full w-full max-w-[1100px] overflow-y-auto border-l border-border bg-bg p-5 shadow-2xl min-[820px]:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <FichaDoCliente key={id} taskId={id} rotulo="Ficha do cliente" emJanela />
      </div>
    </div>
  );
}
