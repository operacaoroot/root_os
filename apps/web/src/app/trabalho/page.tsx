'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ExternalLink, Flag, MessageSquare, Plus, Settings2, X } from 'lucide-react';
import type {
  TrabEstrutura, TrabListaDto, TrabTarefaLista, TrabTarefaResumo, TrabTarefaDetalhe,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Trabalho — gestão de tarefas estilo ClickUp, nativa do mkt-os.
// Réplica de usabilidade do espaço `root` (fotografia 25/07/2026): pastas →
// listas → board por status; campos personalizados; etiquetas; comentários.
// Tudo que aparece no painel da tarefa é editável.

const PRIORIDADES = [
  { key: 'urgente', cor: '#f50000' },
  { key: 'alta', cor: '#ffcc00' },
  { key: 'normal', cor: '#6fddff' },
  { key: 'baixa', cor: '#87909e' },
] as const;

const INP = 'w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60';

const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const paraInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const deInputDate = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

export default function TrabalhoPage() {
  const { token, ready, can } = useAuth();
  const editable = can('tarefas.editar');
  const [erro, setErro] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [listaId, setListaId] = useState<string | null>(null);
  const [visao, setVisao] = useState<'board' | 'tabela'>('board');
  const [tarefas, setTarefas] = useState<TrabTarefaLista | null>(null);
  const [painelId, setPainelId] = useState<string | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [fAssignee, setFAssignee] = useState('');
  const [fBusca, setFBusca] = useState('');
  const [fOpcao, setFOpcao] = useState('');
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((b) => b + 1), []);

  // estrutura (árvore, statuses, campos, tags, responsáveis)
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => {
        setEstrutura(e);
        if (!listaId) {
          const todas = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas];
          const preferida = todas.find((l) => l.externalId === '901327640001') ?? todas[0];
          if (preferida) setListaId(preferida.id);
        }
      })
      .catch((e) => setErro(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, bump]);

  const lista: TrabListaDto | null = useMemo(() => {
    if (!estrutura || !listaId) return null;
    return [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas].find((l) => l.id === listaId) ?? null;
  }, [estrutura, listaId]);

  // tarefas da lista selecionada
  useEffect(() => {
    if (!ready || !token || !listaId) return;
    const p = new URLSearchParams({ listId: listaId });
    if (fAssignee) p.set('assignee', fAssignee);
    if (fBusca) p.set('q', fBusca);
    if (fOpcao) p.set('opcao', fOpcao);
    apiGet<TrabTarefaLista>(`/trabalho/tarefas?${p}`, token)
      .then(setTarefas)
      .catch((e) => setErro(e.message));
  }, [ready, token, listaId, fAssignee, fBusca, fOpcao, bump]);

  const camposDaLista = useMemo(
    () => [...(lista?.fields ?? []), ...(estrutura?.camposGlobais ?? [])],
    [lista, estrutura],
  );

  return (
    <div className="flex h-full gap-4">
      {/* árvore: pastas → listas */}
      <aside className="w-52 shrink-0 space-y-3 overflow-y-auto pr-1">
        {estrutura?.folders.map((f) => (
          <div key={f.id}>
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{f.name}</div>
            <div className="mt-1 space-y-0.5">
              {f.lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => { setListaId(l.id); setFOpcao(''); }}
                  className={[
                    'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] transition',
                    l.id === listaId ? 'bg-brand/15 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                  ].join(' ')}
                >
                  <span className="truncate">{l.name}</span>
                  <span className="ml-1 text-[10px] text-muted">{l.total}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {editable && estrutura && <NovaLista folders={estrutura.folders} token={token} onDone={refresh} onErro={setErro} />}
      </aside>

      {/* miolo */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{lista?.name ?? 'Trabalho'}</h1>
            <p className="text-sm text-muted">
              {tarefas ? `${tarefas.total} tarefa(s)` : 'Carregando…'} · gestão nativa (fotografia do ClickUp)
              {lista?.externalId && <span className="ml-1 text-[11px]">· lista ClickUp {lista.externalId}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={fBusca}
              onChange={(e) => setFBusca(e.target.value)}
              placeholder="Buscar…"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
            <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Todos os responsáveis</option>
              {estrutura?.responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {camposDaLista.filter((c) => c.type === 'drop_down' && c.options.length > 0).map((c) => (
              <select
                key={c.id}
                value={c.options.some((o) => o.id === fOpcao) ? fOpcao : ''}
                onChange={(e) => setFOpcao(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
              >
                <option value="">{c.name}: todos</option>
                {c.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ))}
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(['board', 'tabela'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVisao(v)}
                  className={`px-3 py-1.5 text-sm capitalize ${visao === v ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            {editable && lista && (
              <button
                onClick={() => setConfigAberta(true)}
                title="Configurar lista (statuses e campos)"
                className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-text"
              >
                <Settings2 size={15} />
              </button>
            )}
          </div>
        </div>

        {erro && (
          <div className="flex items-center justify-between rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            <span>{erro}</span>
            <button onClick={() => setErro(null)}><X size={14} /></button>
          </div>
        )}

        {lista && tarefas && visao === 'board' && (
          <Board
            lista={lista} tarefas={tarefas.items} editable={editable} token={token}
            onAbrir={setPainelId} onMudou={refresh} onErro={setErro}
          />
        )}
        {lista && tarefas && visao === 'tabela' && (
          <Tabela lista={lista} tarefas={tarefas.items} campos={camposDaLista.map((c) => c.name)} onAbrir={setPainelId} />
        )}
      </div>

      {painelId && estrutura && (
        <PainelTarefa
          id={painelId} estrutura={estrutura} editable={editable} token={token}
          onFechar={() => setPainelId(null)} onMudou={refresh} onErro={setErro}
        />
      )}
      {configAberta && lista && (
        <ConfigLista lista={lista} token={token} onFechar={() => { setConfigAberta(false); refresh(); }} onErro={setErro} />
      )}
    </div>
  );
}

// ---------- board por status (colunas coloridas, quick-add por coluna) ----------

function Board({ lista, tarefas, editable, token, onAbrir, onMudou, onErro }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; editable: boolean; token: string | null;
  onAbrir: (id: string) => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {lista.statuses.map((st) => {
        const itens = tarefas.filter((t) => t.statusId === st.id);
        return (
          <div key={st.id} className="w-72 shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium capitalize">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                {st.name}
              </span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{itens.length}</span>
            </div>
            <div className="space-y-2">
              {itens.map((t) => (
                <Cartao key={t.id} t={t} lista={lista} editable={editable} token={token} onAbrir={onAbrir} onMudou={onMudou} onErro={onErro} />
              ))}
              {editable && <QuickAdd listaId={lista.id} statusId={st.id} token={token} onDone={onMudou} onErro={onErro} />}
              {itens.length === 0 && !editable && <p className="px-1 text-xs text-muted">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Cartao({ t, lista, editable, token, onAbrir, onMudou, onErro }: {
  t: TrabTarefaResumo; lista: TrabListaDto; editable: boolean; token: string | null;
  onAbrir: (id: string) => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  const pr = PRIORIDADES.find((p) => p.key === t.priority);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onAbrir(t.id)} className="text-left text-sm hover:text-brand">{t.title}</button>
        {t.externalUrl && (
          <a href={t.externalUrl} target="_blank" rel="noreferrer" title="Abrir no ClickUp" className="shrink-0 text-muted hover:text-brand">
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {t.values.filter((v) => v.optionName).map((v) => (
          <span key={v.fieldId} title={v.fieldName} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${v.optionColor}26`, color: v.optionColor ?? undefined }}>
            {v.optionName}
          </span>
        ))}
        {t.tags.map((tg) => (
          <span key={tg.id} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${tg.color}26`, color: tg.color }}>
            {tg.name}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
        {t.priority !== 'normal' && pr && <Flag size={11} style={{ color: pr.cor }} />}
        {t.assignee && <span>{t.assignee}</span>}
        {t.dueDate && <span className={t.overdue ? 'text-bad' : ''}>{dataBR(t.dueDate)}</span>}
        {t.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={10} />{t.comments}</span>}
        {t.subtasks > 0 && <span>{t.subtasks} sub</span>}
      </div>
      {editable && (
        <select
          value={t.statusId}
          onChange={(e) =>
            apiPatch(`/trabalho/tarefas/${t.id}`, { statusId: e.target.value }, token).then(onMudou).catch((er) => onErro(er.message))
          }
          title="Mover etapa"
          className="mt-2 w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] outline-none focus:border-brand-dim"
        >
          {lista.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}

function QuickAdd({ listaId, statusId, token, onDone, onErro }: {
  listaId: string; statusId: string; token: string | null; onDone: () => void; onErro: (m: string) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const enviar = () => {
    if (!titulo.trim()) return;
    apiPost('/trabalho/tarefas', { listId: listaId, statusId, title: titulo.trim() }, token)
      .then(() => { setTitulo(''); onDone(); })
      .catch((e) => onErro(e.message));
  };
  return (
    <div className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5">
      <Plus size={12} className="shrink-0 text-muted" />
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && enviar()}
        placeholder="Nova tarefa…"
        className="w-full bg-transparent text-xs outline-none placeholder:text-muted"
      />
    </div>
  );
}

// ---------- visão tabela ----------

function Tabela({ lista, tarefas, campos, onAbrir }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; campos: string[]; onAbrir: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Tarefa</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Prioridade</th>
            <th className="px-3 py-2">Responsável</th>
            <th className="px-3 py-2">Prazo</th>
            {campos.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {tarefas.map((t) => (
            <tr key={t.id} onClick={() => onAbrir(t.id)} className="cursor-pointer border-b border-border/50 hover:bg-surface-2/50">
              <td className="px-3 py-2">{t.title}</td>
              <td className="px-3 py-2">
                <span className="rounded px-1.5 py-0.5 text-[11px] capitalize" style={{ background: `${t.statusColor}26`, color: t.statusColor }}>
                  {t.statusName}
                </span>
              </td>
              <td className="px-3 py-2 capitalize">{t.priority}</td>
              <td className="px-3 py-2">{t.assignee ?? '—'}</td>
              <td className={`px-3 py-2 ${t.overdue ? 'text-bad' : ''}`}>{dataBR(t.dueDate)}</td>
              {campos.map((c) => {
                const v = t.values.find((x) => x.fieldName === c);
                return <td key={c} className="px-3 py-2 text-muted">{v?.optionName ?? v?.value ?? '—'}</td>;
              })}
            </tr>
          ))}
          {tarefas.length === 0 && (
            <tr><td colSpan={5 + campos.length} className="px-3 py-6 text-center text-muted">Nada por aqui.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- painel da tarefa (drawer): TODO campo editável ----------

function PainelTarefa({ id, estrutura, editable, token, onFechar, onMudou, onErro }: {
  id: string; estrutura: TrabEstrutura; editable: boolean; token: string | null;
  onFechar: () => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  const [t, setT] = useState<TrabTarefaDetalhe | null>(null);
  const [comentario, setComentario] = useState('');
  const [novaTag, setNovaTag] = useState('');
  const recarregar = useCallback(() => {
    apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${id}`, token).then(setT).catch((e) => onErro(e.message));
  }, [id, token, onErro]);
  useEffect(recarregar, [recarregar]);

  const todasListas = useMemo(
    () => [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas],
    [estrutura],
  );
  const lista = todasListas.find((l) => l.id === t?.listId);
  const campos = [...(lista?.fields ?? []), ...estrutura.camposGlobais];

  const salvar = (mudanca: Record<string, unknown>) =>
    apiPatch(`/trabalho/tarefas/${id}`, mudanca, token)
      .then(() => { recarregar(); onMudou(); })
      .catch((e) => onErro(e.message));

  const comentar = () => {
    if (!comentario.trim()) return;
    apiPost(`/trabalho/tarefas/${id}/comentarios`, { text: comentario.trim() }, token)
      .then(() => { setComentario(''); recarregar(); })
      .catch((e) => onErro(e.message));
  };

  const criarEAnexarTag = () => {
    if (!novaTag.trim() || !t) return;
    const existente = estrutura.tags.find((x) => x.name.toLowerCase() === novaTag.trim().toLowerCase());
    const anexar = (tagId: string) => salvar({ tagIds: [...t.tags.map((x) => x.id), tagId] }).then(() => setNovaTag(''));
    if (existente) void anexar(existente.id);
    else {
      apiPost<{ id: string }>('/trabalho/tags', { name: novaTag.trim() }, token)
        .then((tag) => anexar(tag.id))
        .catch((e) => onErro(e.message));
    }
  };

  if (!t) return null;
  const ro = !editable;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[420px] max-w-full flex-col border-l border-border bg-surface shadow-2xl">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <input
          defaultValue={t.title}
          disabled={ro}
          onBlur={(e) => e.target.value !== t.title && salvar({ title: e.target.value })}
          className="w-full bg-transparent text-sm font-semibold outline-none focus:text-brand"
        />
        <div className="flex shrink-0 items-center gap-1">
          {editable && (
            <button title="Arquivar" onClick={() => { void apiDelete(`/trabalho/tarefas/${t.id}`, token).then(() => { onMudou(); onFechar(); }); }} className="p-1 text-muted hover:text-bad">
              <Archive size={15} />
            </button>
          )}
          <button onClick={onFechar} className="p-1 text-muted hover:text-text"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        {/* linha de propriedades — tudo editável */}
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Lista">
            <select disabled={ro} value={t.listId} onChange={(e) => salvar({ listId: e.target.value })} className={INP}>
              {todasListas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Status">
            <select disabled={ro} value={t.statusId} onChange={(e) => salvar({ statusId: e.target.value })} className={INP}>
              {(lista?.statuses ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prioridade">
            <select disabled={ro} value={t.priority} onChange={(e) => salvar({ priority: e.target.value })} className={`${INP} capitalize`}>
              {PRIORIDADES.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <input
              list="trab-responsaveis" disabled={ro} defaultValue={t.assignee ?? ''}
              onBlur={(e) => (e.target.value || null) !== t.assignee && salvar({ assignee: e.target.value || null })}
              className={INP} placeholder="—"
            />
            <datalist id="trab-responsaveis">
              {estrutura.responsaveis.map((r) => <option key={r} value={r} />)}
            </datalist>
          </Campo>
          <Campo rotulo="Início">
            <input type="date" disabled={ro} defaultValue={paraInputDate(t.startDate)} onBlur={(e) => salvar({ startDate: deInputDate(e.target.value) })} className={INP} />
          </Campo>
          <Campo rotulo="Prazo">
            <input type="date" disabled={ro} defaultValue={paraInputDate(t.dueDate)} onBlur={(e) => salvar({ dueDate: deInputDate(e.target.value) })} className={INP} />
          </Campo>
        </div>

        {/* campos personalizados (as 4 colunas reais da Gestão de Temas + os que criarem) */}
        {campos.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Campos personalizados</div>
            <div className="grid grid-cols-2 gap-2">
              {campos.map((c) => {
                const v = t.values.find((x) => x.fieldId === c.id);
                if (c.type === 'drop_down') {
                  return (
                    <Campo key={c.id} rotulo={c.name}>
                      <select
                        disabled={ro}
                        value={v?.optionId ?? ''}
                        onChange={(e) => salvar({ campos: { [c.id]: { optionId: e.target.value || null } } })}
                        className={INP}
                      >
                        <option value="">—</option>
                        {c.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </Campo>
                  );
                }
                return (
                  <Campo key={c.id} rotulo={c.name}>
                    <input
                      disabled={ro}
                      type={c.type === 'numero' ? 'number' : c.type === 'data' ? 'date' : 'text'}
                      defaultValue={v?.value ?? ''}
                      onBlur={(e) => salvar({ campos: { [c.id]: { value: e.target.value || null } } })}
                      className={INP}
                    />
                  </Campo>
                );
              })}
            </div>
          </div>
        )}

        {/* etiquetas */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Etiquetas</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {t.tags.map((tg) => (
              <span key={tg.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${tg.color}26`, color: tg.color }}>
                {tg.name}
                {editable && (
                  <button onClick={() => salvar({ tagIds: t.tags.filter((x) => x.id !== tg.id).map((x) => x.id) })}>
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            {editable && (
              <input
                value={novaTag}
                onChange={(e) => setNovaTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && criarEAnexarTag()}
                list="trab-tags"
                placeholder="+ etiqueta"
                className="w-24 rounded border border-dashed border-border bg-transparent px-1.5 py-0.5 text-[11px] outline-none"
              />
            )}
            <datalist id="trab-tags">
              {estrutura.tags.map((tg) => <option key={tg.id} value={tg.name} />)}
            </datalist>
          </div>
        </div>

        {/* descrição */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Descrição</div>
          <textarea
            disabled={ro}
            defaultValue={t.description ?? ''}
            onBlur={(e) => (e.target.value || null) !== t.description && salvar({ description: e.target.value || null })}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
            placeholder="—"
          />
        </div>

        {/* subtarefas */}
        {t.filhos.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Subtarefas</div>
            {t.filhos.map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                <span className="h-2 w-2 rounded-full" style={{ background: s.statusColor }} />
                {s.title}
              </div>
            ))}
          </div>
        )}

        {/* comentários (mais novo primeiro, como no ClickUp) */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Comentários ({t.comentarios.length})
          </div>
          {editable && (
            <div className="mb-2 flex gap-1.5">
              <input
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && comentar()}
                placeholder="Escrever comentário…"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
              />
              <button onClick={comentar} className="rounded-lg bg-brand/15 px-3 text-sm text-brand hover:bg-brand/25">Enviar</button>
            </div>
          )}
          <div className="space-y-2">
            {t.comentarios.map((c) => (
              <div key={c.id} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
                <div className="text-[11px] text-muted">
                  {c.authorName} · {new Date(c.createdAt).toLocaleString('pt-BR')}
                </div>
                <div className="whitespace-pre-wrap text-[13px]">{c.text}</div>
              </div>
            ))}
            {t.comentarios.length === 0 && <p className="text-xs text-muted">Sem comentários.</p>}
          </div>
        </div>

        {/* atividade (auditoria) */}
        {t.atividade.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Atividade</div>
            <div className="space-y-1">
              {t.atividade.map((a) => (
                <div key={a.id} className="text-[11px] text-muted">
                  {new Date(a.createdAt).toLocaleString('pt-BR')} · {a.actorName ?? a.actorType} · {a.action}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* identidade (ids) */}
        <div className="rounded-lg border border-border/60 px-2.5 py-2 text-[11px] text-muted">
          <div>id interno: <code>{t.id}</code></div>
          {t.externalId && <div>id ClickUp: <code>{t.externalId}</code></div>}
          {t.externalUrl && (
            <a href={t.externalUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">abrir no ClickUp</a>
          )}
          <div>criada {new Date(t.createdAt).toLocaleString('pt-BR')} · atualizada {new Date(t.updatedAt).toLocaleString('pt-BR')}</div>
        </div>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{rotulo}</span>
      {children}
    </label>
  );
}

// ---------- nova lista (na árvore) ----------

function NovaLista({ folders, token, onDone, onErro }: {
  folders: TrabEstrutura['folders']; token: string | null; onDone: () => void; onErro: (m: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [pasta, setPasta] = useState(folders[0]?.id ?? '');
  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)} className="flex items-center gap-1 px-2 text-[12px] text-muted hover:text-brand">
        <Plus size={12} /> nova lista
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-2">
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da lista" className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none" />
      <select value={pasta} onChange={(e) => setPasta(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none">
        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <div className="flex gap-1">
        <button
          onClick={() =>
            nome.trim() &&
            apiPost('/trabalho/listas', { folderId: pasta || null, name: nome.trim() }, token)
              .then(() => { setNome(''); setAberto(false); onDone(); })
              .catch((e) => onErro(e.message))
          }
          className="rounded bg-brand/15 px-2 py-1 text-xs text-brand"
        >
          Criar
        </button>
        <button onClick={() => setAberto(false)} className="px-2 py-1 text-xs text-muted">Cancelar</button>
      </div>
    </div>
  );
}

// ---------- configurar lista: statuses e campos (CRUD completo) ----------

function ConfigLista({ lista, token, onFechar, onErro }: {
  lista: TrabListaDto; token: string | null; onFechar: () => void; onErro: (m: string) => void;
}) {
  const [statuses, setStatuses] = useState(lista.statuses);
  const [fields, setFields] = useState(lista.fields);
  const [novoStatus, setNovoStatus] = useState('');
  const [novoCampo, setNovoCampo] = useState('');
  const recarregar = () =>
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then((e) => {
      const l = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas].find((x) => x.id === lista.id);
      if (l) { setStatuses(l.statuses); setFields(l.fields); }
    });

  const trata = (p: Promise<unknown>) => p.then(recarregar).catch((e) => onErro(e.message));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">Configurar “{lista.name}”</h2>
          <button onClick={onFechar} className="text-muted hover:text-text"><X size={16} /></button>
        </div>

        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Statuses (pipeline)</div>
        <div className="space-y-1.5">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <input
                type="color" defaultValue={s.color}
                onBlur={(e) => e.target.value !== s.color && trata(apiPatch(`/trabalho/statuses/${s.id}`, { color: e.target.value }, token))}
                className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              />
              <input
                defaultValue={s.name}
                onBlur={(e) => e.target.value !== s.name && trata(apiPatch(`/trabalho/statuses/${s.id}`, { name: e.target.value }, token))}
                className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
              />
              <select
                value={s.type}
                onChange={(e) => trata(apiPatch(`/trabalho/statuses/${s.id}`, { type: e.target.value }, token))}
                className="shrink-0 rounded border border-border bg-surface-2 px-1 py-1 text-[11px] outline-none"
              >
                <option value="open">open</option><option value="custom">custom</option><option value="closed">closed</option>
              </select>
              <span className="shrink-0 text-[10px] text-muted">{s.total}</span>
              <button
                title={s.total > 0 ? 'Mova as tarefas antes' : 'Apagar status'}
                disabled={s.total > 0}
                onClick={() => trata(apiDelete(`/trabalho/statuses/${s.id}`, token))}
                className="shrink-0 p-0.5 text-muted enabled:hover:text-bad disabled:opacity-30"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={novoStatus} onChange={(e) => setNovoStatus(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && novoStatus.trim() && trata(apiPost(`/trabalho/listas/${lista.id}/statuses`, { name: novoStatus.trim(), type: 'custom' }, token).then(() => setNovoStatus('')))}
              placeholder="+ status (Enter)"
              className="w-full rounded border border-dashed border-border bg-transparent px-2 py-1 text-xs outline-none"
            />
          </div>
        </div>

        <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Campos personalizados</div>
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="rounded-lg border border-border/60 p-2">
              <div className="flex items-center gap-1.5">
                <input
                  defaultValue={f.name}
                  onBlur={(e) => e.target.value !== f.name && trata(apiPatch(`/trabalho/campos/${f.id}`, { name: e.target.value }, token))}
                  className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs font-medium outline-none"
                />
                <span className="shrink-0 text-[10px] text-muted">{f.type}</span>
                <button title="Apagar campo (valores somem)" onClick={() => trata(apiDelete(`/trabalho/campos/${f.id}`, token))} className="shrink-0 p-0.5 text-muted hover:text-bad">
                  <X size={12} />
                </button>
              </div>
              {f.type === 'drop_down' && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {f.options.map((o) => (
                    <span key={o.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${o.color}26`, color: o.color }}>
                      <input
                        type="color" defaultValue={o.color}
                        onBlur={(e) => e.target.value !== o.color && trata(apiPatch(`/trabalho/opcoes/${o.id}`, { color: e.target.value }, token))}
                        className="h-3.5 w-3.5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                        title="Cor da opção"
                      />
                      {o.name}
                      <button onClick={() => trata(apiDelete(`/trabalho/opcoes/${o.id}`, token))}><X size={10} /></button>
                    </span>
                  ))}
                  <OpcaoNova fieldId={f.id} token={token} trata={trata} />
                </div>
              )}
            </div>
          ))}
          <input
            value={novoCampo} onChange={(e) => setNovoCampo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && novoCampo.trim() && trata(apiPost('/trabalho/campos', { listId: lista.id, name: novoCampo.trim(), type: 'drop_down' }, token).then(() => setNovoCampo('')))}
            placeholder="+ campo dropdown (Enter)"
            className="w-full rounded border border-dashed border-border bg-transparent px-2 py-1 text-xs outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function OpcaoNova({ fieldId, token, trata }: { fieldId: string; token: string | null; trata: (p: Promise<unknown>) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      value={v} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && v.trim() && trata(apiPost(`/trabalho/campos/${fieldId}/opcoes`, { name: v.trim() }, token).then(() => setV('')))}
      placeholder="+ opção"
      className="w-20 rounded border border-dashed border-border bg-transparent px-1.5 py-0.5 text-[11px] outline-none"
    />
  );
}
