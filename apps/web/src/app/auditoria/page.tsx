'use client';

import { useEffect, useState } from 'react';
import type { AuditList } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const ACTOR_CLS: Record<string, string> = {
  user: 'bg-brand/15 text-brand',
  ai: 'bg-warn/15 text-warn',
  system: 'bg-surface-2 text-muted',
};

const FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'user', label: 'Usuários' },
  { key: 'ai', label: 'IA' },
  { key: 'system', label: 'Sistema' },
];

export default function AuditoriaPage() {
  const { token, ready } = useAuth();
  const [data, setData] = useState<AuditList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    if (!ready || !token) return;
    const params = new URLSearchParams({ limit: '150' });
    if (actorType) params.set('actorType', actorType);
    if (action.trim()) params.set('action', action.trim());
    setData(null);
    apiGet<AuditList>(`/audit?${params}`, token).then(setData).catch((e) => setError(e.message));
  }, [ready, token, actorType, action]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Auditoria</h1>
          <p className="text-sm text-muted">
            {data ? `${data.total} registro(s)` : 'Carregando…'} · quem fez o quê (usuários, IA e sistema).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setActorType(f.key)}
                className={`rounded-lg border border-border px-3 py-1.5 text-sm ${actorType === f.key ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="filtrar por ação…"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          />
        </div>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Quando</th>
                <th className="px-4 py-3 font-medium">Ator</th>
                <th className="px-4 py-3 font-medium">Ação</th>
                <th className="px-4 py-3 font-medium">Entidade</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                    {new Date(r.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${ACTOR_CLS[r.actorType] ?? ''}`}>
                      {r.actorType}
                    </span>{' '}
                    <span className="text-muted">{r.actorName ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{r.action}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {r.entityType ? `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.ip ?? '—'}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">Nenhum registro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
