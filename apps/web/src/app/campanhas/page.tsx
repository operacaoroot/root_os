'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CampaignList } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const brl = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_CLS: Record<string, string> = {
  ativa: 'bg-good/15 text-good',
  problema: 'bg-bad/15 text-bad',
  pausada: 'bg-warn/15 text-warn',
  encerrada: 'bg-surface-2 text-muted',
};

function CampaignsInner() {
  const { token, ready } = useAuth();
  const sp = useSearchParams();
  const status = sp.get('status') ?? undefined;
  const [data, setData] = useState<CampaignList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    const qs = status ? `?status=${status}` : '';
    setData(null);
    apiGet<CampaignList>(`/campaigns${qs}`, token).then(setData).catch((e) => setError(e.message));
  }, [ready, token, status]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Campanhas</h1>
        <p className="text-sm text-muted">
          {data ? `${data.items.length} campanha(s)` : 'Carregando…'}
          {status && ` — status "${status}"`} · clique para abrir o dossiê.
        </p>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Campanha</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Conversões</th>
                <th className="px-4 py-3 font-medium">Investido</th>
                <th className="px-4 py-3 font-medium">CPL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/campanhas/${c.id}`} className="font-medium hover:text-brand">
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted">{c.objective}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_CLS[c.status] ?? 'bg-surface-2 text-muted'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.channel ?? '—'}</td>
                  <td className="px-4 py-3">{c.leads}</td>
                  <td className="px-4 py-3">{c.conversions}</td>
                  <td className="px-4 py-3 text-muted">{brl(c.spend)}</td>
                  <td className="px-4 py-3">{brl(c.cpl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<div className="text-muted">Carregando…</div>}>
      <CampaignsInner />
    </Suspense>
  );
}
