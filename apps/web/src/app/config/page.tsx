'use client';

import { useEffect, useState } from 'react';
import { Building2, User, Plug, KeyRound } from 'lucide-react';
import type { ConfigOverview } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const STATUS_CLS: Record<string, string> = {
  connected: 'bg-good/15 text-good',
  disconnected: 'bg-surface-2 text-muted',
  error: 'bg-bad/15 text-bad',
};

export default function ConfigPage() {
  const { token, ready, user } = useAuth();
  const [data, setData] = useState<ConfigOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<ConfigOverview>('/config', token).then(setData).catch((e) => setError(e.message));
  }, [ready, token]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">Organização, seu perfil e o estado das integrações.</p>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Organização */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Building2 size={16} className="text-brand" /> Organização
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="Nome" value={data?.org.name ?? '…'} />
            <Row label="Slug" value={data?.org.slug ?? '…'} />
            <Row label="App" value={data?.appName ?? '…'} />
            <Row label="Usuários" value={data ? String(data.counts.users) : '…'} />
            <Row label="Perfis" value={data ? String(data.counts.roles) : '…'} />
          </dl>
        </section>

        {/* Meu perfil */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <User size={16} className="text-brand" /> Meu perfil
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="Nome" value={user?.name ?? '…'} />
            <Row label="E-mail" value={user?.email ?? '…'} />
            <Row label="Perfis" value={user?.roles.join(', ') ?? '…'} />
          </dl>
          <ChangePassword token={token} />
        </section>
      </div>

      {/* Integrações */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plug size={16} className="text-brand" /> Integrações
        </div>
        {data && data.integrations.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhuma integração conectada ainda. Os conectores (ClickUp/Asana, Instagram, Gmail, Drive…)
            entram nas próximas fases.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data?.integrations.map((i) => (
              <li key={i.key} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium">{i.label}</span>
                <span className="flex items-center gap-2">
                  {i.health && <span className="text-[11px] text-muted">saúde: {i.health}</span>}
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLS[i.status] ?? ''}`}>
                    {i.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function ChangePassword({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    apiPost('/config/password', { currentPassword: current, newPassword: next }, token)
      .then(() => {
        setMsg({ ok: true, text: 'Senha alterada.' });
        setCurrent('');
        setNext('');
        setOpen(false);
      })
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
        >
          <KeyRound size={14} /> Trocar senha
        </button>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Senha atual"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim"
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="Nova senha (mín. 8)"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || current.length < 1 || next.length < 8}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={() => { setOpen(false); setMsg(null); }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</p>}
    </div>
  );
}
