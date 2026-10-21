'use client';

import { useEffect, useState } from 'react';
import { Instagram, Plug, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface MStatus {
  configured: boolean;
  connected: boolean;
  page: string | null;
  igUsername: string | null;
  hasInstagram: boolean;
  connectedAt: string | null;
}
interface Overview {
  username: string | null; name: string | null; biography: string | null; profilePic: string | null;
  followers: number; follows: number; mediaCount: number;
  reach28: number | null; impressions28: number | null; profileViews28: number | null;
}
interface MediaItem {
  id: string; caption: string; type: string | null; permalink: string | null; timestamp: string | null;
  likes: number; comments: number; reach: number | null; impressions: number | null; saved: number | null;
}

const nf = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR'));

export default function InstagramPage() {
  const { token, ready, can } = useAuth();
  const [st, setSt] = useState<MStatus | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const erro = new URLSearchParams(window.location.search).get('erro');
    if (erro) setError(`Falha ao conectar: ${erro}`);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<MStatus>('/meta/status', token).then((s) => {
      setSt(s);
      if (s.connected && s.hasInstagram) {
        apiGet<Overview>('/meta/instagram/overview', token).then(setOv).catch((e) => setError(e.message));
        apiGet<{ items: MediaItem[] }>('/meta/instagram/media?limit=12', token).then((r) => setMedia(r.items)).catch(() => {});
      }
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const connect = () => apiGet<{ url: string }>('/meta/connect', token).then((r) => { window.location.href = r.url; }).catch((e) => setError(e.message));
  const disconnect = () => apiPost('/meta/disconnect', {}, token).then(() => location.reload()).catch((e) => setError(e.message));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Conta Business via Login do Facebook (Instagram Graph API).</p>
          <a href="/conexoes" className="mt-1 inline-block text-xs text-brand underline">Configurar em Conexões</a>
        </div>
        {st?.connected && can('admin.usuarios') && (
          <button onClick={disconnect} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">Desconectar</button>
        )}
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}

      <div className="rounded-xl border border-border bg-surface p-5">
        {!st ? <span className="text-sm text-muted">Carregando…</span>
        : !st.configured ? (
          <div className="text-sm text-muted">
            <span className="font-medium text-warn">Credencial do Meta não configurada.</span> Coloque
            <code className="mx-1">META_APP_ID/SECRET</code> em <code>~/.config/root/meta.env</code> e reinicie a API.
          </div>
        ) : st.connected ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CheckCircle2 size={16} className="text-good" />
            Conectado · página <span className="font-medium">{st.page ?? '—'}</span>
            {st.hasInstagram ? <> · IG <span className="font-medium">@{st.igUsername}</span></>
              : <span className="text-warn">· nenhuma conta Instagram Business vinculada à Página</span>}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Ainda não conectado.</span>
            {can('admin.usuarios') ? (
              <button onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
                <Plug size={15} /> Conectar Instagram
              </button>
            ) : <span className="text-xs text-muted">Só admin conecta.</span>}
          </div>
        )}
      </div>

      {ov && (
        <>
          <div className="flex items-center gap-3">
            {ov.profilePic && <img src={ov.profilePic} alt="" className="h-12 w-12 rounded-full" />}
            <div>
              <div className="font-medium">@{ov.username} <span className="text-sm text-muted">{ov.name}</span></div>
              {ov.biography && <div className="text-[11px] text-muted line-clamp-1">{ov.biography}</div>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Seguidores" value={nf(ov.followers)} />
            <Stat label="Seguindo" value={nf(ov.follows)} />
            <Stat label="Publicações" value={nf(ov.mediaCount)} />
            <Stat label="Alcance (28d)" value={nf(ov.reach28)} />
            <Stat label="Impressões (28d)" value={nf(ov.impressions28)} />
            <Stat label="Visitas ao perfil (28d)" value={nf(ov.profileViews28)} />
          </div>
        </>
      )}

      {media && media.length > 0 && (
        <div>
          <h2 className="mb-2 flex items-center gap-2 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted"><Instagram size={16} className="text-brand" /> Últimos posts</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Post</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">❤️</th>
                  <th className="px-3 py-2 text-right">💬</th>
                  <th className="px-3 py-2 text-right">Alcance</th>
                  <th className="px-3 py-2 text-right">Impr.</th>
                  <th className="px-3 py-2 text-right">Salvos</th>
                </tr>
              </thead>
              <tbody>
                {media.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{m.timestamp ? new Date(m.timestamp).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="px-3 py-2"><a href={m.permalink ?? '#'} target="_blank" rel="noreferrer" className="hover:text-brand">{m.caption || '(sem legenda)'}</a></td>
                    <td className="px-3 py-2 text-[11px] text-muted">{m.type}</td>
                    <td className="px-3 py-2 text-right">{nf(m.likes)}</td>
                    <td className="px-3 py-2 text-right">{nf(m.comments)}</td>
                    <td className="px-3 py-2 text-right">{nf(m.reach)}</td>
                    <td className="px-3 py-2 text-right">{nf(m.impressions)}</td>
                    <td className="px-3 py-2 text-right">{nf(m.saved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
