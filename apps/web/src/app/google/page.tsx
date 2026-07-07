'use client';

import { useEffect, useState } from 'react';
import { Calendar, Mail, HardDrive, Plug, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface GStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  scopes: string[];
  connectedAt: string | null;
}
interface CalEvent { id: string; title: string; start: string | null; location: string | null; link: string | null }
interface Mailv { id: string; from: string | null; subject: string | null; date: string | null; snippet: string; unread: boolean }
interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; link: string | null }

export default function GooglePage() {
  const { token, ready, can } = useAuth();
  const [st, setSt] = useState<GStatus | null>(null);
  const [cal, setCal] = useState<CalEvent[] | null>(null);
  const [mail, setMail] = useState<Mailv[] | null>(null);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<GStatus>('/google/status', token).then((s) => {
      setSt(s);
      if (s.connected) {
        apiGet<CalEvent[]>('/google/calendar?max=6', token).then(setCal).catch(() => {});
        if (can('gmail.ver')) apiGet<Mailv[]>('/google/gmail?max=6', token).then(setMail).catch(() => {});
        if (can('drive.ver')) apiGet<DriveFile[]>('/google/drive?max=8', token).then(setFiles).catch(() => {});
      }
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const connect = () => apiGet<{ url: string }>('/google/connect', token).then((r) => { window.location.href = r.url; }).catch((e) => setError(e.message));
  const disconnect = () => apiPost('/google/disconnect', {}, token).then(() => location.reload()).catch((e) => setError(e.message));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Google · Agenda · Gmail · Docs · Drive</h1>
          <p className="text-sm text-muted">Uma conexão OAuth do root para os quatro serviços.</p>
        </div>
        {st?.connected && can('admin.usuarios') && (
          <button onClick={disconnect} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
            Desconectar
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}

      {/* conexão */}
      <div className="rounded-xl border border-border bg-surface p-5">
        {!st ? (
          <span className="text-sm text-muted">Carregando…</span>
        ) : !st.configured ? (
          <div className="text-sm text-muted">
            <span className="font-medium text-warn">Credencial do Google não configurada.</span> Coloque
            <code className="mx-1">GOOGLE_CLIENT_ID/SECRET</code> em <code>~/.config/root/google.env</code> e reinicie a API.
          </div>
        ) : st.connected ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 size={16} className="text-good" />
            Conectado como <span className="font-medium">{st.email}</span>
            <span className="text-muted">· {st.scopes.length} escopos</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Ainda não conectado.</span>
            {can('admin.usuarios') ? (
              <button onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                <Plug size={15} /> Conectar Google
              </button>
            ) : <span className="text-xs text-muted">Só admin conecta.</span>}
          </div>
        )}
      </div>

      {st?.connected && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card icon={<Calendar size={16} className="text-brand" />} title="Próximos na agenda">
            {cal?.map((e) => (
              <li key={e.id} className="py-1.5">
                <div className="text-sm">{e.title}</div>
                <div className="text-[11px] text-muted">{e.start ? new Date(e.start).toLocaleString('pt-BR') : ''}{e.location ? ` · ${e.location}` : ''}</div>
              </li>
            ))}
            {cal && cal.length === 0 && <Empty />}
          </Card>

          <Card icon={<Mail size={16} className="text-brand" />} title="E-mails recentes">
            {!can('gmail.ver') ? <li className="py-2 text-xs text-muted">Sem permissão de Gmail.</li> : mail?.map((m) => (
              <li key={m.id} className="py-1.5">
                <div className="flex items-center gap-1 text-sm">{m.unread && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}<span className="truncate">{m.subject ?? '(sem assunto)'}</span></div>
                <div className="truncate text-[11px] text-muted">{m.from}</div>
              </li>
            ))}
            {can('gmail.ver') && mail && mail.length === 0 && <Empty />}
          </Card>

          <Card icon={<HardDrive size={16} className="text-brand" />} title="Drive — recentes">
            {!can('drive.ver') ? <li className="py-2 text-xs text-muted">Sem permissão de Drive.</li> : files?.map((f) => (
              <li key={f.id} className="py-1.5">
                <a href={f.link ?? '#'} target="_blank" rel="noreferrer" className="text-sm hover:text-brand">{f.name}</a>
                <div className="text-[11px] text-muted">{new Date(f.modifiedTime).toLocaleDateString('pt-BR')}</div>
              </li>
            ))}
            {can('drive.ver') && files && files.length === 0 && <Empty />}
          </Card>
        </div>
      )}

      {st?.connected && <GoogleWrite />}
    </div>
  );
}

const gi = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
function GoogleWrite() {
  const { token, can } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canMail = can('gmail.responder'), canCal = can('agenda.editar'), canDoc = can('drive.editar');
  if (!canMail && !canCal && !canDoc) return null;

  const [em, setEm] = useState({ to: '', subject: '', body: '' });
  const [ev, setEv] = useState({ title: '', start: '', end: '' });
  const [dc, setDc] = useState({ title: '', content: '' });
  const flash = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 6000); };

  const sendEmail = () => {
    if (!em.to || !em.subject || !em.body) { setErr('Preencha destinatário, assunto e mensagem.'); return; }
    if (!confirm(`Enviar e-mail para ${em.to}?`)) return;
    apiPost<{ id: string }>('/google/gmail/send', em, token)
      .then((r) => { flash(`✅ E-mail enviado (id ${r.id}).`); setEm({ to: '', subject: '', body: '' }); })
      .catch((e) => setErr(e.message));
  };
  const createEvent = () => {
    if (!ev.title || !ev.start || !ev.end) { setErr('Preencha título, início e fim.'); return; }
    if (!confirm(`Criar evento "${ev.title}"?`)) return;
    apiPost<{ link: string }>('/google/calendar/event', { title: ev.title, start: new Date(ev.start).toISOString(), end: new Date(ev.end).toISOString() }, token)
      .then((r) => { flash(`✅ Evento criado. ${r.link}`); setEv({ title: '', start: '', end: '' }); })
      .catch((e) => setErr(e.message));
  };
  const createDoc = () => {
    if (!dc.title) { setErr('Informe o título do documento.'); return; }
    if (!confirm(`Criar documento "${dc.title}"?`)) return;
    apiPost<{ link: string }>('/google/docs', { title: dc.title, content: dc.content || undefined }, token)
      .then((r) => { flash(`✅ Doc criado: ${r.link}`); setDc({ title: '', content: '' }); })
      .catch((e) => setErr(e.message));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Ações · escrita com aprovação</h2>
      <p className="text-[11px] text-muted">Cada ação exige permissão específica, pede confirmação e fica registrada na auditoria.</p>
      {msg && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{msg}</div>}
      {err && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{err}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {canMail && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Mail size={16} className="text-brand" /> Enviar e-mail</div>
            <input className={gi} placeholder="Para (email)" value={em.to} onChange={(e) => setEm({ ...em, to: e.target.value })} />
            <input className={gi} placeholder="Assunto" value={em.subject} onChange={(e) => setEm({ ...em, subject: e.target.value })} />
            <textarea className={`${gi} min-h-[80px]`} placeholder="Mensagem" value={em.body} onChange={(e) => setEm({ ...em, body: e.target.value })} />
            <button onClick={sendEmail} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">Enviar</button>
          </div>
        )}
        {canCal && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Calendar size={16} className="text-brand" /> Criar evento</div>
            <input className={gi} placeholder="Título" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
            <label className="block text-[11px] text-muted">Início<input type="datetime-local" className={gi} value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} /></label>
            <label className="block text-[11px] text-muted">Fim<input type="datetime-local" className={gi} value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} /></label>
            <button onClick={createEvent} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">Criar evento</button>
          </div>
        )}
        {canDoc && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><HardDrive size={16} className="text-brand" /> Novo documento</div>
            <input className={gi} placeholder="Título do Doc" value={dc.title} onChange={(e) => setDc({ ...dc, title: e.target.value })} />
            <textarea className={`${gi} min-h-[80px]`} placeholder="Conteúdo (opcional)" value={dc.content} onChange={(e) => setDc({ ...dc, content: e.target.value })} />
            <button onClick={createDoc} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">Criar Doc</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">{icon} {title}</div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}
function Empty() { return <li className="py-2 text-xs text-muted">Nada por aqui.</li>; }
