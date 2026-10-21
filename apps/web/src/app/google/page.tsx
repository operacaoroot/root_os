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
          <p className="text-sm text-muted">Uma conexão OAuth do root para os quatro serviços.</p>
          <a href="/conexoes" className="mt-1 inline-block text-xs text-brand underline">Configurar em Conexões</a>
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
              <button onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
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

/*
 * O SUCESSO FALSO QUE ESTA TELA MOSTRAVA — fatia 3.3.
 *
 * As quatro escritas do Google passaram a ir pela porta, e a porta as classifica
 * como R3: elas NÃO saem no clique. A rota responde 200 com
 * `{status:'aguardando_aprovacao', approvalId, ...}` — a ação foi aceita e está
 * retida, que é o comportamento correto e não um erro.
 *
 * Só que os três tratadores abaixo tratavam qualquer 200 como envio feito e
 * escreviam "✅ E-mail enviado", "✅ Evento criado", "✅ Doc criado". A pessoa
 * fechava a tela achando que o e-mail tinha saído, e ele estava numa fila
 * esperando outra pessoa. É a pior das duas mentiras possíveis aqui: a outra
 * (uma caixa vermelha) ao menos faria alguém investigar.
 *
 * E o "outra pessoa" é literal: quem propôs não pode aprovar (invariante 7 da
 * escada), e neste caminho o proponente é quem clicou. Por isso a frase diz isso
 * com todas as letras, e não só "está na fila".
 */
interface RespostaDeEscrita {
  status?: string;
  approvalId?: string;
  mensagem?: string;
  fila?: string;
  precisaDeOutraPessoa?: boolean;
}

/** A ação foi retida para aprovação? */
const foiRetida = (r: RespostaDeEscrita): boolean => r?.status === 'aguardando_aprovacao';

/**
 * O aviso de retenção. Usa a frase que a API mandou — ela é a que sabe o nível e
 * a regra — e só acrescenta o endereço da fila quando a API o informou.
 */
function avisoDeFila(r: RespostaDeEscrita): string {
  const base =
    r.mensagem ??
    'A ação foi para a fila de aprovações e precisa da confirmação de outra pessoa. Nada foi enviado.';
  const onde = r.fila ? ` Fila: ${r.fila}.` : '';
  return `⏳ ${base}${onde}${r.approvalId ? ` (aprovação ${r.approvalId})` : ''}`;
}

function GoogleWrite() {
  const { token, can } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [fila, setFila] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canMail = can('gmail.responder'), canCal = can('agenda.editar'), canDoc = can('drive.editar');
  if (!canMail && !canCal && !canDoc) return null;

  const [em, setEm] = useState({ to: '', subject: '', body: '' });
  const [ev, setEv] = useState({ title: '', start: '', end: '' });
  const [dc, setDc] = useState({ title: '', content: '' });
  const flash = (m: string) => { setMsg(m); setFila(null); setErr(null); setTimeout(() => setMsg(null), 6000); };
  /*
   * O aviso de fila NÃO some sozinho, ao contrário do de sucesso: ele é uma
   * pendência, não uma confirmação, e quem precisa lê o número da aprovação
   * para procurá-la.
   */
  const naFila = (r: RespostaDeEscrita) => { setFila(avisoDeFila(r)); setMsg(null); setErr(null); };

  const sendEmail = () => {
    if (!em.to || !em.subject || !em.body) { setErr('Preencha destinatário, assunto e mensagem.'); return; }
    if (!confirm(`Enviar e-mail para ${em.to}?`)) return;
    apiPost<RespostaDeEscrita & { id?: string }>('/google/gmail/send', em, token)
      .then((r) => {
        setEm({ to: '', subject: '', body: '' });
        if (foiRetida(r)) return naFila(r);
        flash(`✅ E-mail enviado (id ${r.id}).`);
      })
      .catch((e) => setErr(e.message));
  };
  const createEvent = () => {
    if (!ev.title || !ev.start || !ev.end) { setErr('Preencha título, início e fim.'); return; }
    if (!confirm(`Criar evento "${ev.title}"?`)) return;
    apiPost<RespostaDeEscrita & { link?: string }>('/google/calendar/event', { title: ev.title, start: new Date(ev.start).toISOString(), end: new Date(ev.end).toISOString() }, token)
      .then((r) => {
        setEv({ title: '', start: '', end: '' });
        if (foiRetida(r)) return naFila(r);
        flash(`✅ Evento criado. ${r.link}`);
      })
      .catch((e) => setErr(e.message));
  };
  const createDoc = () => {
    if (!dc.title) { setErr('Informe o título do documento.'); return; }
    if (!confirm(`Criar documento "${dc.title}"?`)) return;
    apiPost<RespostaDeEscrita & { link?: string }>('/google/docs', { title: dc.title, content: dc.content || undefined }, token)
      .then((r) => {
        setDc({ title: '', content: '' });
        if (foiRetida(r)) return naFila(r);
        flash(`✅ Doc criado: ${r.link}`);
      })
      .catch((e) => setErr(e.message));
  };

  return (
    <div className="space-y-4">
      <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">Ações · escrita com aprovação</h2>
      <p className="text-[11px] text-muted">
        Estas três ações são R3: elas não saem no clique. Vão para a fila de aprovações e só
        acontecem depois que <strong>outra pessoa</strong> com alçada confirmar — quem propõe não
        pode aprovar. Tudo fica registrado no rastro.
      </p>
      {msg && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{msg}</div>}
      {fila && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
          <span>{fila}</span>
          <a href="/atendimento" className="underline underline-offset-2 hover:opacity-80">Ir para a fila</a>
        </div>
      )}
      {err && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{err}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {canMail && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Mail size={16} className="text-brand" /> Enviar e-mail</div>
            <input className={gi} placeholder="Para (email)" value={em.to} onChange={(e) => setEm({ ...em, to: e.target.value })} />
            <input className={gi} placeholder="Assunto" value={em.subject} onChange={(e) => setEm({ ...em, subject: e.target.value })} />
            <textarea className={`${gi} min-h-[80px]`} placeholder="Mensagem" value={em.body} onChange={(e) => setEm({ ...em, body: e.target.value })} />
            <button onClick={sendEmail} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Enviar</button>
          </div>
        )}
        {canCal && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Calendar size={16} className="text-brand" /> Criar evento</div>
            <input className={gi} placeholder="Título" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
            <label className="block text-[11px] text-muted">Início<input type="datetime-local" className={gi} value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} /></label>
            <label className="block text-[11px] text-muted">Fim<input type="datetime-local" className={gi} value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} /></label>
            <button onClick={createEvent} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Criar evento</button>
          </div>
        )}
        {canDoc && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><HardDrive size={16} className="text-brand" /> Novo documento</div>
            <input className={gi} placeholder="Título do Doc" value={dc.title} onChange={(e) => setDc({ ...dc, title: e.target.value })} />
            <textarea className={`${gi} min-h-[80px]`} placeholder="Conteúdo (opcional)" value={dc.content} onChange={(e) => setDc({ ...dc, content: e.target.value })} />
            <button onClick={createDoc} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Criar Doc</button>
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
