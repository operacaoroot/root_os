'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { StatusChip } from '@/components/StatusChip';

interface LeadDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  score: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPage: string | null;
  enteredAt: string;
  source: { name: string } | null;
  campaign: { name: string } | null;
  events: { id: string; type: string; occurredAt: string }[];
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm">{value ?? '—'}</div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { token, ready } = useAuth();
  const params = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<LeadDetail>(`/leads/${params.id}`, token)
      .then(setLead)
      .catch((e) => setError(e.message));
  }, [ready, token, params.id]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={15} /> Voltar para leads
      </Link>

      {error && <div className="text-sm text-bad">{error}</div>}
      {!lead && !error && <div className="text-muted">Carregando…</div>}

      {lead && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-5">
            <div>
              <h1 className="text-lg font-semibold">{lead.name}</h1>
              <div className="text-sm text-muted">{lead.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <StatusChip status={lead.status} />
              <div className="text-right">
                <div className="text-xs text-muted">Score</div>
                <div className="text-lg font-semibold text-brand">{lead.score ?? '—'}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-3">
            <Field label="Telefone" value={lead.phone} />
            <Field label="Origem" value={lead.source?.name} />
            <Field label="Campanha" value={lead.campaign?.name} />
            <Field label="UTM source" value={lead.utmSource} />
            <Field label="UTM medium" value={lead.utmMedium} />
            <Field label="UTM campaign" value={lead.utmCampaign} />
            <Field label="Entrada" value={new Date(lead.enteredAt).toLocaleString('pt-BR')} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-medium text-muted">Histórico de interações</h2>
            <ol className="space-y-2">
              {lead.events.map((ev) => (
                <li key={ev.id} className="flex items-center gap-3 text-sm">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  <span className="capitalize">{ev.type}</span>
                  <span className="ml-auto text-xs text-muted">
                    {new Date(ev.occurredAt).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
              {lead.events.length === 0 && (
                <li className="text-sm text-muted">Sem interações registradas.</li>
              )}
            </ol>
          </div>

          <p className="text-[11px] text-muted">
            Resumo por IA e próximas ações entram na Fase 2/7 (via MCP).
          </p>
        </>
      )}
    </div>
  );
}
