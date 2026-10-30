'use client';

import { useEffect, useRef, useState } from 'react';

import { diaDaSemana, somarDias } from './semana';
import { proximoDiaUtil } from './v2';

/*
 * O BOTÃO "CALENDÁRIO ▾" (agenda v2, 29/10/2026, lane G3): meses, dias e "Hoje".
 * Escolher um sábado ou domingo abre o próximo dia útil (a grade é de dias
 * úteis; o fim de semana se vê na visão de 1 dia, pelas setas).
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const INICIAIS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** O primeiro dia (`AAAA-MM-01`) do mês de `dia`, somado de `n` meses. */
function mesDe(dia: string, n = 0): string {
  const [a, m] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}

/** As 42 casas do mês, começando no domingo. */
export function casasDoMes(primeiro: string): string[] {
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
  return Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
}

interface Props {
  rotulo: string;
  diaAberto: string;
  hoje: string;
  aoEscolher: (dia: string) => void;
}

export function Calendario({ rotulo, diaAberto, hoje, aoEscolher }: Props) {
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(() => mesDe(diaAberto));
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => { if (aberto) setMes(mesDe(diaAberto)); }, [aberto, diaAberto]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: MouseEvent) => { if (caixa.current && !caixa.current.contains(ev.target as Node)) setAberto(false); };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  const escolher = (dia: string) => {
    aoEscolher(proximoDiaUtil(dia));
    setAberto(false);
  };
  const [a, m] = mes.split('-').map(Number);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        aria-expanded={aberto}
        aria-haspopup="dialog"
        onClick={() => setAberto((v) => !v)}
        className="rounded-[3px] border border-border bg-surface-2 px-3 py-1.5 font-os-mono text-xs text-text hover:border-brand-dim"
        data-titulo-da-agenda=""
      >
        Calendário ▾ · {rotulo}
      </button>
      {aberto && (
        <div role="dialog" aria-label="Escolher o dia" className="absolute left-0 top-full z-30 mt-1 w-64 rounded-[3px] border border-border-strong bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Mês anterior" onClick={() => setMes(mesDe(mes, -1))} className="px-2 text-muted hover:text-text">‹</button>
            <span className="text-sm font-medium capitalize">{MESES[m - 1]} {a}</span>
            <button type="button" aria-label="Próximo mês" onClick={() => setMes(mesDe(mes, 1))} className="px-2 text-muted hover:text-text">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {INICIAIS.map((d, i) => (
              <span key={i} className="font-os-mono text-[10px] text-muted">{d}</span>
            ))}
            {casasDoMes(mes).map((d) => {
              const doMes = d.slice(0, 7) === mes.slice(0, 7);
              const fds = diaDaSemana(d) === 0 || diaDaSemana(d) === 6;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => escolher(d)}
                  aria-label={d}
                  className={`rounded-[3px] py-1 font-os-mono text-xs ${d === diaAberto ? 'bg-brand/15 text-text' : ''} ${d === hoje ? 'ring-1 ring-brand' : ''} ${doMes ? (fds ? 'text-muted' : 'text-text') : 'text-dim opacity-50'} hover:bg-surface-2`}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => escolher(hoje)} className="mt-2 w-full rounded-[3px] border border-border bg-surface-2 py-1 text-xs hover:border-brand-dim">
            Hoje
          </button>
        </div>
      )}
    </div>
  );
}
