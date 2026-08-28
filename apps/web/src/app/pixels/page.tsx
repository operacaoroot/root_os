'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EventsSummary, EventsRecent } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Cor por tipo de evento (consistência visual entre listas e tabela).
const EVENT_TONE: Record<string, string> = {
  page_view: 'bg-brand/15 text-brand',
  purchase: 'bg-good/15 text-good',
  lead: 'bg-warn/15 text-warn',
  cta_click: 'bg-surface-2 text-muted',
};
function tone(name: string) {
  return EVENT_TONE[name] ?? 'bg-surface-2 text-muted';
}

export default function PixelsPage() {
  const { token, ready } = useAuth();
  const [sum, setSum] = useState<EventsSummary | null>(null);
  const [recent, setRecent] = useState<EventsRecent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('https://SEU-HOST');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = () => {
    if (!token) return;
    Promise.all([
      apiGet<EventsSummary>('/events/summary?days=7', token),
      apiGet<EventsRecent>('/events/recent?limit=50', token),
    ])
      .then(([s, r]) => { setSum(s); setRecent(r); setError(null); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const snippet = `<script async src="${origin}/pixel.js"></script>`;
  const copy = () => {
    navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const maxDaily = Math.max(1, ...(sum?.daily.map((d) => d.events) ?? [1]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Tráfego capturado pelo <code className="text-text">pixel.js</code> nas páginas de vendas ·
            últimos {sum?.window.days ?? 7} dias.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/demo-vendas.html"
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text"
          >
            Abrir página demo ↗
          </Link>
          <button
            onClick={load}
            className="rounded-lg border border-border px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Eventos" value={sum?.totals.events ?? '—'} icon="Activity" tone="brand" />
        <KpiCard label="Sessões" value={sum?.totals.sessions ?? '—'} icon="MousePointerClick" />
        <KpiCard label="Visitantes" value={sum?.totals.visitors ?? '—'} icon="Users" />
        <KpiCard label="Compras" value={sum?.totals.purchases ?? '—'} icon="ShoppingCart" tone="good" />
        <KpiCard
          label="Receita"
          value={sum ? brl(sum.totals.revenue) : '—'}
          icon="DollarSign"
          tone="good"
        />
      </div>

      {/* Snippet de instalação */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Instalar na página de vendas
          </span>
          <button onClick={copy} className="text-[11px] text-brand hover:underline">
            {copied ? 'copiado ✓' : 'copiar'}
          </button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12px] text-text">
          {snippet}
        </pre>
        <p className="mt-2 text-[11px] text-muted">
          Cole antes do <code>{'</head>'}</code>. Dispara <code>page_view</code> automático; para vendas
          use <code>mktos.track(&apos;purchase&apos;, {'{ value: 497 }'})</code>. Endpoint público:{' '}
          <code>{origin}/api/events/track</code>.
        </p>
      </div>

      {/* Mini-gráfico diário */}
      {sum && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Eventos por dia
          </div>
          <div className="flex h-28 items-end gap-1.5">
            {sum.daily.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.events} eventos · ${d.sessions} sessões`}>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-brand-dim to-brand transition-all"
                  style={{ height: `${Math.max(2, Math.round((d.events / maxDaily) * 100))}%` }}
                />
                <span className="text-[10px] text-muted">{d.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breakdowns */}
      {sum && (
        <div className="grid gap-3 md:grid-cols-3">
          <Breakdown title="Por evento">
            {sum.byEvent.map((e) => (
              <li key={e.name} className="flex items-center justify-between py-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone(e.name)}`}>{e.name}</span>
                <span className="text-sm text-muted">{e.count}</span>
              </li>
            ))}
          </Breakdown>
          <Breakdown title="Por origem (UTM)">
            {sum.bySource.map((s) => (
              <li key={s.source} className="flex items-center justify-between py-1.5">
                <span className="text-sm capitalize">{s.source}</span>
                <span className="text-sm text-muted">{s.count}</span>
              </li>
            ))}
          </Breakdown>
          <Breakdown title="Páginas mais vistas">
            {sum.topPages.map((p) => (
              <li key={p.url} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate text-sm text-muted" title={p.url}>{shortPath(p.url)}</span>
                <span className="text-sm text-muted">{p.count}</span>
              </li>
            ))}
            {sum.topPages.length === 0 && <li className="py-1.5 text-sm text-muted">—</li>}
          </Breakdown>
        </div>
      )}

      {/* Tabela de eventos recentes */}
      <div>
        <h2 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">
          Eventos recentes {recent ? `(${recent.total} no total)` : ''}
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Evento</th>
                  <th className="px-4 py-3 font-medium">Página</th>
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Disp.</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent?.items.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                      {new Date(e.occurredAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone(e.eventName)}`}>
                        {e.eventName}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-muted" title={e.url ?? ''}>
                      {e.url ? shortPath(e.url) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted capitalize">{e.utmSource ?? 'direto'}</td>
                    <td className="px-4 py-2.5 text-muted">{e.device ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted">{e.value != null ? brl(e.value) : '—'}</td>
                  </tr>
                ))}
                {recent && recent.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted">
                      Nenhum evento ainda. Abra a{' '}
                      <Link href="/demo-vendas.html" target="_blank" className="text-brand hover:underline">
                        página demo
                      </Link>{' '}
                      e clique nos botões.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {sum && (
        <p className="text-[11px] text-muted">
          Fonte: {sum.source.tool} · gerado {new Date(sum.source.generatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

function Breakdown({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.host : u.pathname;
  } catch {
    return url;
  }
}
