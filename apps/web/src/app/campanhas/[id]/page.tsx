'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { CampaignDossier } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { StatusChip } from '@/components/StatusChip';

const brl = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

export default function CampaignDossierPage() {
  const { token, ready } = useAuth();
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<CampaignDossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<CampaignDossier>(`/campaigns/${params.id}`, token).then(setD).catch((e) => setError(e.message));
  }, [ready, token, params.id]);

  return (
    <div className="space-y-5">
      <Link href="/campanhas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={15} /> Voltar para campanhas
      </Link>

      {error && <div className="text-sm text-bad">{error}</div>}
      {!d && !error && <div className="text-muted">Carregando…</div>}

      {d && (
        <>
          <div>
            <h1 className="text-xl font-semibold">{d.campaign.name}</h1>
            <p className="text-sm text-muted">
              {d.campaign.objective} · {d.campaign.channel} · status{' '}
              <span className="capitalize">{d.campaign.status}</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Metric label="Leads" value={d.metrics.leads} />
            <Metric label="Conversões" value={d.metrics.conversions} />
            <Metric label="CPL" value={brl(d.metrics.cpl)} />
            <Metric label="CPA" value={brl(d.metrics.cpa)} />
            <Metric label="Orçamento" value={brl(d.campaign.budget)} />
            <Metric label="Investido" value={brl(d.campaign.spend)} />
            <Metric label="Receita" value={d.metrics.revenue == null ? '— (Fase 2+)' : brl(d.metrics.revenue)} />
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-surface px-4 py-3 text-sm font-medium">
              Leads da campanha ({d.leads.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface/50 text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Origem</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.leads.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-2">
                      <td className="px-4 py-2">
                        <Link href={`/leads/${l.id}`} className="hover:text-brand">{l.name}</Link>
                      </td>
                      <td className="px-4 py-2"><StatusChip status={l.status} /></td>
                      <td className="px-4 py-2 text-muted">{l.source ?? '—'}</td>
                      <td className="px-4 py-2">{l.score ?? '—'}</td>
                    </tr>
                  ))}
                  {d.leads.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">Sem leads nesta campanha.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
