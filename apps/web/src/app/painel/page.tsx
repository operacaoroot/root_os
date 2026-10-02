'use client';

import { useEffect, useState } from 'react';
import type { DashboardSummary } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { PilulaCustoIa } from './custo-ia/Pilula';

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DashboardPage() {
  const { token, ready, user } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<DashboardSummary>('/dashboard/summary', token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [ready, token]);

  return (
    <div className="space-y-6">
      {/* A Topbar já diz "Console · o pulso da operação" — aqui vai só o que
          ela não tem: de quem é a sessão e o que a tela faz. Sem emoji e sem
          segunda pessoa: a voz da ROOT é de terminal, não de assistente. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-muted">
          Sessão de <span className="text-text">{user?.name}</span> · o dia inteiro em
          números. Cada cartão abre o detalhe.
        </p>
        {/* A pílula "custo hoje · teto" da casca (RF-B-03). Ela se vira sozinha:
            busca, erra e degrada por conta própria, para que uma falha no
            relatório de custo não leve o Console junto. */}
        <PilulaCustoIa />
      </div>

      {error && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          Erro ao carregar: {error}
        </div>
      )}

      {!data && !error && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
      )}

      {data && (
        <>
          <section>
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Visão geral</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              <KpiCard label="Leads hoje" value={data.leadsToday} href="/leads?period=today" tone="brand" icon="UserPlus" />
              <KpiCard label="Leads na semana" value={data.leadsWeek} href="/leads?period=week" icon="Users" />
              <KpiCard label="Leads no mês" value={data.leadsMonth} href="/leads?period=month" icon="Users" />
              <KpiCard label="Conversões (mês)" value={data.conversions} href="/leads?status=ganho" tone="good" icon="Target" />
              <KpiCard label="Vendas" value={data.sales} href="/pixels" tone="good" icon="ShoppingCart" />
              <KpiCard label="Receita" value={brl(data.revenue)} href="/pixels" tone="good" icon="DollarSign" />
              <KpiCard label="Taxa de conversão" value={`${data.conversionRate}%`} href="/funil" icon="TrendingUp" />
              <KpiCard label="Custo por lead" value={data.cpl != null ? brl(data.cpl) : '—'} href="/campanhas" icon="Coins" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Operação e alertas</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              <KpiCard label="Tarefas atrasadas" value={data.overdueTasks} href="/trabalho" tone={data.overdueTasks > 0 ? 'warn' : 'default'} icon="Clock" />
              <KpiCard label="Campanhas ativas" value={data.activeCampaigns} href="/campanhas" icon="Megaphone" />
              <KpiCard label="Campanhas em risco" value={data.campaignsAtRisk} href="/campanhas?status=problema" tone={data.campaignsAtRisk > 0 ? 'bad' : 'default'} icon="AlertTriangle" />
              <KpiCard label="Alertas críticos" value={data.criticalAlerts} href="/campanhas?status=problema" tone={data.criticalAlerts > 0 ? 'bad' : 'default'} icon="Siren" />
            </div>
          </section>

          <p className="text-[11px] text-muted">
            Fonte: {data.source.tool} · gerado {new Date(data.source.generatedAt).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
}
