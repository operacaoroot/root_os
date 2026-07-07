'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TaskList } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  bloqueada: 'Bloqueada',
};

function TasksInner() {
  const { token, ready } = useAuth();
  const sp = useSearchParams();
  const overdue = sp.get('overdue') === '1';
  const [data, setData] = useState<TaskList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    setData(null);
    apiGet<TaskList>(`/tasks${overdue ? '?overdue=1' : ''}`, token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [ready, token, overdue]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tarefas</h1>
          <p className="text-sm text-muted">
            {data ? `${data.total} tarefa(s)` : 'Carregando…'} · {data?.overdue ?? 0} atrasada(s) · ClickUp/Asana unificados (conector na Fase 3).
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/tarefas" className={`rounded-lg border border-border px-3 py-1.5 ${!overdue ? 'bg-surface-2 text-text' : 'text-muted'}`}>
            Todas
          </Link>
          <Link href="/tarefas?overdue=1" className={`rounded-lg border border-border px-3 py-1.5 ${overdue ? 'bg-surface-2 text-text' : 'text-muted'}`}>
            Só atrasadas
          </Link>
        </div>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Tarefa</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Responsável</th>
                <th className="px-4 py-3 font-medium">Prazo</th>
                <th className="px-4 py-3 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((t) => (
                <tr key={t.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className="font-medium">{t.title}</span>
                    {t.priority === 'alta' && (
                      <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">alta</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{STATUS_LABEL[t.status] ?? t.status}</td>
                  <td className="px-4 py-3 text-muted">{t.assignee ?? '—'}</td>
                  <td className={`px-4 py-3 ${t.overdue ? 'font-medium text-bad' : 'text-muted'}`}>
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : '—'}
                    {t.overdue && ' · atrasada'}
                  </td>
                  <td className="px-4 py-3 text-muted capitalize">{t.tool}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Nenhuma tarefa.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="text-muted">Carregando…</div>}>
      <TasksInner />
    </Suspense>
  );
}
