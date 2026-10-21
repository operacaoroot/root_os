'use client';

import { useEffect, useState } from 'react';

import { PRIMEIRA_HORA, ULTIMA_HORA, eventosPorDia, horaNoFuso, rotulosDoDia } from './semana';
import { rotuloCurto, tomDoEvento, type EventoDaAgenda } from './tipos';

/*
 * A SEMANA (e o dia) DA AGENDA (Rodada de produção 1, 21/10/2026, P2).
 *
 * No computador, a grade de horas das 07h às 22h, com rolagem vertical própria
 * (a página não rola de lado), e os eventos de dia inteiro numa faixa no topo.
 * No celular (< 640 px) a semana vira uma LISTA por dia, sem rolagem lateral.
 * Clicar num evento ou num dia abre o dia por extenso, no cartão de baixo, que
 * é o mesmo da visão do mês. Todo horário é de America/Sao_Paulo.
 */

const ALTURA_DA_HORA = 48;
const HORAS = Array.from({ length: ULTIMA_HORA - PRIMEIRA_HORA }, (_, i) => PRIMEIRA_HORA + i);

const COR: Record<ReturnType<typeof tomDoEvento>, string> = {
  brand: 'bg-brand/15 text-brand border-brand/30',
  good: 'bg-good/15 text-good border-good/30',
  warn: 'bg-warn/15 text-warn border-warn/30',
  muted: 'bg-surface-2 text-muted border-border',
};

/** Celular é abaixo de 640 px (o `sm` do Tailwind). Sem `matchMedia`, computador. */
export function useEhCelular(): boolean {
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const ler = () => setCelular(mq.matches);
    ler();
    mq.addEventListener?.('change', ler);
    return () => mq.removeEventListener?.('change', ler);
  }, []);
  return celular;
}

interface Props {
  dias: string[];
  eventos: EventoDaAgenda[];
  prazosPorDia: Map<string, number>;
  mostrarPrazos: boolean;
  hoje: string;
  diaAberto: string;
  aoEscolher: (dia: string) => void;
  /** No celular a semana vira lista; o dia continua na grade (uma coluna cabe). */
  comoLista: boolean;
}

function Prazos({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="block truncate rounded bg-brand/10 px-1 py-0.5 text-[10px] text-brand">
      {n} prazo{n === 1 ? '' : 's'} de trabalho
    </span>
  );
}

export function GradeDaSemana({ dias, eventos, prazosPorDia, mostrarPrazos, hoje, diaAberto, aoEscolher, comoLista }: Props) {
  const porDia = eventosPorDia(eventos, dias);

  if (comoLista) {
    return (
      <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-visao-da-agenda="lista" aria-label="Semana em lista">
        {porDia.map(({ dia, diaInteiro, comHora }) => {
          const r = rotulosDoDia(dia);
          const vazio = !diaInteiro.length && !comHora.length;
          return (
            <li key={dia} className={dia === diaAberto ? 'bg-surface-2' : ''}>
              <button type="button" onClick={() => aoEscolher(dia)} className="flex w-full min-w-0 flex-col gap-1.5 px-3 py-2.5 text-left">
                <span className="flex items-baseline gap-2">
                  <span className={`text-sm font-medium capitalize ${dia === hoje ? 'text-brand' : 'text-text'}`}>{r.semana}</span>
                  <span className="font-os-mono text-xs text-muted">{r.data}</span>
                  {dia === hoje && <span className="text-[10px] uppercase tracking-wide text-brand">hoje</span>}
                </span>
                {vazio && <span className="text-xs text-muted">Nada marcado.</span>}
                {diaInteiro.map((e) => (
                  <span key={`d-${e.id}`} className={`block min-w-0 truncate rounded border px-1.5 py-0.5 text-xs ${COR[tomDoEvento(e)]}`} title={e.title}>
                    dia inteiro · {rotuloCurto(e)}
                  </span>
                ))}
                {comHora.map(({ evento: e }) => (
                  <span key={e.id} className={`flex min-w-0 items-baseline gap-2 rounded border px-1.5 py-0.5 text-xs ${COR[tomDoEvento(e)]}`} title={e.title}>
                    <span className="shrink-0 font-os-mono opacity-80">
                      {horaNoFuso(e.start)}
                      {e.end ? `–${horaNoFuso(e.end)}` : ''}
                    </span>
                    <span className="min-w-0 truncate">{rotuloCurto(e)}</span>
                  </span>
                ))}
                {mostrarPrazos && <Prazos n={prazosPorDia.get(dia) ?? 0} />}
              </button>
            </li>
          );
        })}
      </ol>
    );
  }

  const colunas = { gridTemplateColumns: `3rem repeat(${dias.length}, minmax(0, 1fr))` };
  const algumDiaInteiro = porDia.some((d) => d.diaInteiro.length) || (mostrarPrazos && dias.some((d) => prazosPorDia.get(d)));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" data-visao-da-agenda="grade">
      <div className="grid border-b border-border" style={colunas}>
        <div />
        {dias.map((dia) => {
          const r = rotulosDoDia(dia);
          return (
            <button
              key={dia}
              type="button"
              onClick={() => aoEscolher(dia)}
              aria-label={r.extenso}
              className={`min-w-0 px-1 py-1.5 text-center ${dia === diaAberto ? 'bg-surface-2' : ''}`}
            >
              <span className="block font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{r.semana}</span>
              <span className={`text-xs ${dia === hoje ? 'rounded bg-brand px-1.5 py-0.5 font-semibold text-bg' : 'text-text'}`}>{r.data}</span>
            </button>
          );
        })}
      </div>

      {algumDiaInteiro && (
        <div className="grid border-b border-border" style={colunas} data-faixa-dia-inteiro="">
          <div className="px-1 py-1 text-right text-[10px] leading-tight text-muted">dia inteiro</div>
          {porDia.map(({ dia, diaInteiro }) => (
            <div key={dia} className="min-w-0 space-y-0.5 border-l border-border p-0.5">
              {diaInteiro.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => aoEscolher(dia)}
                  title={e.title}
                  className={`block w-full min-w-0 truncate rounded border px-1 py-0.5 text-left text-[10px] ${COR[tomDoEvento(e)]}`}
                >
                  {rotuloCurto(e)}
                </button>
              ))}
              {mostrarPrazos && <Prazos n={prazosPorDia.get(dia) ?? 0} />}
            </div>
          ))}
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden" data-rolagem-da-grade="">
        <div className="relative grid" style={{ ...colunas, height: HORAS.length * ALTURA_DA_HORA }}>
          <div className="relative">
            {HORAS.map((h, i) => (
              <span key={h} className="absolute right-1 -translate-y-1/2 font-os-mono text-[10px] text-muted" style={{ top: i * ALTURA_DA_HORA }}>
                {i === 0 ? '' : `${String(h).padStart(2, '0')}h`}
              </span>
            ))}
          </div>
          {porDia.map(({ dia, comHora }) => (
            <div key={dia} className="relative min-w-0 border-l border-border" data-coluna-do-dia={dia}>
              {HORAS.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * ALTURA_DA_HORA }} />
              ))}
              {comHora.map(({ evento: e, inicio, fim, faixa, faixas }) => {
                const topo = ((inicio - PRIMEIRA_HORA * 60) / 60) * ALTURA_DA_HORA;
                const altura = Math.max(18, ((fim - inicio) / 60) * ALTURA_DA_HORA - 2);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => aoEscolher(dia)}
                    title={`${horaNoFuso(e.start)}${e.end ? `–${horaNoFuso(e.end)}` : ''} · ${e.title}`}
                    data-evento={e.id}
                    className={`absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight ${COR[tomDoEvento(e)]}`}
                    style={{ top: topo, height: altura, left: `calc(${(faixa / faixas) * 100}% + 1px)`, width: `calc(${100 / faixas}% - 2px)` }}
                  >
                    <span className="block font-os-mono opacity-80">{horaNoFuso(e.start)}</span>
                    <span className="block truncate">{rotuloCurto(e)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
