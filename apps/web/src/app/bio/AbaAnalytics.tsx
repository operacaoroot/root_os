'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { BioAnalyticsDetalhe } from './tipos';
import { Card, Kpi } from './ui';

const PERIODOS = [7, 30, 90];

export function AbaAnalytics({
  pageId,
  token,
  onErro,
}: {
  pageId: string;
  token: string | null;
  onErro: (m: string) => void;
}) {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState<BioAnalyticsDetalhe | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGet<BioAnalyticsDetalhe>(`/bio/analytics/detail?pageId=${pageId}&days=${dias}`, token)
      .then(setD)
      .catch((e: Error) => onErro(e.message));
  }, [token, pageId, dias, onErro]);

  const pico = Math.max(1, ...(d?.serie.map((s) => s.views) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDias(p)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              dias === p ? 'bg-brand text-bg' : 'border border-border bg-surface text-muted hover:text-text'
            }`}
          >
            {p} dias
          </button>
        ))}
      </div>

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Visualizações" valor={d.views} />
            <Kpi label="Visitantes únicos" valor={d.visitantes} />
            <Kpi label="Cliques" valor={d.cliques} />
            <Kpi label="CTR" valor={d.ctr} sufixo="%" />
          </div>

          <Card titulo="Por dia">
            <div className="flex h-32 items-end gap-[2px]">
              {d.serie.map((s) => (
                <div
                  key={s.dia}
                  title={`${new Date(`${s.dia}T12:00:00`).toLocaleDateString('pt-BR')} · ${s.views} views · ${s.cliques} cliques`}
                  className="flex-1 rounded-t bg-brand/30 hover:bg-brand/50"
                  style={{ height: `${Math.max((s.views / pico) * 100, 2)}%` }}
                />
              ))}
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card titulo="Desempenho por botão">
              <div className="space-y-2">
                {d.links.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{l.rotulo}</span>
                    <span className="text-muted">{l.taxa}%</span>
                    <span className="w-10 text-right font-medium">{l.cliques}</span>
                  </div>
                ))}
                {d.links.length === 0 && <p className="text-xs text-muted">—</p>}
              </div>
            </Card>

            <div className="space-y-5">
              <Card titulo="Origem do tráfego">
                <Barras dados={d.origens} />
              </Card>
              <Card titulo="Dispositivo">
                <Barras dados={d.dispositivos} />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Barras({ dados }: { dados: { nome: string; total: number }[] }) {
  const maior = Math.max(1, ...dados.map((x) => x.total));
  if (!dados.length) return <p className="text-xs text-muted">—</p>;
  return (
    <div className="space-y-1.5">
      {dados.map((x) => (
        <div key={x.nome} className="flex items-center gap-2 text-sm">
          <span className="w-32 shrink-0 truncate text-muted">{x.nome}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-brand/50" style={{ width: `${(x.total / maior) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-xs">{x.total}</span>
        </div>
      ))}
    </div>
  );
}
