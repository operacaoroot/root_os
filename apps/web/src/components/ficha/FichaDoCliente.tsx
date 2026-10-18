'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MOEDA_PADRAO,
  ehValorMonetarioCanonico,
  formatarValorMonetario,
  lerValorDigitadoPtBr,
  paraDigitarPtBr,
  JORNADA_DO_CLIENTE,
  faseDaLista,
  type JornadaDoCliente,
  type ReuniaoCompleta,
  type ReuniaoResumo,
  type TrabCampoDto,
  type TrabEstrutura,
  type TrabListaDto,
  type TrabTarefaDetalhe,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { abrirFicha, avisarQueAFichaMudou, fecharFicha } from '@/lib/ficha';

/*
 * FICHA DO CLIENTE. Um cartão do Trabalho visto como cliente:
 *   · posição: as etapas da lista, como trilho (clicar move, ao salvar);
 *   · dados do cliente: os campos de texto e link da lista;
 *   · negócio: os campos de opção, valor e data;
 *   · histórico: anotações, trocas de etapa, mudanças de cadastro e reuniões;
 *   · reuniões: transcrição do Granola (link público), outro link ou texto.
 * Só depende do cartão, então a mesma ficha serve ao lead do comercial, ao
 * onboarding e ao sucesso do cliente: cada lista traz os próprios campos.
 */

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

type Valor = { optionId: string | null; value: string | null };
const ehDado = (f: TrabCampoDto) => f.type === 'texto' || f.type === 'url';

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
  tipo: 'nota' | 'etapa' | 'cadastro' | 'criado' | 'reuniao';
  texto: string;
  reuniaoId?: string;
}

function linhaDoTempo(t: TrabTarefaDetalhe, campos: TrabCampoDto[], reunioes: ReuniaoResumo[]): Evento[] {
  const nomeDoCampo = new Map(campos.map((f) => [f.id, f.name]));
  const ev: Evento[] = t.comentarios.map((c) => ({ id: `c-${c.id}`, em: c.createdAt, quem: c.authorName, tipo: 'nota', texto: c.text }));
  for (const r of reunioes) {
    ev.push({ id: `r-${r.id}`, em: r.em, quem: r.autorNome ?? '', tipo: 'reuniao', texto: r.titulo, reuniaoId: r.id });
  }
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
  ev.push({ id: 'criado', em: t.createdAt, quem: '', tipo: 'criado', texto: 'Cadastrado' });
  return ev.sort((a, b) => b.em.localeCompare(a.em));
}

export function FichaDoCliente(props: {
  taskId: string;
  rotulo: string;
  /** Página inteira: o link de volta. Em janela: ausente, e o fechar substitui. */
  voltar?: { href: string; texto: string };
  emJanela?: boolean;
}) {
  const { taskId } = props;
  const { token, ready, can } = useAuth();
  const router = useRouter();
  const podeEditar = can('tarefas.editar');
  const [t, setT] = useState<TrabTarefaDetalhe | null>(null);
  const [lista, setLista] = useState<TrabListaDto | null>(null);
  const [campos, setCampos] = useState<TrabCampoDto[]>([]);
  const [proprias, setProprias] = useState<ReuniaoResumo[]>([]);
  const [jornada, setJornada] = useState<JornadaDoCliente | null>(null);
  const [passando, setPassando] = useState(false);
  // Reuniões da jornada inteira (lead, onboarding, sucesso); fora da jornada, só as do cartão.
  const reunioes: (ReuniaoResumo & { fase?: string })[] = jornada?.passos.length ? jornada.reunioes : proprias;
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<'historico' | 'reunioes'>('historico');
  const [aberta, setAberta] = useState<ReuniaoCompleta | null>(null);

  const [titulo, setTitulo] = useState('');
  const [statusId, setStatusId] = useState('');
  const [resumo, setResumo] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [nota, setNota] = useState('');

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [tarefa, estrutura, rs, jr] = await Promise.all([
        apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${taskId}`, token),
        apiGet<TrabEstrutura>('/trabalho/estrutura', token),
        apiGet<ReuniaoResumo[]>(`/trabalho/fichas/${taskId}/reunioes`, token),
        apiGet<JornadaDoCliente>(`/trabalho/fichas/${taskId}/jornada`, token).catch(() => null),
      ]);
      setJornada(jr);
      const l = acharLista(estrutura, tarefa.listId) ?? null;
      const cs = [...(l?.fields ?? []), ...estrutura.camposGlobais].sort((a, b) => a.order - b.order);
      setT(tarefa);
      setLista(l);
      setCampos(cs);
      setProprias(rs);
      setTitulo(tarefa.title);
      setStatusId(tarefa.statusId);
      setResumo(tarefa.description ?? '');
      const porCampo = new Map(tarefa.values.map((v) => [v.fieldId, { optionId: v.optionId, value: v.value }]));
      setForm(Object.fromEntries(cs.map((f) => [f.id, paraEditar(f, porCampo.get(f.id))])));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [taskId, token]);

  useEffect(() => {
    if (ready && token) carregar();
  }, [ready, token, carregar]);

  const eventos = useMemo(() => (t ? linhaDoTempo(t, campos, reunioes) : []), [t, campos, reunioes]);

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
      avisarQueAFichaMudou();
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
      avisarQueAFichaMudou();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  /** "+ adicionar novo" no seletor: cria a opção no campo (canal, vendedor…) e já a escolhe. */
  const novaOpcao = async (f: TrabCampoDto) => {
    if (!token) return;
    const nome = window.prompt(`Novo em ${f.name}:`)?.trim();
    if (!nome) return;
    try {
      const o = await apiPost<{ id: string }>(`/trabalho/campos/${f.id}/opcoes`, { name: nome }, token);
      const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token);
      const l = t ? acharLista(e, t.listId) : undefined;
      if (l) setCampos([...l.fields, ...e.camposGlobais].sort((a, b) => a.order - b.order));
      setForm((atual) => ({ ...atual, [f.id]: o.id }));
      flash(`"${nome}" entrou em ${f.name}. Salve a ficha para gravar no lead.`);
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  /** Passa o cliente para a próxima fase da jornada e abre a ficha nova. */
  const passar = async (destino: string) => {
    if (!token) return;
    setPassando(true);
    try {
      const r = await apiPost<{ id: string; rota: string }>(`/trabalho/fichas/${taskId}/passar`, { destino }, token);
      avisarQueAFichaMudou();
      if (props.emJanela) abrirFicha(r.id);
      else router.push(r.rota);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setPassando(false);
    }
  };

  const abrirReuniao = async (id: string) => {
    if (!token) return;
    try {
      setAberta(await apiGet<ReuniaoCompleta>(`/trabalho/fichas/reunioes/${id}`, token));
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (erro && !t) return <p className="text-bad">{erro}</p>;
  if (!t) return <p className="text-muted">Carregando a ficha…</p>;

  const valor = t.values.find((v) => v.type === 'moeda' && v.value);
  const contato = t.values.find((v) => /^contato/i.test(v.fieldName) && v.value)?.value;
  const proposta = t.values.find((v) => v.type === 'url' && /proposta/i.test(v.fieldName) && v.value)?.value;
  const input = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-70';
  const dados = campos.filter(ehDado);
  const negocio = campos.filter((f) => !ehDado(f));

  // Função, não componente: criado dentro do render, o input perderia o foco a cada letra.
  const campo = (f: TrabCampoDto) => (
    <label key={f.id} className="block">
      <span className="com-rotulo">{f.name}</span>
      {f.type === 'drop_down' ? (
        <select className={`${input} mt-1`} value={form[f.id] ?? ''} disabled={!podeEditar} onChange={(e) => (e.target.value === '__novo__' ? novaOpcao(f) : setForm({ ...form, [f.id]: e.target.value }))}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
          {podeEditar && <option value="__novo__">+ adicionar novo…</option>}
        </select>
      ) : (
        <input
          className={`${input} mt-1 ${f.type === 'moeda' || f.type === 'numero' ? 'com-num' : ''}`}
          type={f.type === 'data' ? 'date' : f.type === 'url' ? 'url' : 'text'}
          inputMode={f.type === 'moeda' || f.type === 'numero' ? 'decimal' : undefined}
          placeholder={f.type === 'moeda' ? 'R$ 0,00' : f.type === 'url' ? 'https://' : undefined}
          value={form[f.id] ?? ''}
          disabled={!podeEditar}
          onChange={(e) => setForm({ ...form, [f.id]: e.target.value })}
        />
      )}
    </label>
  );

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-5 text-text">
      <div>
        {props.emJanela ? (
          <div className="flex items-center justify-between gap-3">
            <button onClick={fecharFicha} className="rounded-md border border-border px-3 py-1 text-sm text-muted hover:border-brand hover:text-text">
              × Fechar
            </button>
            <Link href={`${faseDaLista(lista?.externalId)?.rota ?? '/comercial/lead/'}${t.id}`} className="text-sm text-muted underline hover:text-text">abrir em página inteira</Link>
          </div>
        ) : (
          props.voltar && <Link href={props.voltar.href} className="text-sm text-muted hover:text-text">← {props.voltar.texto}</Link>
        )}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="com-rotulo">{props.rotulo}</div>
            <h1 className="mt-1 text-[1.9rem] font-bold leading-tight tracking-tight">{t.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.statusColor }} />
                {t.statusName}
                {t.statusDesde && ` desde ${dia(t.statusDesde)}`}
              </span>
              {contato && <span>{contato}</span>}
              {valor?.value && <span className="com-num text-text">{formatarValorMonetario(valor.value)}</span>}
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            {proposta && <a href={proposta} target="_blank" rel="noreferrer" className="text-muted underline hover:text-text">ver a proposta</a>}
            <Link href={`/trabalho?lista=${t.listId}&tarefa=${t.id}`} className="text-muted underline hover:text-text">abrir no quadro</Link>
          </div>
        </div>
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {aviso && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{aviso}</div>}

      {lista && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2.5">
          <span className="com-rotulo mr-2">Posição no funil</span>
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
          {statusId !== t.statusId && <span className="text-sm text-brand">salve para mover</span>}
        </div>
      )}

      {/* A jornada: o mesmo cliente no comercial, no onboarding e no sucesso. */}
      {lista?.externalId && faseDaLista(lista.externalId) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
          <span className="com-rotulo mr-1">Jornada{jornada ? ` · ${jornada.cliente}` : ''}</span>
          {JORNADA_DO_CLIENTE.map((f, i) => {
            const passos = jornada?.passos.filter((p) => p.chave === f.chave) ?? [];
            return (
              <span key={f.chave} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted">→</span>}
                {passos.length === 0 ? (
                  <span className="rounded-md border border-dashed border-border px-2.5 py-1 text-sm text-muted">{f.fase}</span>
                ) : (
                  passos.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => p.id !== t.id && abrirFicha(p.id)}
                      className={`rounded-md border px-2.5 py-1 text-sm ${p.id === t.id ? 'border-brand bg-brand/15' : 'border-border hover:border-brand/60'}`}
                      title={p.id === t.id ? 'Esta ficha' : `Abrir a ficha de ${f.fase}`}
                    >
                      <span className="font-medium">{f.fase}</span>
                      <span className="ml-1.5 inline-flex items-center gap-1 text-muted">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.etapaCor }} />
                        {p.etapa}
                      </span>
                    </button>
                  ))
                )}
              </span>
            );
          })}
          {(() => {
            const prox = faseDaLista(lista.externalId)?.proxima;
            const fase = prox ? faseDaLista(prox) : null;
            const ja = jornada?.passos.some((p) => p.chave === prox);
            if (!fase || ja || !podeEditar) return null;
            return (
              <button
                onClick={() => passar(fase.chave)}
                disabled={passando}
                className="ml-auto rounded-md border border-brand px-3 py-1 text-sm text-brand hover:bg-brand/10 disabled:opacity-50"
                title={`Cria a ficha em ${fase.fase} com os dados deste cliente`}
              >
                {passando ? 'Passando…' : `Passar para ${fase.fase} →`}
              </button>
            );
          })()}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <div className="space-y-5">
          {dados.length > 0 && (
            <section className="rounded-md border border-border bg-surface px-5 py-4">
              <h2 className="text-[1.05rem] font-semibold">Dados do cliente</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="com-rotulo">Nome na ficha</span>
                  <input className={`${input} mt-1`} value={titulo} disabled={!podeEditar} onChange={(e) => setTitulo(e.target.value)} />
                </label>
                {dados.map(campo)}
              </div>
            </section>
          )}
          <section className="rounded-md border border-border bg-surface px-5 py-4">
            <h2 className="text-[1.05rem] font-semibold">Negócio</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!dados.length && (
                <label className="block sm:col-span-2">
                  <span className="com-rotulo">Nome na ficha</span>
                  <input className={`${input} mt-1`} value={titulo} disabled={!podeEditar} onChange={(e) => setTitulo(e.target.value)} />
                </label>
              )}
              {negocio.map(campo)}
              <label className="block sm:col-span-2">
                <span className="com-rotulo">Resumo da negociação</span>
                <textarea
                  className={`${input} mt-1 min-h-[8rem]`}
                  value={resumo}
                  disabled={!podeEditar}
                  placeholder="Quem é, o que precisa, proposta em jogo, objeções, próximo passo."
                  onChange={(e) => setResumo(e.target.value)}
                />
              </label>
            </div>
          </section>
          {podeEditar && (
            <button onClick={salvar} disabled={salvando} className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar ficha'}
            </button>
          )}
        </div>

        <section className="rounded-md border border-border bg-surface px-5 py-4">
          <div className="flex gap-1 border-b border-border">
            {(['historico', 'reunioes'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAba(a)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
              >
                {a === 'historico' ? 'Histórico' : `Reuniões (${reunioes.length})`}
              </button>
            ))}
          </div>

          {aba === 'historico' && (
            <div className="mt-4 space-y-4">
              {podeEditar && (
                <div className="space-y-2">
                  <textarea
                    className={`${input} min-h-[4.5rem]`}
                    value={nota}
                    placeholder="O que aconteceu? Ligação, proposta enviada, resposta do cliente…"
                    onChange={(e) => setNota(e.target.value)}
                  />
                  <button onClick={anotar} disabled={!nota.trim()} className="rounded-md border border-brand px-3 py-1.5 text-sm text-brand hover:bg-brand/10 disabled:opacity-40">
                    Registrar
                  </button>
                </div>
              )}
              <ol className="relative space-y-4 border-l border-border pl-5">
                {eventos.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className={`absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ${
                        e.tipo === 'etapa' ? 'bg-brand' : e.tipo === 'reuniao' ? 'bg-brand/50 ring-2 ring-brand' : e.tipo === 'nota' ? 'bg-text' : 'bg-muted/50'
                      }`}
                    />
                    <div className="text-xs text-muted">
                      {e.tipo === 'reuniao' ? dia(e.em) : quando(e.em)}
                      {e.quem && ` · ${e.quem}`}
                      {e.tipo === 'etapa' && ' · mudou de etapa'}
                      {e.tipo === 'reuniao' && ' · reunião'}
                    </div>
                    {e.reuniaoId ? (
                      <button onClick={() => abrirReuniao(e.reuniaoId!)} className="mt-0.5 text-left font-medium underline decoration-brand/50 hover:text-brand">
                        {e.texto}
                      </button>
                    ) : (
                      <div className={`mt-0.5 whitespace-pre-wrap ${e.tipo === 'nota' ? '' : 'text-muted'}`}>{e.texto}</div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {aba === 'reunioes' && (
            <Reunioes
              taskId={taskId}
              reunioes={reunioes}
              podeEditar={podeEditar}
              abrir={abrirReuniao}
              mudou={async () => { await carregar(); avisarQueAFichaMudou(); }}
              erro={setErro}
            />
          )}
        </section>
      </div>

      {aberta && <Transcricao r={aberta} fechar={() => setAberta(null)} />}
    </div>
  );
}

function Reunioes(props: {
  taskId: string;
  reunioes: (ReuniaoResumo & { fase?: string })[];
  podeEditar: boolean;
  abrir: (id: string) => void;
  mudou: () => Promise<void>;
  erro: (m: string | null) => void;
}) {
  const { token } = useAuth();
  const [fonte, setFonte] = useState<'granola' | 'texto'>('granola');
  const [titulo, setTitulo] = useState('');
  const [em, setEm] = useState(hoje());
  const [link, setLink] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const input = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand';

  const enviar = async () => {
    if (!token) return;
    setEnviando(true);
    props.erro(null);
    try {
      await apiPost(
        `/trabalho/fichas/${props.taskId}/reunioes`,
        { titulo: titulo.trim() || `Reunião de ${em.split('-').reverse().join('/')}`, em, fonte, link: fonte === 'granola' ? link.trim() : null, texto: fonte === 'texto' ? texto : null },
        token,
      );
      setTitulo('');
      setLink('');
      setTexto('');
      await props.mudou();
    } catch (e) {
      props.erro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const apagar = async (r: ReuniaoResumo) => {
    if (!token || !window.confirm(`Tirar "${r.titulo}" da ficha?`)) return;
    try {
      await apiDelete(`/trabalho/fichas/reunioes/${r.id}`, token);
      await props.mudou();
    } catch (e) {
      props.erro((e as Error).message);
    }
  };

  return (
    <div className="mt-4 space-y-5">
      {props.podeEditar && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex gap-2 text-sm">
            <button onClick={() => setFonte('granola')} className={`rounded-full border px-3 py-1 ${fonte === 'granola' ? 'border-brand bg-brand/15' : 'border-border text-muted'}`}>
              Link do Granola
            </button>
            <button onClick={() => setFonte('texto')} className={`rounded-full border px-3 py-1 ${fonte === 'texto' ? 'border-brand bg-brand/15' : 'border-border text-muted'}`}>
              Colar transcrição
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <input className={input} value={titulo} placeholder="Título (ex.: Diagnóstico com o sócio)" onChange={(e) => setTitulo(e.target.value)} />
            <input className={input} type="date" value={em} onChange={(e) => setEm(e.target.value)} />
          </div>
          {fonte === 'granola' ? (
            <>
              <input className={input} value={link} placeholder="https://notes.granola.ai/… (nota compartilhada como pública)" onChange={(e) => setLink(e.target.value)} />
              <p className="text-xs text-muted">No Granola: Share → copiar o link público. A ficha guarda o texto, não só o link.</p>
            </>
          ) : (
            <textarea className={`${input} min-h-[7rem]`} value={texto} placeholder="Cole aqui a transcrição ou as notas da reunião." onChange={(e) => setTexto(e.target.value)} />
          )}
          <button
            onClick={enviar}
            disabled={enviando || (fonte === 'granola' ? !link.trim() : !texto.trim())}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-40"
          >
            {enviando ? 'Lendo…' : 'Adicionar reunião'}
          </button>
        </div>
      )}
      {props.reunioes.length === 0 && <p className="text-muted">Nenhuma reunião registrada.</p>}
      <ul className="space-y-3">
        {props.reunioes.map((r) => (
          <li key={r.id} className="group rounded-md border border-border p-3 hover:border-brand/50">
            <div className="flex items-baseline justify-between gap-3">
              <button onClick={() => props.abrir(r.id)} className="text-left font-medium hover:text-brand">{r.titulo}</button>
              <span className="shrink-0 text-xs text-muted">{dia(r.em)} · {r.fonte === 'granola' ? 'Granola' : r.fonte === 'arquivo' ? 'arquivo' : r.fonte}{r.fase ? ` · ${r.fase}` : ''}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-sm text-muted">{r.trecho}</p>
            <div className="mt-2 flex gap-4 text-sm">
              <button onClick={() => props.abrir(r.id)} className="text-brand">ler transcrição ({Math.round(r.caracteres / 1000)} mil caracteres)</button>
              {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-muted underline">original</a>}
              {props.podeEditar && (
                <button onClick={() => apagar(r)} className="ml-auto text-muted opacity-0 hover:text-bad group-hover:opacity-100">tirar</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Transcricao({ r, fechar }: { r: ReuniaoCompleta; fechar: () => void }) {
  const [busca, setBusca] = useState('');
  const partes = useMemo(() => {
    if (!busca.trim()) return null;
    const re = new RegExp(`(${busca.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return r.transcricao.split(re);
  }, [busca, r.transcricao]);
  return (
    <div data-transcricao className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={fechar}>
      <div className="com-tema flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <div className="com-rotulo">Reunião · {dia(r.em)}</div>
            <h3 className="text-lg font-semibold">{r.titulo}</h3>
          </div>
          <button onClick={fechar} className="text-2xl leading-none text-muted hover:text-text" aria-label="Fechar">×</button>
        </div>
        <div className="border-b border-border px-5 py-2">
          <input
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand"
            placeholder="Buscar na transcrição (preço, objeção, prazo…)"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">
          {partes
            ? partes.map((p, i) => (i % 2 === 1 ? <mark key={i} className="rounded bg-brand/30 text-text">{p}</mark> : <span key={i}>{p}</span>))
            : r.transcricao}
        </div>
      </div>
    </div>
  );
}
