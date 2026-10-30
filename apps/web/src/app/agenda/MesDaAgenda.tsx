'use client';

import { casasDoMes } from './Calendario';
import { horaNoFuso } from './semana';
import { CLASSE_DO_TOM, aparenciaDo, diaDoEventoV2, diasDoDiaInteiro, type EventoV2, type FaixaDoTopo } from './v2';

/*
 * O MÊS DA AGENDA V2 (29/10/2026, lane G3): o mês de sempre (6 × 7, começando
 * no domingo), com o tipo novo colorido e a palavra junto (cliente, interna,
 * Fechado, Fora, feriado, choque). Clicar num dia o abre no cartão de baixo.
 */

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const VISIVEIS = 3;

interface Props {
  /** Qualquer dia do mês mostrado. */
  dia: string;
  hoje: string;
  eventos: EventoV2[];
  choques: ReadonlySet<string>;
  faixas: FaixaDoTopo[];
  prazosPorDia?: Map<string, number>;
  aoEscolher: (dia: string) => void;
}

/** As 42 casas do mês de `dia`. */
export const casasDoMesDe = (dia: string): string[] => casasDoMes(`${dia.slice(0, 7)}-01`);

export function MesDaAgenda({ dia, hoje, eventos, choques, faixas, prazosPorDia, aoEscolher }: Props) {
  const casas = casasDoMesDe(dia);
  const porDia = new Map<string, EventoV2[]>();
  for (const e of eventos) {
    if (e.status === 'cancelado') continue;
    const dias = e.diaInteiro ? diasDoDiaInteiro(e) : [diaDoEventoV2(e) ?? ''];
    for (const d of dias) porDia.set(d, [...(porDia.get(d) ?? []), e]);
  }
  for (const lista of porDia.values()) lista.sort((a, b) => Number(b.diaInteiro) - Number(a.diaInteiro) || a.inicio.localeCompare(b.inicio));

  return (
    <div className="overflow-hidden rounded-[3px] border border-border bg-surface" data-visao-da-agenda="mes">
      <div className="grid grid-cols-7 border-b border-border">
        {SEMANA.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {casas.map((c) => {
          const doMes = c.slice(0, 7) === dia.slice(0, 7);
          const lista = porDia.get(c) ?? [];
          const feriado = faixas.find((f) => f.tipo === 'feriado' && f.dia === c);
          const prazos = prazosPorDia?.get(c) ?? 0;
          return (
            <button
              key={c}
              type="button"
              onClick={() => aoEscolher(c)}
              data-dia-do-mes={c}
              className={`min-h-[6.5rem] border-b border-r border-border p-1.5 text-left align-top transition-colors hover:bg-surface-2 [&:nth-child(7n)]:border-r-0 ${doMes ? '' : 'opacity-40'} ${c === dia ? 'bg-surface-2' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className={`font-os-mono text-xs ${c === hoje ? 'rounded-[3px] bg-brand px-1.5 py-0.5 font-semibold text-ink' : 'text-muted'}`}>{Number(c.slice(8))}</span>
                {feriado && <span className="truncate font-os-mono text-[9px] uppercase text-muted">feriado</span>}
              </div>
              <div className="space-y-0.5">
                {lista.slice(0, VISIVEIS).map((e) => {
                  const ap = aparenciaDo(e);
                  const choque = choques.has(e.id);
                  return (
                    <div key={e.id} title={ap.titulo} className={`truncate rounded-[3px] px-1 py-0.5 text-[10px] ${CLASSE_DO_TOM[choque ? 'choque' : ap.tom]}`}>
                      {!e.diaInteiro && <span className="mr-1 font-os-mono text-muted">{horaNoFuso(e.inicio)}</span>}
                      {choque ? <span className="mr-1 font-os-mono uppercase text-mag">choque</span> : null}
                      {ap.titulo}
                    </div>
                  );
                })}
                {lista.length > VISIVEIS && <div className="font-os-mono text-[10px] text-muted">+{lista.length - VISIVEIS}</div>}
                {prazos > 0 && <div className="truncate font-os-mono text-[10px] text-brand">{prazos} prazo{prazos === 1 ? '' : 's'} de trabalho</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
