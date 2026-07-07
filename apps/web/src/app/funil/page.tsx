'use client';

import { useEffect, useState } from 'react';
import type { FunnelMetrics } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function FunnelPage() {
  const { token, ready } = useAuth();
  const [data, setData] = useState<FunnelMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<FunnelMetrics>('/funnel/metrics', token).then(setData).catch((e) => setError(e.message));
  }, [ready, token]);

  const max = data?.stages[0]?.count || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Funil de marketing</h1>
        <p className="text-sm text-muted">
          Do visitante à venda. Percentual = conversão em relação à etapa anterior.
        </p>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {data && (
        <div className="space-y-3">
          {data.stages.map((s) => {
            const pct = Math.max(4, Math.round((s.count / max) * 100));
            return (
              <div key={s.key} className="flex items-center gap-4">
                <div className="w-28 shrink-0 text-right text-sm text-muted">{s.label}</div>
                <div className="relative h-11 flex-1 overflow-hidden rounded-lg bg-surface">
                  <div
                    className="flex h-full items-center rounded-lg bg-gradient-to-r from-brand-dim to-brand px-3 text-sm font-semibold text-white transition-all"
                    style={{ width: `${pct}%` }}
                  >
                    {s.count}
                  </div>
                </div>
                <div className="w-16 shrink-0 text-sm">
                  {s.convFromPrev != null ? (
                    <span className={s.convFromPrev < 50 ? 'text-warn' : 'text-good'}>
                      {s.convFromPrev}%
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && (
        <p className="text-[11px] text-muted">
          Fonte: {data.source.tool} · gerado {new Date(data.source.generatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}
