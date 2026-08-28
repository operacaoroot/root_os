'use client';

import { useEffect, useState } from 'react';
import type { IntegrationCatalog, IntegrationCatalogRow } from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const STATUS_CLS: Record<string, string> = {
  connected: 'bg-good/15 text-good',
  disconnected: 'bg-surface-2 text-muted',
  error: 'bg-bad/15 text-bad',
};
const STATUS_LABEL: Record<string, string> = {
  connected: 'conectado',
  disconnected: 'desconectado',
  error: 'erro',
};

export default function IntegracoesPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<IntegrationCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = can('admin.usuarios');

  const load = () => {
    if (!token) return;
    apiGet<IntegrationCatalog>('/integrations/catalog', token).then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const toggle = (row: IntegrationCatalogRow) => {
    const status = row.status === 'connected' ? 'disconnected' : 'connected';
    apiPut(`/integrations/${row.key}`, { status }, token).then(load).catch((e) => setError(e.message));
  };

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const canSync = can('tarefas.editar');
  const syncClickup = () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    apiPost<{ tasks: number; content: number; lists: number }>('/integrations/clickup/sync', {}, token)
      .then((r) => { setSyncMsg(`✅ ${r.tasks} tarefa(s) + ${r.content} conteúdo(s).`); load(); })
      .catch((e) => setError(e.message))
      .finally(() => setSyncing(false));
  };

  const connected = data?.items.filter((i) => i.status === 'connected').length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">
          {data ? `${connected}/${data.items.length} conectada(s)` : 'Carregando…'} · o hub de
          conectores. Os de <strong>OAuth</strong> (Instagram, Gmail, Drive) precisam de credencial
          própria do root — entram quando o acesso for gerado.
        </p>
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((i) => (
          <div key={i.key} className="flex flex-col rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{i.label}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {i.category} · fase {i.phase} · {i.authType}
                </div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLS[i.status] ?? ''}`}>
                {STATUS_LABEL[i.status] ?? i.status}
              </span>
            </div>

            <p className="mt-2 flex-1 text-xs text-muted">
              {i.managed ? 'Requer: ' : '🔒 '}
              {i.requires}
              {i.lastSyncAt && (
                <span className="mt-1 block text-[10px]">
                  último sync: {new Date(i.lastSyncAt).toLocaleString('pt-BR')}
                </span>
              )}
              {i.lastError && <span className="mt-1 block text-[10px] text-bad">erro: {i.lastError}</span>}
            </p>

            <div className="mt-3 space-y-2">
              {i.key === 'clickup' && canSync && (
                <>
                  <button
                    onClick={syncClickup}
                    disabled={syncing}
                    className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60"
                  >
                    {syncing ? 'Sincronizando…' : 'Sincronizar tarefas'}
                  </button>
                  {syncMsg && <p className="text-[11px] text-good">{syncMsg}</p>}
                </>
              )}
              {i.managed ? (
                canManage ? (
                  <button
                    onClick={() => toggle(i)}
                    className={`w-full rounded-lg px-3 py-1.5 text-sm font-medium ${
                      i.status === 'connected'
                        ? 'border border-border text-muted hover:bg-surface-2 hover:text-text'
                        : 'bg-brand text-ink hover:opacity-90'
                    }`}
                  >
                    {i.status === 'connected' ? 'Desconectar' : 'Conectar'}
                  </button>
                ) : (
                  <span className="text-[11px] text-muted">Gerência restrita a admin.</span>
                )
              ) : ['gmail', 'gcal', 'gdocs', 'drive'].includes(i.key) ? (
                <a href="/google" className="inline-block rounded-lg border border-border px-3 py-1.5 text-[11px] text-brand hover:bg-surface-2">
                  Conectar/gerenciar em Google →
                </a>
              ) : (
                <span className="inline-block rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-muted">
                  Requer OAuth + credencial (em breve)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="text-[11px] text-muted">
          Fonte: {data.source.tool} · gerado {new Date(data.source.generatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}
