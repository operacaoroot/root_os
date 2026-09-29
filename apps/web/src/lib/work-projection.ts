import type { TrabTarefaLista, TrabTarefaResumo } from '@mktos/shared';
import { apiGet } from './api';

export const trabalhoHref = (id: string) => `/trabalho?tarefa=${encodeURIComponent(id)}`;

/** Mesmo fuso local usado pela grade e por chaveDoDia na Agenda. */
export function intervaloDaGrade(grade: Date[]): { dueFrom: string; dueTo: string } {
  const ultimo = grade[grade.length - 1];
  if (!grade[0] || !ultimo) throw new Error('Grade vazia');
  const fimExclusivo = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1);
  return { dueFrom: grade[0].toISOString(), dueTo: fimExclusivo.toISOString() };
}

/** Percorre todas as páginas: a Agenda não pode perder prazos depois do item 500. */
export async function prazosDeTrabalho(token: string, range: { dueFrom: string; dueTo: string }): Promise<TrabTarefaResumo[]> {
  const items: TrabTarefaResumo[] = [];
  const limit = 500;
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ ...range, page: String(page), limit: String(limit) });
    const result = await apiGet<TrabTarefaLista>(`/trabalho/tarefas?${query}`, token);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (result.items.length === 0) throw new Error('A consulta de prazos terminou antes do total informado');
  }
}
