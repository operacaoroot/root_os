'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import type { GoalPanel } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const FAROL: Record<string, string> = {
  verde: 'bg-good/15 text-good border-good/30',
  amarelo: 'bg-warn/15 text-warn border-warn/30',
  vermelho: 'bg-bad/15 text-bad border-bad/30',
  off: 'bg-surface-2 text-muted border-border',
  na: 'bg-surface-2 text-muted border-border',
};
const FAROL_LABEL: Record<string, string> = { verde: 'verde', amarelo: 'amarelo', vermelho: 'vermelho', off: 'baseline', na: 'não ativado' };

const nf = (n: number) => n.toLocaleString('pt-BR');
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n));

export default function MetasPage() {
  const { token, ready, can } = useAuth();
  const [p, setP] = useState<GoalPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const editable = can('relatorios.gerar');

  const load = () => token && apiGet<GoalPanel>('/goals/panel', token).then(setP).catch((e) => setError(e.message));
  useEffect(() => { if (ready && token) load(); /* eslint-disable-next-line */ }, [ready, token]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Metas · Desafio 1.000 posts</h1>
          <p className="text-sm text-muted">20M views · 1.000 vendas (produto perpétuo R$300) · {p?.faseLabel ?? '…'}</p>
        </div>
        {editable && (
          <button onClick={() => setForm((v) => !v)} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            <Plus size={15} /> Registrar semana
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">Erro ao carregar o painel: {error}</div>}
      {form && token && <WeekForm token={token} onSaved={() => { setForm(false); load(); }} suggested={(p?.semanasRegistradas ?? 0) + 1} />}

      {!p && !error && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          Carregando painel de metas…
        </div>
      )}

      {/* Marcos + dia */}
      {p && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {p.marcos.map((m) => (
              <div key={m.key} className="rounded-xl border border-border bg-surface p-4">
                <div className="text-xs uppercase tracking-wide text-muted">{m.label}</div>
                <div className="mt-1 text-2xl font-semibold">{compact(m.atual)}{m.meta > 0 && <span className="text-sm text-muted"> /{compact(m.meta)}</span>}</div>
                {m.meta > 0 ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
                    <div className="h-full rounded bg-brand" style={{ width: `${Math.min(100, m.pct)}%` }} />
                  </div>
                ) : <div className="mt-1 text-[11px] text-muted">{m.hint}</div>}
              </div>
            ))}
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Dia do desafio</div>
              <div className="mt-1 text-2xl font-semibold">{p.diaDesafio}<span className="text-sm text-muted"> /365</span></div>
              <div className="mt-1 text-[11px] text-muted">{p.semanasRegistradas} semana(s) · janela {p.janela.semanas}</div>
            </div>
          </div>

          {/* Evolução semanal */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Evolução semanal (posts × views/post)</div>
            {p.semanas.length === 0 ? <p className="text-sm text-muted">Nenhuma semana registrada ainda.</p> : (
              <div className="flex h-36 items-end gap-1.5">
                {(() => { const maxVpp = Math.max(1, ...p.semanas.map((s) => s.viewsPerPost)); return p.semanas.map((s) => (
                  <div key={s.weekNumber} className="flex flex-1 flex-col items-center gap-1" title={`S${s.weekNumber}: ${s.posts} posts · ${nf(s.viewsPerPost)} views/post`}>
                    <div className="flex w-full items-end justify-center" style={{ height: '100%' }}>
                      <div className={`w-full rounded-t ${s.status === 'meta' ? 'bg-good/50' : s.status === 'abaixo' ? 'bg-warn/50' : 'bg-bad/50'}`}
                        style={{ height: `${Math.max(4, Math.round((s.viewsPerPost / maxVpp) * 100))}%` }} />
                    </div>
                    <span className="text-[9px] text-muted">S{s.weekNumber}</span>
                  </div>
                )); })()}
              </div>
            )}
            <div className="mt-2 flex gap-3 text-[10px] text-muted">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-good/50" /> na meta (≥35)</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-warn/50" /> abaixo (25–34)</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-bad/50" /> recalibrar (&lt;25)</span>
            </div>
          </div>

          {/* Cadeia de conversão */}
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted">Cadeia de conversão {p.farolLigado ? '· farol ligado' : '· farol OFF até a fase 2'}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {p.taxas.map((t) => (
                <div key={t.id} className={`rounded-xl border p-4 ${FAROL[t.farol]}`} title={t.descricao}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-text">{t.label}</span>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] capitalize">{t.ativa ? FAROL_LABEL[t.farol] : 'não ativado'}</span>
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-text">
                    {t.valor == null ? '—' : t.unidade === '%' ? `${t.valor}%` : t.valor}
                  </div>
                  <div className="text-[11px] text-muted">
                    {t.id === 'alcance'
                      ? `média views/post · escada ${nf(t.refEscada ?? 0)}`
                      : `${t.formula.split('÷')[0].trim()} · ${nf(t.absoluto)} em 4 sem`}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {t.unidade === 'escada' ? `alvo da faixa: ${nf(p.escada.metaMediaPost)}` : `piso ${t.piso} · meta ${t.meta}${t.unidade === '%' ? '%' : ''}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Escada + Projeções */}
          <div className="grid gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Escada (faixa atual)</div>
              <div className="mt-1 text-sm">Posts {p.escada.faixaDe}–{p.escada.faixaAte}</div>
              <div className="mt-1 text-lg font-semibold">{nf(p.escada.mediaAtual)}<span className="text-xs text-muted"> / {nf(p.escada.metaMediaPost)} views/post</span></div>
            </div>
            <Proj label="Views no dia 365" value={compact(p.projecoes.viewsDia365)} hint={`${p.projecoes.pctMetaViews}% da meta de 20M`} />
            <Proj label="Post nº 1.000" value={p.projecoes.diaPost1000 ? `dia ${p.projecoes.diaPost1000}` : '—'} hint="alvo: dia ~200" />
            <Proj label="Vendas projetadas" value={`${nf(p.projecoes.vendasMin)}–${nf(p.projecoes.vendasMax)}`} hint="pessimista 50/M · mediano 110/M" />
          </div>
          <p className="text-[11px] text-muted">
            Taxas na janela móvel de 4 semanas · valores provisórios até a calibragem pós-baseline · projeção = views × [50,110]/M (faixa, nunca número único).
          </p>
        </>
      )}
    </div>
  );
}

function Proj({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

const FIELDS: Array<[keyof WeekState, string, boolean]> = [
  ['posts', 'Posts', false], ['views', 'Views', true], ['shares', 'Compart.', false], ['saves', 'Salvam.', true],
  ['comments', 'Comentários', true], ['profileVisits', 'Visitas perfil', true], ['newFollowers', 'Seg. novos', true],
  ['totalFollowers', 'Seg. total', true], ['nonFollowerPct', '% não-seg.', false], ['storyViewers', 'Views story', false],
  ['storyReplies', 'Respostas story', false], ['listEntries', 'Entradas lista', false], ['bioClicks', 'Cliques bio', false],
  ['lives', 'Lives', false], ['storyDays', 'Dias c/ story', false],
];
type WeekState = Record<string, number>;

function WeekForm({ token, onSaved, suggested }: { token: string; onSaved: () => void; suggested: number }) {
  const [week, setWeek] = useState(suggested);
  const [v, setV] = useState<WeekState>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: Number(val) || 0 }));

  const save = () => {
    setBusy(true); setErr(null);
    apiPost('/goals/week', { weekNumber: week, ...v }, token).then(onSaved).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  const syncMeta = () => {
    setBusy(true); setErr(null);
    apiPost(`/goals/week/${week}/sync-meta`, {}, token).then(onSaved).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium">Registrar dados da semana</span>
        <input type="number" value={week} onChange={(e) => setWeek(Number(e.target.value) || 1)}
          className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm" />
        <button onClick={syncMeta} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-brand hover:bg-surface-2">
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Puxar do Instagram
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-[11px] text-muted">
            {label}
            <input type="number" value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder="0"
              className="mt-0.5 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-brand-dim" />
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          {busy ? 'Salvando…' : 'Salvar semana'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Dica: "Puxar do Instagram" preenche views/seguidores/comentários/salvamentos/posts dos últimos 7 dias; o resto (shares, stories, lista, bio) é manual.</p>
    </div>
  );
}
