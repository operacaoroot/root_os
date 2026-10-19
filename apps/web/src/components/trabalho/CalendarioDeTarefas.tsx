'use client';

import { useState } from 'react';
import { hojeEmBrasilia } from '@/lib/horas';

/*
 * O CALENDÁRIO DAS TAREFAS (versão final, F4, 19/10/2026). Trazido do Dia a dia do
 * Lucas para o Trabalho e para Minhas tarefas, num componente só: as tarefas no dia
 * do prazo, mês a mês, com a semana começando na segunda. Arrastar para outro dia
 * muda o prazo; as sem prazo ficam numa faixa embaixo e também podem ir para um dia.
 *
 * Quem grava é quem usa (`onMudarPrazo`), sempre com a versão lida da tarefa: este
 * componente não fala com a API. O dia é o do relógio de São Paulo, e o prazo novo
 * vai como meio-dia de São Paulo (`prazoDoDia`), o mesmo instante que o campo Prazo
 * do pop-up grava, para a tarefa não contar como vencida desde a meia-noite.
 */

export interface ItemDoCalendario {
  id: string;
  titulo: string;
  /** Instante ISO do prazo, ou nulo. */
  prazo: string | null;
  concluida: boolean;
  /** Texto do `title` (cliente, responsável, lista). */
  detalhe?: string;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** O dia (AAAA-MM-DD) de um instante no relógio de São Paulo. */
export function diaDoPrazo(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** O instante gravado para um dia escolhido no calendário: meio-dia em São Paulo. */
export function prazoDoDia(dia: string): string {
  return new Date(`${dia}T15:00:00.000Z`).toISOString();
}

/** Soma dias a um AAAA-MM-DD sem passar pelo fuso local (o dia não escorrega). */
function somaDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function CalendarioDeTarefas({ itens, podeEditar, onAbrir, onMudarPrazo, hoje = hojeEmBrasilia(), testid = 'calendario-de-tarefas' }: {
  itens: ItemDoCalendario[];
  podeEditar: boolean;
  onAbrir: (id: string) => void;
  onMudarPrazo: (id: string, dia: string) => void | Promise<void>;
  hoje?: string;
  testid?: string;
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [ano, m] = mes.split('-').map(Number);
  const primeiroDia = `${mes}-01`;
  const diaDaSemana = new Date(`${primeiroDia}T12:00:00Z`).getUTCDay();
  const inicio = somaDias(primeiroDia, -((diaDaSemana + 6) % 7));
  const dias = Array.from({ length: 42 }, (_, i) => somaDias(inicio, i));
  const porDia = new Map<string, ItemDoCalendario[]>();
  for (const t of itens) {
    const d = diaDoPrazo(t.prazo);
    if (d) porDia.set(d, [...(porDia.get(d) ?? []), t]);
  }
  const semPrazo = itens.filter((t) => !diaDoPrazo(t.prazo));
  const irMes = (n: number) => setMes(new Date(Date.UTC(ano, m - 1 + n, 1)).toISOString().slice(0, 7));
  const soltar = (dia: string, idArrastado: string | null) => {
    setArrastando(null);
    setSobre(null);
    const t = itens.find((x) => x.id === idArrastado);
    if (!t || diaDoPrazo(t.prazo) === dia) return;
    void onMudarPrazo(t.id, dia);
  };
  const arrastavel = (t: ItemDoCalendario) => ({
    draggable: podeEditar,
    onDragStart: (e: React.DragEvent) => { setArrastando(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnd: () => { setArrastando(null); setSobre(null); },
  });
  const botao = 'rounded-md border border-border px-2.5 py-1 text-sm hover:border-brand max-md:min-h-[44px]';
  const tarefa = (t: ItemDoCalendario, dia: string | null) => {
    const atrasada = !t.concluida && !!dia && dia < hoje;
    return (
      <button
        key={t.id}
        type="button"
        {...arrastavel(t)}
        onClick={() => onAbrir(t.id)}
        data-testid={`${testid}-tarefa-${t.id}`}
        title={[t.titulo, t.detalhe].filter(Boolean).join(' · ')}
        className={`block w-full truncate rounded border-l-2 bg-surface-2 px-1.5 py-0.5 text-left text-xs hover:bg-brand/15 ${t.concluida ? 'border-border text-muted line-through' : atrasada ? 'border-bad text-bad' : 'border-brand'}`}
      >
        {t.titulo}
      </button>
    );
  };
  return (
    <div className="space-y-3" data-testid={testid}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => irMes(-1)} className={botao} aria-label="Mês anterior">‹</button>
          <button type="button" onClick={() => setMes(hoje.slice(0, 7))} className={botao}>Hoje</button>
          <button type="button" onClick={() => irMes(1)} className={botao} aria-label="Próximo mês">›</button>
        </div>
        <span className="text-[1.05rem] font-semibold" data-testid={`${testid}-mes`}>{MESES[m - 1]} {ano}</span>
        {podeEditar && <span className="ml-auto text-sm text-muted">Arraste uma tarefa para outro dia para mudar o prazo.</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-md border border-border bg-surface">
          {SEMANA.map((d) => (
            <div key={d} className="border-b border-border px-2 py-1.5 font-os-mono text-[10.5px] uppercase tracking-wide text-muted">{d}</div>
          ))}
          {dias.map((dia) => {
            const doDia = porDia.get(dia) ?? [];
            const foraDoMes = dia.slice(0, 7) !== mes;
            return (
              <div
                key={dia}
                data-dia={dia}
                aria-label={`${Number(dia.slice(8))} de ${MESES[Number(dia.slice(5, 7)) - 1]}: ${doDia.length} ${doDia.length === 1 ? 'tarefa' : 'tarefas'}`}
                onDragOver={podeEditar ? (e) => { e.preventDefault(); if (sobre !== dia) setSobre(dia); } : undefined}
                onDragLeave={podeEditar ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre((x) => (x === dia ? null : x)); } : undefined}
                onDrop={podeEditar ? (e) => { e.preventDefault(); soltar(dia, arrastando ?? e.dataTransfer.getData('text/plain')); } : undefined}
                className={`min-h-[6.5rem] border-b border-r border-border p-1.5 ${foraDoMes ? 'bg-surface-2/40' : ''} ${sobre === dia ? 'bg-brand/10' : ''}`}
              >
                <span className={`font-os-mono text-xs ${dia === hoje ? 'rounded-full bg-brand px-1.5 text-ink' : foraDoMes ? 'text-muted/60' : 'text-muted'}`}>
                  {Number(dia.slice(8))}
                </span>
                <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">{doDia.map((t) => tarefa(t, dia))}</div>
              </div>
            );
          })}
        </div>
      </div>
      {semPrazo.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-3" data-testid={`${testid}-sem-prazo`}>
          <div className="mb-2 font-os-mono text-[10.5px] uppercase tracking-wide text-muted">
            Sem prazo · {semPrazo.length}{podeEditar ? ' · arraste para um dia' : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            {semPrazo.map((t) => <span key={t.id} className="max-w-[16rem]">{tarefa(t, null)}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
