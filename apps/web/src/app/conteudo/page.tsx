'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ContentList } from '@mktos/shared';
import { apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Cor da coluna por tipo de etapa (open → custom → closed).
function colHead(status: string, type: string | null): string {
  if (type === 'closed' || type === 'done') return 'text-good';
  if (type === 'custom') return 'text-warn';
  return 'text-muted';
}

export default function ConteudoPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<ContentList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eixo, setEixo] = useState('');
  const [formato, setFormato] = useState('');
  const [bump, setBump] = useState(0);
  const editable = can('tarefas.editar');

  useEffect(() => {
    if (!ready || !token) return;
    const p = new URLSearchParams();
    if (eixo) p.set('eixo', eixo);
    if (formato) p.set('formato', formato);
    apiGet<ContentList>(`/content${p.toString() ? `?${p}` : ''}`, token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [ready, token, eixo, formato, bump]);

  const move = (id: string, status: string) =>
    apiPatch(`/content/${id}`, { status }, token).then(() => setBump((b) => b + 1)).catch((e) => setError(e.message));

  // meta de tipo por status (p/ cor do cabeçalho da coluna)
  const typeByStatus = new Map<string, string | null>();
  data?.items.forEach((i) => { if (!typeByStatus.has(i.status)) typeByStatus.set(i.status, i.statusType); });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {data ? `${data.total} tema(s) na lista` : 'Carregando…'} · temas importados da lista
            Gestão de Temas do ClickUp. Gerencie a conexão em{' '}
            <a href="/conexoes" className="text-brand hover:underline">Integrações</a>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={eixo} onChange={setEixo} placeholder="Todos os eixos" options={data?.eixos ?? []} />
          <Select value={formato} onChange={setFormato} placeholder="Todos os formatos" options={data?.formatos ?? []} />
        </div>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {data && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {data.statuses.map((st) => {
            const items = data.items.filter((i) => i.status === st);
            return (
              <div key={st} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between">
                  <span className={`text-sm font-medium capitalize ${colHead(st, typeByStatus.get(st) ?? null)}`}>
                    {st}
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border bg-surface p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm">{c.title}</p>
                        {c.url && (
                          <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-brand">
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.eixo && <Chip tone="brand">{c.eixo}</Chip>}
                        {c.formato && <Chip tone="warn">{c.formato}</Chip>}
                        {c.tipo && <Chip>{c.tipo}</Chip>}
                        {c.fonte && <Chip>{c.fonte}</Chip>}
                      </div>
                      {c.assignee && <div className="mt-1.5 text-[11px] text-muted">{c.assignee}</div>}
                      {editable && (
                        <select
                          value={c.status}
                          onChange={(e) => move(c.id, e.target.value)}
                          title="Mover etapa (grava no ClickUp)"
                          className="mt-2 w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] outline-none focus:border-brand-dim"
                        >
                          {data.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 text-xs text-muted">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Select({
  value, onChange, placeholder, options,
}: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'brand' | 'warn' | 'muted' }) {
  const cls =
    tone === 'brand' ? 'bg-brand/15 text-brand' : tone === 'warn' ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}
