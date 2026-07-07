'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import type { DailyReport, ReportList } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RelatoriosPage() {
  const { token, ready, can } = useAuth();
  const [latest, setLatest] = useState<DailyReport | null>(null);
  const [history, setHistory] = useState<ReportList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const canGenerate = can('relatorios.gerar');

  const load = () => {
    if (!token) return;
    Promise.all([
      apiGet<{ report: DailyReport | null }>('/reports/daily/latest', token),
      apiGet<ReportList>('/reports/daily?limit=30', token),
    ])
      .then(([l, h]) => { setLatest(l.report); setHistory(h); setError(null); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const generate = () => {
    if (!token) return;
    setGenerating(true);
    setError(null);
    apiPost<DailyReport>('/reports/daily/generate', {}, token)
      .then((r) => { setLatest(r); load(); })
      .catch((e) => setError(e.message))
      .finally(() => setGenerating(false));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Relatórios · Resumo diário (IA)</h1>
          <p className="text-sm text-muted">
            Briefing executivo gerado por IA a partir dos números do dashboard, funil, tráfego,
            tarefas e campanhas.
          </p>
        </div>
        {canGenerate && (
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {generating ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? 'Gerando…' : 'Gerar agora'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {latest ? (
        <article className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="font-semibold">{latest.title}</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              {latest.provider}/{latest.model} · {new Date(latest.createdAt).toLocaleString('pt-BR')}
            </span>
          </div>
          <Markdown text={latest.summary} />
        </article>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          {ready ? 'Nenhum resumo ainda.' : 'Carregando…'}
          {canGenerate && ready && ' Clique em “Gerar agora” para criar o primeiro.'}
        </div>
      )}

      {history && history.items.length > 1 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Histórico ({history.total})</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {history.items.slice(1).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2">
                <span>{r.title}</span>
                <span className="text-[11px] text-muted">
                  {r.provider}/{r.model} · {new Date(r.createdAt).toLocaleString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Renderizador markdown leve (títulos ##, bullets -, **negrito**). Sem dependência.
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={key} className="my-2 list-disc space-y-1 pl-5 text-sm">
          {bullets.map((b, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inline(b) }} />)}
        </ul>,
      );
      bullets = [];
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^#{1,2}\s+/.test(line)) {
      flush(`f${i}`);
      blocks.push(
        <h4 key={i} className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand">
          {line.replace(/^#{1,2}\s+/, '')}
        </h4>,
      );
    } else if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flush(`f${i}`);
    } else {
      flush(`f${i}`);
      blocks.push(<p key={i} className="my-1 text-sm" dangerouslySetInnerHTML={{ __html: inline(line) }} />);
    }
  });
  flush('fend');
  return <div>{blocks}</div>;
}

function inline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}
