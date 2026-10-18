'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  MOEDA_PADRAO,
  ehValorMonetarioCanonico,
  formatarValorMonetario,
  lerValorDigitadoPtBr,
  paraDigitarPtBr,
  type TrabCampoDto,
  type TrabEstrutura,
  type TrabListaDto,
  type TrabTarefaDetalhe,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * FICHA DO LEAD. O lead é um cartão da lista "Gestão de Leads" do Trabalho: o
 * cadastro são os campos da lista, a etapa é a etapa do cartão, e a negociação
 * é a descrição (o resumo) mais a linha do tempo de anotações e trocas de
 * etapa. Tudo grava pela API do Trabalho, então o quadro e o painel enxergam o
 * mesmo dado.
 */

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

type Valor = { optionId: string | null; value: string | null };

/** O texto que o campo mostra no formulário a partir do valor gravado. */
function paraEditar(f: TrabCampoDto, v: Valor | undefined): string {
  if (!v) return '';
  if (f.type === 'drop_down') return v.optionId ?? '';
  if (f.type === 'moeda') return v.value && ehValorMonetarioCanonico(v.value) ? paraDigitarPtBr(v.value) : v.value ?? '';
  return v.value ?? '';
}

function acharLista(e: TrabEstrutura, listId: string): TrabListaDto | undefined {
  return [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas].find((l) => l.id === listId);
}

interface Evento {
  id: string;
  em: string;
  quem: string;
  tipo: 'nota' | 'etapa' | 'cadastro' | 'criado';
  texto: string;
}

/** A linha do tempo da negociação: anotações + trocas de etapa + mudanças no cadastro. */
function linhaDoTempo(t: TrabTarefaDetalhe, campos: TrabCampoDto[]): Evento[] {
  const nomeDoCampo = new Map(campos.map((f) => [f.id, f.name]));
  const ev: Evento[] = t.comentarios.map((c) => ({
    id: `c-${c.id}`, em: c.createdAt, quem: c.authorName, tipo: 'nota', texto: c.text,
  }));
  for (const a of t.atividade) {
    if (a.action !== 'work.task.update') continue;
    const antes = (a.before ?? {}) as Record<string, unknown>;
    const depois = (a.after ?? {}) as Record<string, unknown>;
    if (depois.status && antes.status !== depois.status) {
      ev.push({ id: `e-${a.id}`, em: a.createdAt, quem: a.actorName ?? 'sistema', tipo: 'etapa', texto: `${antes.status ?? '—'} → ${depois.status}` });
    }
    const ca = (antes.campos ?? {}) as Record<string, unknown>;
    const cd = (depois.campos ?? {}) as Record<string, unknown>;
    const mudou = Object.keys(cd).filter((k) => JSON.stringify(ca[k]) !== JSON.stringify(cd[k]));
    if (mudou.length) {
      ev.push({ id: `f-${a.id}`, em: a.createdAt, quem: a.actorName ?? 'sistema', tipo: 'cadastro', texto: `atualizou ${mudou.map((k) => nomeDoCampo.get(k) ?? k).join(', ')}` });
    }
  }
  ev.push({ id: 'criado', em: t.createdAt, quem: '', tipo: 'criado', texto: 'Lead cadastrado' });
  return ev.sort((a, b) => b.em.localeCompare(a.em));
}

export default function FichaDoLead() {
  const { id } = useParams<{ id: string }>();
  const { token, ready, can } = useAuth();
  const podeEditar = can('tarefas.editar');
  const [t, setT] = useState<TrabTarefaDetalhe | null>(null);
  const [lista, setLista] = useState<TrabListaDto | null>(null);
  const [campos, setCampos] = useState<TrabCampoDto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // o formulário
  const [titulo, setTitulo] = useState('');
  const [statusId, setStatusId] = useState('');
  const [resumo, setResumo] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [nota, setNota] = useState('');

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [tarefa, estrutura] = await Promise.all([
        apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${id}`, token),
        apiGet<TrabEstrutura>('/trabalho/estrutura', token),
      ]);
      const l = acharLista(estrutura, tarefa.listId) ?? null;
      const cs = [...(l?.fields ?? []), ...estrutura.camposGlobais].sort((a, b) => a.order - b.order);
      setT(tarefa);
      setLista(l);
      setCampos(cs);
      setTitulo(tarefa.title);
      setStatusId(tarefa.statusId);
      setResumo(tarefa.description ?? '');
      const porCampo = new Map(tarefa.values.map((v) => [v.fieldId, { optionId: v.optionId, value: v.value }]));
      setForm(Object.fromEntries(cs.map((f) => [f.id, paraEditar(f, porCampo.get(f.id))])));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id, token]);

  useEffect(() => {
    if (ready && token) carregar();
  }, [ready, token, carregar]);

  const eventos = useMemo(() => (t ? linhaDoTempo(t, campos) : []), [t, campos]);

  const flash = (m: string) => {
    setAviso(m);
    setErro(null);
    setTimeout(() => setAviso(null), 3500);
  };

  const salvar = async () => {
    if (!t || !token) return;
    const porCampo = new Map(t.values.map((v) => [v.fieldId, v]));
    const mudancas: Record<string, Valor> = {};
    for (const f of campos) {
      const novo = (form[f.id] ?? '').trim();
      if (novo === paraEditar(f, porCampo.get(f.id))) continue;
      if (!novo) mudancas[f.id] = { optionId: null, value: null };
      else if (f.type === 'drop_down') mudancas[f.id] = { optionId: novo, value: null };
      else if (f.type === 'moeda') {
        const r = lerValorDigitadoPtBr(novo, MOEDA_PADRAO);
        if (!r.valor) return setErro(`${f.name}: ${r.motivo}`);
        mudancas[f.id] = { optionId: null, value: r.valor };
      } else mudancas[f.id] = { optionId: null, value: novo };
    }
    const corpo: Record<string, unknown> = { expectedUpdatedAt: t.updatedAt };
    if (titulo.trim() && titulo.trim() !== t.title) corpo.title = titulo.trim();
    if (statusId !== t.statusId) corpo.statusId = statusId;
    if ((resumo || null) !== (t.description || null)) corpo.description = resumo || null;
    if (Object.keys(mudancas).length) corpo.campos = mudancas;
    if (Object.keys(corpo).length === 1) return flash('Nada mudou.');
    setSalvando(true);
    try {
      await apiPatch(`/trabalho/tarefas/${t.id}`, corpo, token);
      await carregar();
      flash('Salvo.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const anotar = async () => {
    if (!t || !token || !nota.trim()) return;
    try {
      await apiPost(`/trabalho/tarefas/${t.id}/comentarios`, { text: nota.trim() }, token);
      setNota('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (erro && !t) return <p className="text-bad">{erro}</p>;
  if (!t) return <p className="text-muted">Carregando…</p>;

  const valor = t.values.find((v) => v.type === 'moeda' && v.value);
  const etapa = lista?.statuses.find((s) => s.id === t.statusId);
  const input = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-70';

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      <div>
        <Link href="/comercial?ver=negocios" className="text-sm text-muted hover:text-text">← Negócios</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="com-rotulo">Lead</div>
            <h1 className="mt-1 text-[2rem] font-bold leading-tight tracking-tight">{t.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.statusColor }} />
                {t.statusName}
                {t.statusDesde && ` desde ${dia(t.statusDesde)}`}
              </span>
              {valor?.value && <span className="com-num text-text">{formatarValorMonetario(valor.value)}</span>}
            </p>
          </div>
          <Link href={`/trabalho?lista=${t.listId}&tarefa=${t.id}`} className="text-sm text-muted underline hover:text-text">
            abrir no quadro
          </Link>
        </div>
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {aviso && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{aviso}</div>}

      {/* A etapa como trilho: clicar move o lead (grava ao salvar). */}
      {lista && (
        <div className="flex flex-wrap gap-1.5">
          {lista.statuses.map((s) => {
            const on = s.id === statusId;
            return (
              <button
                key={s.id}
                disabled={!podeEditar}
                onClick={() => setStatusId(s.id)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  on ? 'border-brand bg-brand/15 font-medium text-text' : 'border-border text-muted hover:border-brand/50 hover:text-text'
                }`}
                title={on ? 'Etapa atual' : `Mover para ${s.name}`}
              >
                {s.name}
              </button>
            );
          })}
          {etapa && statusId !== t.statusId && <span className="self-center text-sm text-brand">salve para mover</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="space-y-4 rounded-md border border-border bg-surface px-5 py-4">
          <h2 className="text-[1.05rem] font-semibold">Cadastro</h2>
          <label className="block">
            <span className="com-rotulo">Nome do lead</span>
            <input className={`${input} mt-1`} value={titulo} disabled={!podeEditar} onChange={(e) => setTitulo(e.target.value)} />
          </label>
          {campos.map((f) => (
            <label key={f.id} className="block">
              <span className="com-rotulo">{f.name}</span>
              {f.type === 'drop_down' ? (
                <select
                  className={`${input} mt-1`}
                  value={form[f.id] ?? ''}
                  disabled={!podeEditar}
                  onChange={(e) => setForm({ ...form, [f.id]: e.target.value })}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${input} mt-1 ${f.type === 'moeda' || f.type === 'numero' ? 'com-num' : ''}`}
                  type={f.type === 'data' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                  inputMode={f.type === 'moeda' || f.type === 'numero' ? 'decimal' : undefined}
                  placeholder={f.type === 'moeda' ? 'R$ 0,00' : undefined}
                  value={form[f.id] ?? ''}
                  disabled={!podeEditar}
                  onChange={(e) => setForm({ ...form, [f.id]: e.target.value })}
                />
              )}
            </label>
          ))}
          <label className="block">
            <span className="com-rotulo">Resumo da negociação</span>
            <textarea
              className={`${input} mt-1 min-h-[9rem]`}
              value={resumo}
              disabled={!podeEditar}
              placeholder="Quem é, o que precisa, proposta em jogo, objeções, próximo passo."
              onChange={(e) => setResumo(e.target.value)}
            />
          </label>
          {podeEditar && (
            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </section>

        <section className="space-y-4 rounded-md border border-border bg-surface px-5 py-4">
          <h2 className="text-[1.05rem] font-semibold">Negociação</h2>
          {podeEditar && (
            <div className="space-y-2">
              <textarea
                className={`${input} min-h-[5rem]`}
                value={nota}
                placeholder="O que aconteceu? Reunião, ligação, proposta enviada, resposta do cliente…"
                onChange={(e) => setNota(e.target.value)}
              />
              <button
                onClick={anotar}
                disabled={!nota.trim()}
                className="rounded-md border border-brand px-3 py-1.5 text-sm text-brand hover:bg-brand/10 disabled:opacity-40"
              >
                Registrar
              </button>
            </div>
          )}
          <ol className="relative space-y-4 border-l border-border pl-5">
            {eventos.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={`absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ${
                    e.tipo === 'etapa' ? 'bg-brand' : e.tipo === 'nota' ? 'bg-text' : 'bg-muted/50'
                  }`}
                />
                <div className="text-xs text-muted">
                  {quando(e.em)}
                  {e.quem && ` · ${e.quem}`}
                  {e.tipo === 'etapa' && ' · mudou de etapa'}
                </div>
                <div className={`mt-0.5 whitespace-pre-wrap ${e.tipo === 'nota' ? '' : 'text-muted'}`}>{e.texto}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
