'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { LeadList } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { StatusChip } from '@/components/StatusChip';
import { NovaOportunidadeExercicio } from './NovaOportunidadeExercicio';

const PERIOD_LABEL: Record<string, string> = {
  today: 'hoje',
  week: 'na semana',
  month: 'no mês',
};

function LeadsInner() {
  const { token, ready } = useAuth();
  const sp = useSearchParams();
  const period = sp.get('period') ?? undefined;
  const status = sp.get('status') ?? undefined;
  const [data, setData] = useState<LeadList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (status) qs.set('status', status);
    setData(null);
    apiGet<LeadList>(`/leads?${qs.toString()}`, token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [ready, token, period, status]);

  const subtitle = [
    period ? PERIOD_LABEL[period] : null,
    status ? `status "${status}"` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-5">
      <NovaOportunidadeExercicio />
      <div>
        <p className="text-sm text-muted">
          {data ? `${data.total} lead(s)` : 'Carregando…'} {subtitle && `— ${subtitle}`}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 font-medium">Dono</th>
                <th className="px-4 py-3 font-medium">Campanha</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Entrada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${l.id}`} className="font-medium text-text hover:text-brand">
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted">{l.email}</div>
                  </td>
                  <td className="px-4 py-3"><StatusChip status={l.status} /></td>
                  <td className="px-4 py-3 text-muted">{l.source ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{l.owner ?? 'sem dono'}</td>
                  <td className="px-4 py-3 text-muted">{l.campaign ?? '—'}</td>
                  <td className="px-4 py-3">{l.score ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(l.enteredAt).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    Nenhum lead para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="text-muted">Carregando…</div>}>
      <LeadsInner />
    </Suspense>
  );
}
