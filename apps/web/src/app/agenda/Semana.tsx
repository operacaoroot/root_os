'use client';

import { faixaDeHoras, posicaoNaFaixa } from './grade';
import { chaveDoDia, horaCurta, rotuloCurto, tomDoEvento, type EventoDaAgenda } from './tipos';

/*
 * A VISÃO DE SEMANA — "a que horas, lado a lado".
 *
 * Sete colunas sobre uma régua de horas. A altura de cada bloco é a duração
 * real, o que responde de olho a pergunta que o mês não responde: dá para
 * marcar às 14h? O que está às 14h termina quando?
 *
 * A RÉGUA NÃO É FIXA. Ela começa no expediente e abre para caber o que existe
 * (`faixaDeHoras`): reunião às 7h aparece, jantar às 21h também. Fixar 8h–18h
 * esconderia justamente o compromisso fora do comum, que é o que mais importa
 * lembrar.
 *
 * O DIA INTEIRO fica numa faixa acima da grade. Ele não tem hora, e empurrá-lo
 * para dentro da régua obrigaria a inventar uma.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ALTURA_POR_HORA = 44; // px

const CORES: Record<string, string> = {
  brand: 'border-brand/40 bg-brand/15 text-brand',
  good: 'border-good/40 bg-good/15 text-good',
  warn: 'border-warn/40 bg-warn/15 text-warn',
  muted: 'border-border bg-surface-2 text-muted',
};

export function Semana({
  dias,
  eventos,
  porDia,
  diaAberto,
  aoEscolherDia,
}: {
  dias: Date[];
  /** Os eventos já filtrados da semana — é deles que sai a régua de horas. */
  eventos: EventoDaAgenda[];
  porDia: Map<string, EventoDaAgenda[]>;
  diaAberto: string;
  aoEscolherDia: (dia: string) => void;
}) {
  const faixa = faixaDeHoras(eventos);
  const horas = Array.from({ length: faixa.ultima - faixa.primeira }, (_, i) => faixa.primeira + i);
  const altura = horas.length * ALTURA_POR_HORA;
  const hoje = chaveDoDia(new Date());
  const temDiaInteiro = eventos.some((e) => e.diaInteiro);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* cabeçalho dos dias */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: '3.25rem repeat(7, minmax(0, 1fr))' }}>
        <div />
        {dias.map((d) => {
          const chave = chaveDoDia(d);
          return (
            <button
              key={chave}
              onClick={() => aoEscolherDia(chave)}
              className={`border-l border-border px-2 py-1.5 text-center transition-colors hover:bg-surface-2 ${chave === diaAberto ? 'bg-surface-2' : ''}`}
            >
              <div className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{DIAS[d.getDay()]}</div>
              <div className={`mt-0.5 inline-block text-sm ${chave === hoje ? 'rounded bg-brand px-1.5 font-semibold text-bg' : ''}`}>
                {d.getDate()}
              </div>
            </button>
          );
        })}
      </div>

      {/* a faixa de dia inteiro, só quando há algum */}
      {temDiaInteiro && (
        <div className="grid border-b border-border" style={{ gridTemplateColumns: '3.25rem repeat(7, minmax(0, 1fr))' }}>
          <div className="px-1 py-1 text-right font-os-mono text-[9px] uppercase tracking-wide text-muted">dia</div>
          {dias.map((d) => {
            const chave = chaveDoDia(d);
            const lista = (porDia.get(chave) ?? []).filter((e) => e.diaInteiro);
            return (
              <div key={chave} className="min-h-[1.75rem] space-y-0.5 border-l border-border p-1">
                {lista.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => aoEscolherDia(chave)}
                    className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] ${CORES[tomDoEvento(e)]}`}
                    title={e.title}
                  >
                    {rotuloCurto(e)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* a régua e as sete colunas */}
      <div className="grid" style={{ gridTemplateColumns: '3.25rem repeat(7, minmax(0, 1fr))' }}>
        <div className="relative" style={{ height: altura }}>
          {horas.map((h, i) => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 font-os-mono text-[10px] text-muted"
              style={{ top: i * ALTURA_POR_HORA }}
            >
              {String(h).padStart(2, '0')}h
            </div>
          ))}
        </div>

        {dias.map((d) => {
          const chave = chaveDoDia(d);
          const lista = (porDia.get(chave) ?? []).filter((e) => !e.diaInteiro);
          return (
            <div
              key={chave}
              onClick={() => aoEscolherDia(chave)}
              className={`relative border-l border-border ${chave === diaAberto ? 'bg-surface-2/40' : ''}`}
              style={{ height: altura }}
            >
              {/* as linhas da hora, por trás dos eventos */}
              {horas.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-border/50" style={{ top: i * ALTURA_POR_HORA }} />
              ))}

              {lista.map((e) => {
                const pos = posicaoNaFaixa(e, faixa);
                if (!pos) return null;
                return (
                  <button
                    key={e.id}
                    onClick={(ev) => { ev.stopPropagation(); aoEscolherDia(chave); }}
                    title={`${horaCurta(e.start)}–${horaCurta(e.end)} · ${e.title}`}
                    className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight ${CORES[tomDoEvento(e)]}`}
                    style={{ top: `${pos.topo}%`, height: `${pos.altura}%` }}
                  >
                    <span className="block truncate font-medium">{rotuloCurto(e)}</span>
                    <span className="block truncate opacity-70">{horaCurta(e.start)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
