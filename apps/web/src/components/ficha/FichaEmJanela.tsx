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
    // Centralizada, com margem dos quatro lados: a tela de baixo continua à vista.
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 min-[820px]:p-8" onClick={fecharFicha}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ficha do cliente"
        className="max-h-full w-full max-w-[1120px] overflow-y-auto rounded-lg border border-border bg-bg p-5 shadow-2xl min-[820px]:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <FichaDoCliente key={id} taskId={id} rotulo="Ficha do cliente" emJanela />
      </div>
    </div>
  );
}
