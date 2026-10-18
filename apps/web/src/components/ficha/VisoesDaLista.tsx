'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QuadroDaLista } from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EVENTO_FICHA_MUDOU, abrirFicha } from '@/lib/ficha';

/*
 * AS VISÕES DE UMA LISTA DA JORNADA (funil, onboarding, sucesso): Quadro,
 * Lista e Calendário, como no ClickUp. As três leem o mesmo
 * `/trabalho/fichas/quadro` e abrem a mesma ficha em janela.
 *
 *   · Quadro: ocupa até o rodapé da página, então a barra de rolar para os
 *     lados fica na borda de baixo da tela; cada coluna rola por dentro.
 *     "+ Adicionar lead" no topo de cada coluna cria o cartão naquela etapa.
 *   · Lista: tabela ordenável, com a etapa e o que importa de cada cartão.
 *   · Calendário: o mês, pelo campo de data escolhido (Próximo contato,
 *     Entrega prevista…) ou pelo prazo; arrastar troca a data.
 */
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
type Cartao = QuadroDaLista['cartoes'][number];
type Visao = 'quadro' | 'lista' | 'calendario';
const VISOES: { v: Visao; nome: string }[] = [
  { v: 'quadro', nome: 'Quadro' },
  { v: 'lista', nome: 'Lista' },
  { v: 'calendario', nome: 'Calendário' },
];
const PRAZO = '__prazo__';

/** Altura da tela que sobra abaixo do elemento: o quadro termina no rodapé da página. */
function useAlturaAteOFim(ref: React.RefObject<HTMLElement | null>, folga = 16) {
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      if (!ref.current) return;
      setAltura(Math.max(320, window.innerHeight - ref.current.getBoundingClientRect().top - folga));
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  });
  return altura;
}

export function VisoesDaLista(props: {
  chave: string;
  /** Como chamar o cartão: "lead", "cliente". */
  item: string;
  rotuloAbertos: string;
  rotuloDoValor: string;
  /** Texto do botão de cima, ex.: "+ Novo lead". */
  novo: string;
}) {
  const { chave } = props;
  const { token, ready, can } = useAuth();
  const pode = can('tarefas.editar');
  const [q, setQ] = useState<QuadroDaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>('quadro');

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('visao');
    if (v === 'lista' || v === 'calendario') setVisao(v);
  }, []);
  const trocarVisao = (v: Visao) => {
    setVisao(v);
    const u = new URL(window.location.href);
    if (v === 'quadro') u.searchParams.delete('visao');
    else u.searchParams.set('visao', v);
    window.history.replaceState(window.history.state, '', u);
  };

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<QuadroDaLista>(`/trabalho/fichas/quadro?lista=${chave}`, token).then(setQ).catch((e) => setErro(e.message));
  }, [token, chave]);

  useEffect(() => {
    if (!ready || !token) return;
    carregar();
    window.addEventListener(EVENTO_FICHA_MUDOU, carregar);
    return () => window.removeEventListener(EVENTO_FICHA_MUDOU, carregar);
  }, [ready, token, carregar]);

  /** Cria o cartão (na etapa e/ou data dadas) e abre a ficha em janela. */
  const criar = async (titulo: string, extra: { statusId?: string; campoData?: string; dia?: string } = {}) => {
    if (!token || !q?.lista || !titulo.trim()) return;
    const corpo: Record<string, unknown> = { listId: q.lista.id, title: titulo.trim() };
    if (extra.statusId) corpo.statusId = extra.statusId;
    if (extra.dia && extra.campoData === PRAZO) corpo.dueDate = `${extra.dia}T15:00:00.000Z`;
    else if (extra.dia && extra.campoData) corpo.campos = { [extra.campoData]: { value: extra.dia } };
    try {
      const t = await apiPost<{ id: string }>('/trabalho/tarefas', corpo, token);
      carregar();
      abrirFicha(t.id);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const atualizar = async (c: Cartao, corpo: Record<string, unknown>) => {
    if (!token) return;
    try {
      await apiPatch(`/trabalho/tarefas/${c.id}`, { ...corpo, expectedUpdatedAt: c.atualizadoEm }, token);
    } catch (e) {
      setErro((e as Error).message);
    }
    carregar();
  };

  if (erro && !q) return <p className="text-bad">{erro}</p>;
  if (!q) return <p className="text-muted">Carregando…</p>;
  if (!q.lista) return <p className="text-muted">Esta lista ainda não existe. Rode a carga do CRM (db:seed:crm).</p>;

  const fechada = (c: Cartao) => !!q.etapas.find((e) => e.id === c.statusId)?.fechada;
  const abertos = q.cartoes.filter((c) => !fechada(c));
  const somaAbertos = abertos.reduce((s, c) => s + (c.valor ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1">
          {VISOES.map((x) => (
            <button
              key={x.v}
              onClick={() => trocarVisao(x.v)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${visao === x.v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {x.nome}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-5">
          <span className="text-sm text-muted">
            {props.rotuloAbertos}: <b className="com-num text-text">{abertos.length}</b>
          </span>
          <span className="text-sm text-muted">
            {props.rotuloDoValor}: <b className="com-num text-text">{brl(somaAbertos)}</b>
          </span>
          {pode && (
            <button
              onClick={() => { const t = window.prompt(`Nome do ${props.item}:`); if (t) void criar(t); }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90"
            >
              {props.novo}
            </button>
          )}
        </div>
      </div>
      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}

      {visao === 'quadro' && <Quadro q={q} pode={pode} item={props.item} criar={criar} mover={(c, statusId) => atualizar(c, { statusId })} />}
      {visao === 'lista' && <Lista q={q} />}
      {visao === 'calendario' && <Calendario q={q} pode={pode} criar={criar} item={props.item} mudarData={atualizar} />}
    </div>
  );
}

// ---------------- Quadro ----------------

function Quadro(props: {
  q: QuadroDaLista;
  pode: boolean;
  item: string;
  criar: (titulo: string, extra: { statusId: string }) => Promise<void>;
  mover: (c: Cartao, statusId: string) => Promise<void>;
}) {
  const { q, pode } = props;
  const ref = useRef<HTMLDivElement>(null);
  const altura = useAlturaAteOFim(ref);
  const [arrastando, setArrastando] = useState<Cartao | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [texto, setTexto] = useState('');

  return (
    // Altura até o rodapé: a barra de rolar para os lados fica na borda de baixo da tela.
    <div ref={ref} className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2" style={{ height: altura ?? undefined }}>
      {q.etapas.map((e) => {
        const cartoes = q.cartoes.filter((c) => c.statusId === e.id).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
        const soma = cartoes.reduce((s, c) => s + (c.valor ?? 0), 0);
        const larga = cartoes.length > 0 || sobre === e.id || novoEm === e.id;
        return (
          <div
            key={e.id}
            onDragOver={(ev) => { if (arrastando) { ev.preventDefault(); setSobre(e.id); } }}
            onDragLeave={() => setSobre((s) => (s === e.id ? null : s))}
            onDrop={(ev) => { ev.preventDefault(); setSobre(null); if (arrastando) void props.mover(arrastando, e.id); setArrastando(null); }}
            className={`flex h-full ${larga ? 'w-64' : 'w-44'} shrink-0 flex-col rounded-md border bg-surface transition-[width] ${sobre === e.id ? 'border-brand' : 'border-border'} ${e.fechada ? 'opacity-85' : ''}`}
          >
            <div className="shrink-0 border-b border-border px-3 py-2.5" style={{ borderTop: `3px solid ${e.cor}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{e.nome}</span>
                <span className="com-num text-sm text-muted">{cartoes.length}</span>
              </div>
              <div className="com-num text-sm text-muted">{soma ? brl(soma) : '—'}</div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {pode &&
                (novoEm === e.id ? (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      if (texto.trim()) void props.criar(texto, { statusId: e.id });
                      setTexto('');
                      setNovoEm(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={texto}
                      onChange={(ev) => setTexto(ev.target.value)}
                      onBlur={() => { if (!texto.trim()) setNovoEm(null); }}
                      onKeyDown={(ev) => ev.key === 'Escape' && setNovoEm(null)}
                      placeholder={`Nome do ${props.item} e Enter`}
                      className="w-full rounded-md border border-brand bg-surface-2 px-2.5 py-1.5 text-sm outline-none"
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => { setNovoEm(e.id); setTexto(''); }}
                    className="rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-brand"
                  >
                    + Adicionar {props.item}
                  </button>
                ))}
              {cartoes.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  draggable={pode}
                  onDragStart={() => setArrastando(c)}
                  onDragEnd={() => { setArrastando(null); setSobre(null); }}
                  onClick={() => abrirFicha(c.id)}
                  onKeyDown={(ev) => ev.key === 'Enter' && abrirFicha(c.id)}
                  className="shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 px-3 py-2 hover:border-brand/60"
                >
                  <div className="text-sm font-medium leading-snug">{c.titulo}</div>
                  {c.contato && <div className="mt-0.5 text-xs text-muted">{c.contato}</div>}
                  {c.selo && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.seloCor ?? '#888' }} />
                      {c.selo}
                    </span>
                  )}
                  {c.proximaTarefa && (
                    <div
                      className={`mt-1.5 truncate text-xs ${c.proximaTarefa.atrasada ? 'text-bad' : 'text-muted'}`}
                      title={`${c.tarefasAbertas} tarefa(s) aberta(s). Próxima: ${c.proximaTarefa.titulo}`}
                    >
                      ☐ {c.tarefasAbertas} · {c.proximaTarefa.prazo ? `${c.proximaTarefa.prazo.slice(8, 10)}/${c.proximaTarefa.prazo.slice(5, 7)} ` : ''}
                      {c.proximaTarefa.titulo}
                    </div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted">
                    <span>
                      {c.responsavel ?? 'sem responsável'}
                      {!e.fechada && c.diasNaEtapa != null && ` · ${c.diasNaEtapa}d`}
                    </span>
                    <span className="com-num text-sm text-text">{c.valor != null ? brl(c.valor) : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Lista ----------------

type Coluna = 'titulo' | 'etapa' | 'valor' | 'contato' | 'responsavel' | 'selo' | 'dias' | 'criadoEm';

function Lista({ q }: { q: QuadroDaLista }) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'etapa', desc: false });
  const [busca, setBusca] = useState('');
  const posEtapa = useMemo(() => new Map(q.etapas.map((e, i) => [e.id, i])), [q.etapas]);
  const etapa = (c: Cartao) => q.etapas.find((e) => e.id === c.statusId);
  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = q.cartoes.filter((c) => !termo || `${c.titulo} ${c.contato ?? ''}`.toLowerCase().includes(termo));
    const chave = (c: Cartao): string | number => {
      switch (ordem.col) {
        case 'etapa': return posEtapa.get(c.statusId) ?? 99;
        case 'valor': return c.valor ?? -1;
        case 'dias': return c.diasNaEtapa ?? -1;
        case 'criadoEm': return c.criadoEm;
        default: return (c[ordem.col] ?? '').toString().toLowerCase();
      }
    };
    return [...filtradas].sort((a, b) => {
      const x = chave(a), y = chave(b);
      const r = x < y ? -1 : x > y ? 1 : (b.valor ?? 0) - (a.valor ?? 0);
      return ordem.desc ? -r : r;
    });
  }, [q.cartoes, ordem, busca, posEtapa]);

  const Th = ({ col, children, direita }: { col: Coluna; children: React.ReactNode; direita?: boolean }) => (
    <th className={`com-rotulo pb-2 font-normal ${direita ? 'text-right' : ''}`}>
      <button
        onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col === 'valor' || col === 'dias' }))}
        className="hover:text-text"
      >
        {children}
        {ordem.col === col && (ordem.desc ? ' ↓' : ' ↑')}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou contato"
        className="w-full max-w-sm rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand"
      />
      <div className="overflow-x-auto rounded-md border border-border bg-surface px-4 py-3">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left">
              <Th col="titulo">Nome</Th>
              <Th col="etapa">Etapa</Th>
              <Th col="contato">Contato</Th>
              <Th col="responsavel">Responsável</Th>
              <Th col="selo">Tipo</Th>
              <Th col="dias" direita>Na etapa</Th>
              <Th col="valor" direita>Valor</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((c) => {
              const e = etapa(c);
              return (
                <tr key={c.id} onClick={() => abrirFicha(c.id)} className="cursor-pointer hover:bg-surface-2">
                  <td className="py-2 pr-3 font-medium">{c.titulo}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: e?.cor }} />
                      {e?.nome}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted">{c.contato ?? '—'}</td>
                  <td className="py-2 pr-3 text-muted">{c.responsavel ?? '—'}</td>
                  <td className="py-2 pr-3 text-muted">{c.selo ?? '—'}</td>
                  <td className="com-num py-2 text-right text-muted">{!e?.fechada && c.diasNaEtapa != null ? `${c.diasNaEtapa}d` : '—'}</td>
                  <td className="com-num py-2 text-right">{c.valor != null ? brl(c.valor) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {linhas.length === 0 && <p className="py-3 text-muted">Nada encontrado.</p>}
      </div>
    </div>
  );
}

// ---------------- Calendário ----------------

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Calendario(props: {
  q: QuadroDaLista;
  pode: boolean;
  item: string;
  criar: (titulo: string, extra: { campoData: string; dia: string }) => Promise<void>;
  mudarData: (c: Cartao, corpo: Record<string, unknown>) => Promise<void>;
}) {
  const { q, pode } = props;
  const opcoes = [...q.camposData, { id: PRAZO, nome: 'Prazo' }];
  // Abre pelo campo de planejamento (Próximo contato, Entrega prevista), não pela data de cadastro.
  const [campo, setCampo] = useState(() => (opcoes.find((o) => /pr[oó]xim|prevista/i.test(o.nome)) ?? opcoes[0]).id);
  const [mes, setMes] = useState(() => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), 1); });
  const [arrastando, setArrastando] = useState<Cartao | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const hoje = iso(new Date());

  const dataDe = (c: Cartao) => (campo === PRAZO ? c.prazo : c.datas[campo] ?? null);
  const porDia = new Map<string, Cartao[]>();
  for (const c of q.cartoes) {
    const d = dataDe(c);
    if (d) porDia.set(d, [...(porDia.get(d) ?? []), c]);
  }
  const semData = q.cartoes.filter((c) => !dataDe(c) && !q.etapas.find((e) => e.id === c.statusId)?.fechada);

  const inicio = new Date(mes);
  inicio.setDate(1 - inicio.getDay());
  const dias = Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));

  const soltar = (dia: string) => {
    if (!arrastando || dataDe(arrastando) === dia) return;
    void props.mudarData(arrastando, campo === PRAZO ? { dueDate: `${dia}T15:00:00.000Z` } : { campos: { [campo]: { value: dia } } });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="rounded-md border border-border px-2 py-1 text-sm hover:border-brand" aria-label="Mês anterior">‹</button>
          <button onClick={() => { const h = new Date(); setMes(new Date(h.getFullYear(), h.getMonth(), 1)); }} className="rounded-md border border-border px-2.5 py-1 text-sm hover:border-brand">hoje</button>
          <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} className="rounded-md border border-border px-2 py-1 text-sm hover:border-brand" aria-label="Próximo mês">›</button>
        </div>
        <span className="text-[1.05rem] font-semibold capitalize">{MESES[mes.getMonth()]} {mes.getFullYear()}</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          mostrar por
          <select value={campo} onChange={(e) => setCampo(e.target.value)} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-text outline-none">
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border bg-surface">
        {DIAS.map((d) => (
          <div key={d} className="com-rotulo border-b border-border px-2 py-1.5">{d}</div>
        ))}
        {dias.map((d) => {
          const chave = iso(d);
          const doDia = porDia.get(chave) ?? [];
          const foraDoMes = d.getMonth() !== mes.getMonth();
          return (
            <div
              key={chave}
              onDragOver={(ev) => { if (arrastando) { ev.preventDefault(); setSobre(chave); } }}
              onDragLeave={() => setSobre((s) => (s === chave ? null : s))}
              onDrop={(ev) => { ev.preventDefault(); setSobre(null); soltar(chave); setArrastando(null); }}
              className={`group min-h-[6.5rem] border-b border-r border-border p-1.5 ${foraDoMes ? 'bg-surface-2/40' : ''} ${sobre === chave ? 'bg-brand/10' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`com-num text-xs ${chave === hoje ? 'rounded-full bg-brand px-1.5 text-ink' : foraDoMes ? 'text-muted/60' : 'text-muted'}`}>
                  {d.getDate()}
                </span>
                {pode && (
                  <button
                    onClick={() => { const t = window.prompt(`Nome do ${props.item} (${d.toLocaleDateString('pt-BR')}):`); if (t) void props.criar(t, { campoData: campo, dia: chave }); }}
                    className="text-xs text-muted opacity-0 hover:text-brand group-hover:opacity-100"
                    title={`Adicionar ${props.item} neste dia`}
                  >
                    +
                  </button>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {doDia.map((c) => {
                  const e = q.etapas.find((x) => x.id === c.statusId);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      draggable={pode}
                      onDragStart={() => setArrastando(c)}
                      onDragEnd={() => { setArrastando(null); setSobre(null); }}
                      onClick={() => abrirFicha(c.id)}
                      title={`${c.titulo} · ${e?.nome ?? ''}`}
                      className="cursor-pointer truncate rounded border-l-2 bg-surface-2 px-1.5 py-0.5 text-xs hover:bg-brand/15"
                      style={{ borderLeftColor: e?.cor }}
                    >
                      {c.titulo}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {semData.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          <div className="com-rotulo mb-2">Sem {opcoes.find((o) => o.id === campo)?.nome.toLowerCase()} · arraste para um dia</div>
          <div className="flex flex-wrap gap-2">
            {semData.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                draggable={pode}
                onDragStart={() => setArrastando(c)}
                onDragEnd={() => { setArrastando(null); setSobre(null); }}
                onClick={() => abrirFicha(c.id)}
                className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1 text-sm hover:border-brand/60"
              >
                {c.titulo}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
