'use client';

import type { EventoV2 } from './v2';
import { CLASSE_DO_TOM, aparenciaDo, corDaEtiqueta, diaDoEventoV2, diasDoDiaInteiro, minutosDoEvento } from './v2';
import { horaNoFuso, noFuso, rotulosDoDia } from './semana';

/*
 * A LISTA DO DIA (agenda v2, 29/10/2026, lane G3) — desenho `Celular`.
 *
 * O padrão abaixo de 860 px: o dia em linhas (hora em mono, título, uma linha
 * de apoio), a linha do AGORA entre o que passou e o que vem, e "entrar no
 * Meet" quando falta pouco (até 60 min) ou está acontecendo. Embaixo, "+ Marcar"
 * e "Conflitos N".
 */

/** Quanto antes do início o botão do Meet aparece. */
export const MEET_ANTES_MIN = 60;

interface Props {
  dia: string;
  hoje: string;
  agora: Date;
  /** Os eventos já filtrados por "Quem" (de qualquer dia: a lista escolhe os do dia). */
  eventos: EventoV2[];
  choques: ReadonlySet<string>;
  trajetoDe?: (e: EventoV2) => number;
  /** Quantos compromissos há amanhã (a linha do fim), quando se sabe. */
  amanha?: number | null;
  conflitos?: number | null;
  podeMarcar: boolean;
  aoClicar: (e: EventoV2) => void;
  aoMarcar: () => void;
  aoConflitos: () => void;
}

/** "em 40 min", "acontecendo agora", ou nulo quando o Meet ainda não interessa. */
export function momentoDoMeet(e: EventoV2, agora: Date): string | null {
  if (!e.meet || e.diaInteiro || e.status === 'cancelado') return null;
  const ini = new Date(e.inicio).getTime();
  const fim = new Date(e.fim).getTime();
  const t = agora.getTime();
  if (t >= ini && t < fim) return 'acontecendo agora';
  const falta = Math.round((ini - t) / 60_000);
  if (falta > 0 && falta <= MEET_ANTES_MIN) return `em ${falta} min`;
  return null;
}

export function ListaDoDia({ dia, hoje, agora, eventos, choques, trajetoDe, amanha, conflitos, podeMarcar, aoClicar, aoMarcar, aoConflitos }: Props) {
  const r = rotulosDoDia(dia);
  const doDia = eventos.filter((e) => e.status !== 'cancelado' && (e.diaInteiro ? diasDoDiaInteiro(e).includes(dia) : diaDoEventoV2(e) === dia));
  const diaInteiro = doDia.filter((e) => e.diaInteiro);
  const comHora = doDia.filter((e) => !e.diaInteiro).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const ehHoje = dia === hoje;
  const agoraNoFuso = noFuso(agora);
  const indiceDoAgora = ehHoje ? comHora.findIndex((e) => new Date(e.inicio).getTime() > agora.getTime()) : -1;
  const linhaDoAgora = (
    <li key="agora" className="flex items-center gap-2 py-1" data-linha-do-agora="">
      <span className="font-os-mono text-[11px] text-mag">{String(Math.floor(agoraNoFuso.minutos / 60)).padStart(2, '0')}:{String(agoraNoFuso.minutos % 60).padStart(2, '0')}</span>
      <span className="flex-1 border-t border-mag" />
      <span className="font-os-mono text-[10px] text-mag">AGORA</span>
    </li>
  );

  const apoio = (e: EventoV2): React.ReactNode => {
    const ap = aparenciaDo(e);
    const partes: React.ReactNode[] = [];
    if (ap.tom === 'fechado' || ap.tom === 'pessoal') {
      const m = minutosDoEvento(e);
      partes.push(`${ap.etiqueta ?? ''}${m ? ` · até ${horaNoFuso(e.fim)}` : ''}`);
    } else {
      if (e.leitura.responsaveis.length) partes.push(e.leitura.responsaveis.join(', '));
      if (e.meet) partes.push('Meet');
      else if (e.local) partes.push(e.local);
      const traj = trajetoDe?.(e) ?? 0;
      if (traj > 0) partes.push(`trajeto ${traj} min antes`);
    }
    const momento = momentoDoMeet(e, agora);
    return (
      <>
        {partes.filter(Boolean).join(' · ')}
        {momento && e.meet && (
          <>
            {partes.length ? ' · ' : ''}
            {momento} ·{' '}
            <a href={e.meet} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-brand underline-offset-2 hover:underline">
              entrar no Meet
            </a>
          </>
        )}
      </>
    );
  };

  const item = (e: EventoV2, hora: string) => {
    const ap = aparenciaDo(e);
    const choque = choques.has(e.id);
    const etiqueta = choque ? 'choque' : ap.etiqueta && ap.tom !== 'fechado' && ap.tom !== 'pessoal' ? ap.etiqueta : null;
    return (
      <li key={e.id} className="flex gap-3 border-t border-border/70 py-3 first:border-t-0" data-evento={e.id}>
        <span className="w-12 shrink-0 font-os-mono text-xs text-muted">{hora}</span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => aoClicar(e)} className={`block text-left text-sm font-medium leading-snug ${ap.tom === 'fechado' || ap.tom === 'pessoal' ? 'text-muted' : 'text-text'}`}>
            {ap.titulo}
          </button>
          <div className="mt-0.5 text-xs text-muted">{apoio(e)}</div>
          {etiqueta && <span className={`font-os-mono text-[9.5px] font-bold uppercase tracking-[0.08em] ${corDaEtiqueta(choque ? 'choque' : ap.tom, ap.semMeet)}`}>{etiqueta}</span>}
        </div>
        <span aria-hidden className={`mt-1 h-2.5 w-1 shrink-0 rounded-[1px] ${CLASSE_DO_TOM[choque ? 'choque' : ap.tom]}`} />
      </li>
    );
  };

  return (
    <div className="flex flex-col rounded-[3px] border border-border bg-surface" data-visao-da-agenda="lista">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <div>
          <div className="font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted">{ehHoje ? 'hoje' : r.semana}</div>
          <div className="text-[22px] font-bold capitalize tracking-tight">{r.extenso}</div>
        </div>
      </div>
      <ol className="px-4 py-1">
        {diaInteiro.map((e) => item(e, 'dia'))}
        {comHora.map((e, i) => (
          <FragmentoComAgora key={e.id} antes={i === indiceDoAgora ? linhaDoAgora : null}>
            {item(e, horaNoFuso(e.inicio))}
          </FragmentoComAgora>
        ))}
        {ehHoje && indiceDoAgora === -1 && comHora.length > 0 && linhaDoAgora}
        {!doDia.length && <li className="py-6 text-sm text-muted">Nada marcado neste dia.</li>}
        {typeof amanha === 'number' && (
          <li className="flex gap-3 border-t border-border/70 py-3">
            <span className="w-12 shrink-0" />
            <span className="text-xs text-muted">amanhã: {amanha} compromisso{amanha === 1 ? '' : 's'}</span>
          </li>
        )}
      </ol>
      <div className="flex gap-2 border-t border-border px-4 pb-4 pt-3">
        {podeMarcar && (
          <button type="button" onClick={aoMarcar} className="min-h-[44px] flex-1 rounded-[3px] border border-brand bg-brand px-3 text-sm font-semibold text-ink">
            + Marcar
          </button>
        )}
        <button type="button" onClick={aoConflitos} className="min-h-[44px] flex-1 rounded-[3px] border border-border bg-surface-2 px-3 text-sm">
          Conflitos{typeof conflitos === 'number' ? <span className="ml-1 font-os-mono text-mag">{conflitos}</span> : null}
        </button>
      </div>
    </div>
  );
}

function FragmentoComAgora({ antes, children }: { antes: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {antes}
      {children}
    </>
  );
}
