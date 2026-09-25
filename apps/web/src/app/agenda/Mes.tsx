'use client';

import { chaveDoDia, horaCurta, rotuloCurto, tomDoEvento, type EventoDaAgenda } from './tipos';

/*
 * A VISÃO DE MÊS — "onde cabe a próxima".
 *
 * Cada célula mostra no máximo dois compromissos e conta o resto (`+3`): a
 * célula tem altura fixa, e deixá-la crescer faria a semana cheia empurrar o
 * resto do mês para fora da tela. O dia inteiro está sempre a um clique, no
 * painel de baixo.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const CORES: Record<string, string> = {
  brand: 'bg-brand/15 text-brand',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  muted: 'bg-surface-2 text-muted',
};

export function Mes({
  dias,
  mesVisivel,
  porDia,
  diaAberto,
  aoEscolherDia,
}: {
  dias: Date[];
  /** O mês que dá o foco: os dias das outras páginas entram apagados. */
  mesVisivel: number;
  porDia: Map<string, EventoDaAgenda[]>;
  diaAberto: string;
  aoEscolherDia: (dia: string) => void;
}) {
  const hoje = chaveDoDia(new Date());
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border">
        {DIAS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((d) => {
          const chave = chaveDoDia(d);
          const doMes = d.getMonth() === mesVisivel;
          const lista = porDia.get(chave) ?? [];
          return (
            <button
              key={chave}
              onClick={() => aoEscolherDia(chave)}
              className={`min-h-[6.5rem] border-b border-r border-border p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-surface-2 ${doMes ? '' : 'opacity-40'} ${chave === diaAberto ? 'bg-surface-2' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs ${chave === hoje ? 'rounded bg-brand px-1.5 py-0.5 font-semibold text-bg' : 'text-muted'}`}>
                  {d.getDate()}
                </span>
                {lista.length > 2 && <span className="text-[10px] text-muted">+{lista.length - 2}</span>}
              </div>
              <div className="space-y-1">
                {lista.slice(0, 2).map((e) => (
                  <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[10px] ${CORES[tomDoEvento(e)]}`} title={e.title}>
                    {!e.diaInteiro && <span className="mr-1 opacity-70">{horaCurta(e.start)}</span>}
                    {rotuloCurto(e)}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
