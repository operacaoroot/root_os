'use client';

import { useMemo, useState } from 'react';
import type { TrabListaDto, TrabTarefaResumo } from '@mktos/shared';
import { colunasDeTodas, destinoNaLista, idDaColuna } from './colunas-de-todas';
import { AvataresDaTarefa } from './ResponsavelDaTarefa';
import { atrasada, dataBR, type PessoaDaEstrutura } from './TabelaDeTarefas';

/*
 * Layout 26/10 (Lucas): O QUADRO DE TAREFAS DE VÁRIAS LISTAS (Dia a dia › Minhas tarefas).
 * "Aqui falta a visualização de quadro." As tarefas vêm de listas com etapas diferentes,
 * então as colunas são as do quadro de "Todas" do Trabalho (`colunasDeTodas`): a união
 * das etapas das listas dessas tarefas, uma por nome normalizado, na ordem do tipo
 * (a fazer, em andamento, concluída). O cartão é o resumo do quadro do Trabalho (título,
 * cliente, responsáveis, prazo, atraso) e o clique abre o mesmo pop-up.
 * Arrastar para outra coluna muda a etapa DENTRO da lista da tarefa (`destinoNaLista`:
 * a de mesmo nome, senão a primeira do mesmo tipo); sem nenhuma das duas, nada muda e a
 * tela diz "a lista X não tem essa etapa". Quem grava é quem usa (`onMudarEtapa`).
 */
export function QuadroPorEtapa({ tarefas, listas, pessoas, podeEditar, onAbrir, onMudarEtapa, testid = 'quadro-por-etapa' }: {
  tarefas: TrabTarefaResumo[];
  /** As listas da estrutura (para achar as etapas da lista de cada tarefa). */
  listas: TrabListaDto[];
  pessoas: PessoaDaEstrutura[];
  podeEditar: boolean;
  onAbrir: (id: string) => void;
  onMudarEtapa: (id: string, statusId: string) => void | Promise<void>;
  testid?: string;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const listaPorId = useMemo(() => new Map(listas.map((l) => [l.id, l])), [listas]);
  const colunas = useMemo(() => {
    const dasTarefas = [...new Set(tarefas.map((t) => t.listId))].map((id) => listaPorId.get(id)).filter((l): l is TrabListaDto => !!l);
    return colunasDeTodas(dasTarefas, tarefas);
  }, [tarefas, listaPorId]);

  const soltar = (colunaId: string) => {
    const t = tarefas.find((x) => x.id === arrastando);
    setArrastando(null); setSobre(null);
    const coluna = colunas.find((c) => c.id === colunaId);
    if (!t || !coluna || idDaColuna(t.statusName) === colunaId) return;
    const lista = listaPorId.get(t.listId);
    const destino = destinoNaLista(lista, coluna);
    if (!destino) { setAviso(`Nada mudou: a lista ${t.listName ?? lista?.name ?? 'da tarefa'} não tem essa etapa (${coluna.name}).`); return; }
    setAviso(destino.exato ? null : `"${t.title}" foi para ${destino.nome} (a lista ${t.listName ?? lista?.name ?? ''} não tem a etapa ${coluna.name}).`);
    void onMudarEtapa(t.id, destino.statusId);
  };

  return (
    <div className="space-y-2" data-testid={testid}>
      {aviso && <p role="status" data-testid={`${testid}-aviso`} className="rounded border border-warn/40 bg-warn/10 px-3 py-1.5 text-[12.5px]">{aviso}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {colunas.map((c) => {
          const daColuna = tarefas.filter((t) => idDaColuna(t.statusName) === c.id);
          return (
            <section
              key={c.id} aria-label={`${c.name}: ${daColuna.length}`} data-testid={`${testid}-coluna-${c.id}`}
              onDragOver={podeEditar ? (e) => { if (arrastando) { e.preventDefault(); if (sobre !== c.id) setSobre(c.id); } } : undefined}
              onDragLeave={podeEditar ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre((x) => (x === c.id ? null : x)); } : undefined}
              onDrop={podeEditar ? (e) => { e.preventDefault(); soltar(c.id); } : undefined}
              className={`flex w-64 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 ${sobre === c.id ? 'ring-1 ring-brand-dim' : ''}`}
            >
              <header className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="ml-auto font-os-mono text-[10px]">{daColuna.length}</span>
              </header>
              {daColuna.map((t) => (
                <button
                  key={t.id} type="button" draggable={podeEditar} data-testid={`${testid}-cartao-${t.id}`}
                  onDragStart={(e) => { setArrastando(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setArrastando(null); setSobre(null); }}
                  onClick={() => onAbrir(t.id)}
                  className={`space-y-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-left text-[13px] hover:border-brand-dim ${arrastando === t.id ? 'opacity-50' : ''}`}
                >
                  <span className="block break-words">{t.title}</span>
                  <span className="flex items-center gap-2 text-[11px] text-muted">
                    <span className="min-w-0 flex-1 truncate">{t.clienteNome ?? 'sem cliente'}{t.listName ? ` · ${t.listName}` : ''}</span>
                    <AvataresDaTarefa tarefa={t} pessoas={pessoas} />
                  </span>
                  {t.dueDate && (
                    <span className={`block font-os-mono text-[10.5px] ${atrasada(t) ? 'text-bad' : 'text-muted'}`}>
                      {atrasada(t) ? 'atrasada · ' : ''}{dataBR(t.dueDate)}
                    </span>
                  )}
                </button>
              ))}
              {daColuna.length === 0 && <p className="px-1 text-[11px] text-muted">Nenhuma tarefa.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
