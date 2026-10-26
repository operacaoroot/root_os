'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * Layout 26/10 (P-29): A ESCOLHA QUE ABRE NA PRÓPRIA CÉLULA, como no ClickUp.
 *
 * Clicar na célula da Lista (responsável, agente) abre uma caixinha ali mesmo,
 * sem abrir a tarefa. Três cuidados:
 *   · a caixa vai para o `body` (portal) com posição fixa: a tabela rola de lado
 *     (`overflow-x-auto`) e cortaria uma caixa presa dentro dela; a linha também é
 *     arrastável, e campo de busca dentro de elemento arrastável perde a seleção;
 *   · no portal, o evento do React ainda sobe pela árvore até a linha (que abre a
 *     tarefa): quem usa põe a célula com `stopPropagation`, e a caixa também para;
 *   · fecha com Esc, com clique fora e quando a página rola (a caixa fixa ficaria
 *     solta longe da célula). Rolar a lista de dentro da caixa não fecha.
 */
export function EscolhaNaCelula({ rotulo, gatilho, children, largura = 240, testId, className = '' }: {
  /** O nome do botão e da caixa (leitor de tela). */
  rotulo: string;
  gatilho: React.ReactNode;
  /** O conteúdo recebe `fechar` para fechar depois de escolher. */
  children: (fechar: () => void) => React.ReactNode;
  largura?: number;
  testId?: string;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [lugar, setLugar] = useState<React.CSSProperties | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = () => { setAberta(false); botao.current?.focus(); };

  // Abaixo da célula; perto do fim da janela, acima dela. Nunca para fora dos lados.
  useLayoutEffect(() => {
    if (!aberta || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
    const abaixo = window.innerHeight - r.bottom;
    setLugar(abaixo < 280 && r.top > abaixo
      ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, width: largura }
      : { position: 'fixed', left, top: r.bottom + 4, width: largura });
  }, [aberta, largura]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberta(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    const rolou = (e: Event) => { if (!caixa.current?.contains(e.target as Node)) setAberta(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', rolou);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', rolou);
    };
  }, [aberta]);

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        title={rotulo}
        aria-haspopup="dialog"
        aria-expanded={aberta}
        data-testid={testId}
        onClick={(e) => { e.stopPropagation(); setAberta((a) => !a); }}
        className={`-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-surface-2 focus-visible:outline-brand ${aberta ? 'bg-surface-2' : ''} ${className}`}
      >
        {gatilho}
      </button>
      {aberta && typeof document !== 'undefined' && createPortal(
        <div
          ref={caixa}
          role="dialog"
          aria-label={rotulo}
          data-testid={testId ? `${testId}-caixa` : undefined}
          style={lugar ?? { position: 'fixed', visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 max-h-[320px] overflow-y-auto rounded-lg border border-border bg-surface p-1 text-sm shadow-xl"
        >
          {children(fechar)}
        </div>,
        document.body,
      )}
    </>
  );
}
