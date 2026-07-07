'use client';

import { useEffect, useState } from 'react';
import { Search, RefreshCw, ArrowLeft, FileText } from 'lucide-react';
import type { KnowledgeList, NoteDetail, SearchResult } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ObsidianPage() {
  const { token, ready, can } = useAuth();
  const [list, setList] = useState<KnowledgeList | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = () => {
    if (!token) return;
    apiGet<KnowledgeList>('/knowledge', token).then(setList).catch((e) => setError(e.message));
  };
  useEffect(() => { if (ready && token) loadList(); /* eslint-disable-next-line */ }, [ready, token]);

  const search = () => {
    if (!token || !q.trim()) { setResults(null); return; }
    setBusy(true);
    apiGet<SearchResult>(`/knowledge/search?q=${encodeURIComponent(q)}`, token)
      .then(setResults).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  const open = (id: string) => {
    if (!token) return;
    apiGet<NoteDetail>(`/knowledge/${id}`, token).then(setNote).catch((e) => setError(e.message));
  };
  const reindex = () => {
    if (!token) return;
    setBusy(true);
    apiPost<{ notes: number }>('/knowledge/reindex', {}, token)
      .then(() => loadList()).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };

  if (note) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <button onClick={() => setNote(null)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft size={15} /> Voltar
        </button>
        <div className="rounded-xl border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold">{note.title}</h1>
          <div className="mt-1 text-xs text-muted">{note.path}</div>
          {note.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.map((t) => <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">#{t}</span>)}
            </div>
          )}
          <Markdown text={note.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Obsidian · Base de conhecimento</h1>
          <p className="text-sm text-muted">
            {list ? `${list.total} nota(s) · ${list.indexedNotes} com busca semântica` : 'Carregando…'} ·
            busca por significado (não só palavra).
          </p>
        </div>
        {can('obsidian.editar') && (
          <button onClick={reindex} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Reindexar
          </button>
        )}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Pergunte à base (ex.: qual a premissa de isolamento?)"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-dim"
          />
        </div>
        <button onClick={search} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          Buscar
        </button>
      </div>

      {results ? (
        <div>
          <div className="mb-2 text-xs text-muted">
            {results.items.length} resultado(s) · modo {results.mode === 'semantic' ? 'semântico' : 'palavra-chave'}
            <button onClick={() => { setResults(null); setQ(''); }} className="ml-2 text-brand hover:underline">limpar</button>
          </div>
          <div className="space-y-2">
            {results.items.map((r) => (
              <button key={r.id} onClick={() => open(r.id)} className="block w-full rounded-xl border border-border bg-surface p-4 text-left hover:border-brand-dim">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.title}</span>
                  {results.mode === 'semantic' && (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{Math.round(r.score * 100)}%</span>
                  )}
                </div>
                <div className="text-[11px] text-muted">{r.path}</div>
                <p className="mt-1 text-sm text-muted">{r.snippet}</p>
              </button>
            ))}
            {results.items.length === 0 && <p className="text-sm text-muted">Nada encontrado.</p>}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="divide-y divide-border">
            {list?.items.map((n) => (
              <button key={n.id} onClick={() => open(n.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2">
                <FileText size={14} className="shrink-0 text-muted" />
                <span className="flex-1">{n.title}</span>
                <span className="text-[11px] text-muted">{n.folder ?? '/'}</span>
              </button>
            ))}
            {list && list.items.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted">Base vazia — clique em Reindexar.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Render markdown leve (títulos, bullets, negrito, wikilinks como texto).
function Markdown({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{1,6}\s+(.+)$/gm, '<div class="mt-3 font-semibold text-text">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '<span class="text-brand">$2$1</span>')
    .replace(/^[-*]\s+(.+)$/gm, '• $1')
    .replace(/\n/g, '<br/>');
  return <div className="mt-4 text-sm leading-relaxed text-muted" dangerouslySetInnerHTML={{ __html: html }} />;
}
