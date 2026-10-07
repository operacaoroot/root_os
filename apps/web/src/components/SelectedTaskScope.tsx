'use client';

import { useEffect, useState } from 'react';
import type { TrabEstrutura, TrabTarefaLista } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function SelectedTaskScope({ surface, listId, onSelect }: {
  surface: 'dashboard' | 'reports'; listId: string; onSelect: (id: string) => void;
}) {
  const { token, can } = useAuth();
  const [structure, setStructure] = useState<TrabEstrutura | null>(null);
  const [tasks, setTasks] = useState<TrabTarefaLista | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token || !can('tarefas.ver')) return;
    let active = true;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then((value) => { if (active) setStructure(value); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    setTasks(null); setError('');
    if (!token || !listId) return;
    let active = true;
    apiGet<TrabTarefaLista>(`/${surface}/tarefas?listId=${encodeURIComponent(listId)}&page=${page}&limit=500`, token)
      .then((value) => { if (active) setTasks(value); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [token, surface, listId, page]);
  if (!can('tarefas.ver')) return <p className="text-sm text-muted">Fonte de tarefas: legado.</p>;
  const lists = structure ? [...structure.listasSoltas, ...structure.folders.flatMap((folder) => folder.lists)] : [];
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <label className="text-sm">Tarefas por lista{' '}
      <select aria-label="Tarefas por lista" value={listId} onChange={(e) => { setPage(1); onSelect(e.target.value); }} className="bg-surface p-2">
        <option value="">Legado (sem seleção)</option>
        {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select>
    </label>
    <p className="text-sm text-muted">Fonte: {listId ? 'Trabalho · lista selecionada' : 'tarefas legadas'}{tasks && ` · ${tasks.total} tarefas · página ${page}`}</p>
    {error && <p role="alert">{error}</p>}
    {tasks && <>
      <ul className="max-h-64 overflow-auto text-sm">{tasks.items.map((task) => <li key={task.id}><a href={`/trabalho?lista=${encodeURIComponent(task.listId)}&tarefa=${task.id}`}>{task.title}</a> <code>{task.id}</code></li>)}</ul>
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>{' '}
      <button disabled={page * 500 >= tasks.total} onClick={() => setPage(page + 1)}>Próxima</button>
    </>}
  </section>;
}
