'use client';

/*
 * As colunas do resumo de tarefas, no molde do ClickUp (número em cima, nome
 * embaixo) e na paleta da casa: um acento só (o lima, cheio, médio ou fraco) e
 * vermelho apenas para problema (atrasada). Clicar vira filtro da lista.
 */

export interface Fatia {
  chave: string;
  rotulo: string;
  valor: number;
  cor: string;
  dica?: string;
  onClick?: () => void;
}

/** Colunas com o número em cima, o nome embaixo, dica no hover e clique. */
export function Barras({ itens, altura = 176, chamada = 'clique para ver as tarefas' }: { itens: Fatia[]; altura?: number; chamada?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div>
      <div className="flex items-end gap-3 border-b border-border" style={{ height: altura }}>
        {itens.map((i) => (
          <button
            key={i.chave}
            onClick={i.onClick}
            disabled={!i.onClick || i.valor === 0}
            aria-label={`${i.rotulo}: ${i.valor}`}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-t-sm hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-3 px-3 py-1.5 text-left text-xs shadow-lg group-hover:block group-focus-visible:block">
              <span className="block font-semibold text-text">{i.rotulo}: {i.valor}</span>
              {i.dica && <span className="block text-muted">{i.dica}</span>}
              {i.onClick && i.valor > 0 && <span className="mt-0.5 block text-brand">{chamada}</span>}
            </span>
            <span className="com-num text-[0.8rem] font-bold">{i.valor}</span>
            <span
              className="w-full max-w-[64px] rounded-t-[4px]"
              style={{ height: `${(i.valor / max) * (altura - 28)}px`, minHeight: i.valor ? 3 : 0, background: i.cor }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3">
        {itens.map((i) => (
          <span key={i.chave} className="min-w-0 flex-1 truncate text-center text-xs text-muted" title={i.rotulo}>{i.rotulo}</span>
        ))}
      </div>
    </div>
  );
}
