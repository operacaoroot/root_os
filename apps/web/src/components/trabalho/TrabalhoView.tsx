'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Archive, Bot, Clock, ExternalLink, Flag, Hourglass, MessageSquare, Plus, Settings2, Unlock, X } from 'lucide-react';
import {
  MODELOS_DE_LISTA, MOEDA_PADRAO, ehValorMonetarioCanonico, formatarValorMonetario, lerValorDigitadoPtBr,
  moedaDoValor, paraDigitarPtBr,
} from '@mktos/shared';
import type {
  TrabAgenteDto, TrabEstrutura, TrabListaDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe,
} from '@mktos/shared';
import { apiBlob, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { tarefasDeTrabalho } from '@/lib/work-projection';
import { AtividadeDaTarefa } from './AtividadeDaTarefa';
import { EditorialTaskLink } from './EditorialTaskLink';
import { OrigemComercialDaTarefa } from '@/app/leads/OrigemComercialDaTarefa';
import { FontesDaTarefa } from './FontesDaTarefa';
import { ResponsavelDaTarefa, SeletorResponsavel, rotuloDaPessoa } from './ResponsavelDaTarefa';
import { diasDesde, formatarHoras, hojeEmBrasilia, minutosDeTexto } from '@/lib/horas';

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
const dataHoraBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * O NOME DO AGENTE QUE ESTÁ COM A TAREFA (fatia A4).
 *
 * Três estados, e a tela diz os três — nenhum deles é "vazio":
 *   · livre: ninguém travou, e é o normal;
 *   · nome: o agente desta empresa que assumiu;
 *   · "outro agente": o ponteiro não resolve nesta empresa (a API manda
 *     `agenteId` com `agenteNome` nulo). Inventar um nome aqui seria pior do que
 *     admitir que não sabemos de quem é — ver `work/agentes-da-casa.ts`.
 */
function nomeDoAgente(t: {
  agenteId: string | null;
  agenteNome: string | null;
}): string | null {
  if (!t.agenteId) return null;
  return t.agenteNome ?? 'outro agente';
}
const paraInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const deInputDate = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

/**
 * O dia que o `<input type="date">` de um campo personalizado `data` mostra.
 *
 * O valor chega em dois formatos: `AAAA-MM-DD`, gravado por esta gaveta, e o
 * instante ISO inteiro do importador do ClickUp (`2026-10-01T03:00:00.000Z`).
 * O input só aceita o primeiro e mostra VAZIO para o resto, e a gaveta, que
 * mandava ao sair o que estava no input, apagava a data importada sem ninguém
 * mexer. O dia sai pela regra de Início e Prazo (`paraInputDate`); o que nem
 * assim é um dia válido para o input vira vazio, para que vazio ao sair
 * continue querendo dizer "não mexi". O `Date.parse` só confere o calendário
 * (30/02 não passa), em UTC nas duas pontas: não converte fuso.
 */
function diaDoCampoData(valor: string | null): string {
  const dia = paraInputDate(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia.startsWith('0000')) return '';
  const t = Date.parse(dia);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === dia ? dia : '';
}

function mudarEndereco(listaId: string | null, tarefaId: string | null) {
  const url = new URL(window.location.href);
  if (listaId) url.searchParams.set('lista', listaId);
  else url.searchParams.delete('lista');
  if (tarefaId) url.searchParams.set('tarefa', tarefaId);
  else url.searchParams.delete('tarefa');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function TrabalhoView({ visaoInicial = 'board' }: { visaoInicial?: 'board' | 'tabela' }) {
  const { token, ready, can, user } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !can('tarefas.ver')) return <p className="text-muted">Sem permissão para ver tarefas.</p>;
  return <TrabalhoConteudo key={`${user?.id ?? ''}:${token}`} visaoInicial={visaoInicial} />;
}

function TrabalhoConteudo({ visaoInicial }: { visaoInicial: 'board' | 'tabela' }) {
  const { token, ready, can, user } = useAuth();
  const editable = can('tarefas.editar');
  const readable = can('tarefas.ver');
  const [erro, setErro] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [listaId, setListaId] = useState<string | null>(null);
  const [listaDoLinkAusente, setListaDoLinkAusente] = useState(false);
  const [visao, setVisao] = useState<'board' | 'tabela'>(visaoInicial);
  const [tarefas, setTarefas] = useState<TrabTarefaLista | null>(null);
  const [painelId, setPainelId] = useState<string | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [fAssignee, setFAssignee] = useState('');
  const [fPessoa, setFPessoa] = useState('');
  const [todasListas, setTodasListas] = useState(false);
  const [fAgente, setFAgente] = useState('');
  const [fBusca, setFBusca] = useState('');
  const [fOpcao, setFOpcao] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fArquivadas, setFArquivadas] = useState(false);
  const [fAtrasadas, setFAtrasadas] = useState(false);
  const [urlPronta, setUrlPronta] = useState(false);
  const listaAtual = useRef(listaId);
  listaAtual.current = listaId;
  const [bump, setBump] = useState(0);
  const [conflitoEtapa, setConflitoEtapa] = useState<{ titulo: string; etapa: string } | null>(null);
  const [salvandoEtapa, setSalvandoEtapa] = useState(false);
  const escritaEtapa = useRef(false);
  const recargaEtapa = useRef<number | null>(null);
  const refresh = useCallback(() => setBump((b) => b + 1), []);


  useEffect(() => {
    const ler = () => {
      const p = new URLSearchParams(window.location.search);
      setFAssignee(p.get('assignee') ?? ''); setFBusca(p.get('q') ?? '');
      setFPessoa(p.get('assigneeUserId') ?? (p.get('semResponsavel') === '1' ? 'sem-vinculo' : ''));
      setTodasListas(p.get('escopo') === 'pessoal' && !!p.get('assigneeUserId'));
      setFOpcao(p.get('opcao') ?? ''); setFAgente(p.get('agente') ?? '');
      setFStatus(p.get('statusId') ?? ''); setFArquivadas(p.get('arquivadas') === '1');
      setFAtrasadas(p.get('overdue') === '1');
      setVisao(p.get('escopo') === 'pessoal' && p.get('assigneeUserId') ? 'tabela' : p.get('visao') === 'board' ? 'board' : p.get('visao') === 'tabela' ? 'tabela' : visaoInicial);
      listaAtual.current = null; setListaId(null); setPainelId(null); setUrlPronta(true);
      setBump((b) => b + 1);
    };
    ler(); window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, [visaoInicial]);

  const filtroNoEndereco = (chave: string, valor: string) => {
    const url = new URL(window.location.href);
    if (valor) url.searchParams.set(chave, valor); else url.searchParams.delete(chave);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const filtrarPessoa = (id: string, geral = todasListas) => {
    setTodasListas(geral && !!id && id !== 'sem-vinculo');
    filtroNoEndereco('escopo', geral && !!id && id !== 'sem-vinculo' ? 'pessoal' : '');
    setFPessoa(id);
    // Filtros de vínculo substituem a busca antiga por texto.
    setFAssignee(''); filtroNoEndereco('assignee', '');
    filtroNoEndereco('assigneeUserId', id && id !== 'sem-vinculo' ? id : '');
    filtroNoEndereco('semResponsavel', id === 'sem-vinculo' ? '1' : '');
  };

  // Status e opção pertencem à lista; os demais filtros continuam ativos.
  const trocarLista = useCallback((id: string, anterior = listaAtual.current) => {
    if (anterior && anterior !== id) {
      setFOpcao(''); setFStatus('');
      const url = new URL(window.location.href);
      url.searchParams.delete('opcao'); url.searchParams.delete('statusId');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    listaAtual.current = id;
    setListaId(id);
  }, []);

  // estrutura (árvore, statuses, campos, tags, responsáveis)
  useEffect(() => {
    if (!ready || !token || !readable || !urlPronta) return;
    let ativa = true;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => {
        if (!ativa) return;
        setEstrutura(e);
        if (!listaAtual.current) {
          const todas = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas];
          const solicitada = new URLSearchParams(window.location.search).get('lista');
          const preferida = solicitada
            ? todas.find((l) => l.id === solicitada || l.externalId === solicitada)
            : todas.find((l) => l.externalId === '901328341442') ?? todas[0];
          setListaDoLinkAusente(!!solicitada && !preferida);
          if (preferida) trocarLista(preferida.id);
        }
      })
      .catch((e) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, bump, trocarLista]);

  // O ID do card é nativo e a API confere a empresa. O painel abre no mesmo
  // registro mesmo quando a URL traz uma lista antiga após ele ser movido.
  useEffect(() => {
    if (!estrutura || !token || !readable) return;
    const tarefaId = new URLSearchParams(window.location.search).get('tarefa');
    if (!tarefaId || !/^[0-9a-f-]{36}$/i.test(tarefaId)) return;
    let ativa = true;
    apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${tarefaId}`, token)
      .then((t) => {
        if (!ativa || new URLSearchParams(window.location.search).get('tarefa') !== tarefaId) return;
        setListaDoLinkAusente(false);
        trocarLista(t.listId, listaAtual.current ?? new URLSearchParams(window.location.search).get('lista'));
        setPainelId(t.id); mudarEndereco(t.listId, t.id);
      })
      .catch((e) => { if (ativa && new URLSearchParams(window.location.search).get('tarefa') === tarefaId) setErro(`Não foi possível abrir a tarefa do link: ${e.message}`); });
    return () => { ativa = false; };
  }, [estrutura, token, readable, trocarLista]);

  const moverEtapa = async (t: TrabTarefaResumo, statusId: string) => {
    if (!editable || escritaEtapa.current || conflitoEtapa || statusId === t.statusId) return;
    if (!t.updatedAt) { setErro('Recarregue a lista antes de alterar esta tarefa: a versão não está disponível.'); return; }
    escritaEtapa.current = true; setSalvandoEtapa(true);
    try {
      await apiPatch(`/trabalho/tarefas/${t.id}`, { statusId, expectedUpdatedAt: t.updatedAt }, token);
      refresh();
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        const todas = [...(estrutura?.folders.flatMap((f) => f.lists) ?? []), ...(estrutura?.listasSoltas ?? [])];
        const etapa = todas.find((l) => l.id === t.listId)?.statuses.find((st) => st.id === statusId)?.name ?? 'Etapa indisponível';
        setConflitoEtapa({ titulo: t.title, etapa });
      } else setErro((e as Error).message);
    } finally { escritaEtapa.current = false; setSalvandoEtapa(false); }
  };

  const selecionarLista = (id: string) => {
    setTodasListas(false); filtroNoEndereco('escopo', '');
    setListaDoLinkAusente(false); trocarLista(id); setPainelId(null); mudarEndereco(id, null);
  };
  const abrirTarefa = (id: string) => {
    const registro = tarefas?.items.find((tarefa) => tarefa.id === id);
    const listaDoRegistro = registro?.listId ?? listaId;
    if (registro) trocarLista(registro.listId);
    setPainelId(id); mudarEndereco(listaDoRegistro, id);
  };
  const fecharTarefa = () => { setPainelId(null); mudarEndereco(listaId, null); };

  const lista: TrabListaDto | null = useMemo(() => {
    if (!estrutura || !listaId) return null;
    return [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas].find((l) => l.id === listaId) ?? null;
  }, [estrutura, listaId]);

  // Resposta antiga nunca publica itens nem erros na consulta seguinte.
  useEffect(() => {
    setTarefas(null);
    if (!ready || !token || !readable || (!listaId && !todasListas) || !urlPronta) return;
    let ativa = true;
    setErro(null);
    const p = new URLSearchParams(todasListas ? {} : { listId: listaId! });
    if (fAssignee) p.set('assignee', fAssignee);
    if (fPessoa === 'sem-vinculo') p.set('semResponsavel', '1');
    else if (fPessoa) p.set('assigneeUserId', fPessoa);
    if (fBusca) p.set('q', fBusca);
    if (fOpcao && !todasListas) p.set('opcao', fOpcao);
    if (fStatus && !todasListas) p.set('statusId', fStatus);
    if (fArquivadas) p.set('arquivadas', '1');
    tarefasDeTrabalho(token, p, () => ativa)
      .then((r) => { if (ativa) {
        setTarefas(r);
        if (recargaEtapa.current === bump) { setConflitoEtapa(null); recargaEtapa.current = null; }
      } })
      .catch((e) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, listaId, todasListas, fAssignee, fPessoa, fBusca, fOpcao, fStatus, fArquivadas, bump]);

  const camposDaLista = useMemo(
    () => [...(lista?.fields ?? []), ...(estrutura?.camposGlobais ?? [])],
    [lista, estrutura],
  );

  // Agente e atraso filtram a coleção completa, após a última página.
  const visiveis = useMemo(() => {
    const itens = tarefas?.items ?? [];
    return itens.filter((t) => (!fAtrasadas || t.overdue) &&
      (!fAgente || (fAgente === 'livres' ? !t.agenteId : t.agenteSlug === fAgente)));
  }, [tarefas, fAgente, fAtrasadas]);

  if (ready && !readable) return <p className="text-muted">Sem permissão para ver tarefas.</p>;

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 lg:flex-row">
      {/* árvore: pastas → listas */}
      <aside className="max-h-44 w-full shrink-0 space-y-3 overflow-y-auto border-b border-border pb-2 pr-1 lg:max-h-none lg:w-52 lg:border-b-0 lg:pb-0">
        {estrutura?.folders.map((f) => (
          <div key={f.id}>
            <div title={f.name} className="break-words px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{f.name}</div>
            <div className="mt-1 space-y-0.5">
              {f.lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => selecionarLista(l.id)}
                  className={[
                    'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] transition',
                    l.id === listaId ? 'bg-brand/15 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                  ].join(' ')}
                >
                  <span title={l.name} className="min-w-0 break-words">{l.name}</span>
                  <span className="ml-1 text-[10px] text-muted">{l.total}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {/*
          LISTAS SEM PASTA também aparecem na árvore. Antes da esteira elas só
          existiam por importação; com o modelo, uma empresa sem pastas cria a
          lista solta — e ela sumiria da navegação se a árvore só desenhasse pastas.
        */}
        {estrutura && estrutura.listasSoltas.length > 0 && (
          <div>
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Sem pasta</div>
            <div className="mt-1 space-y-0.5">
              {estrutura.listasSoltas.map((l) => (
                <button
                  key={l.id}
                  onClick={() => selecionarLista(l.id)}
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
        )}
        {editable && estrutura && <NovaLista folders={estrutura.folders} token={token} onDone={refresh} onErro={setErro} />}
      </aside>

      {/* miolo */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{todasListas ? 'Tarefas da pessoa em todas as listas' : lista?.name ?? 'Trabalho'}</h1>
            <p className="text-sm text-muted">
              {!listaId && estrutura ? 'Selecione uma lista para ver as tarefas.' : tarefas ? `${visiveis.length} ${visiveis.length === 1 ? 'tarefa' : 'tarefas'}${visiveis.length !== tarefas.total ? ` de ${tarefas.total} na consulta` : ''}` : erro ? 'Consulta indisponível' : 'Carregando…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Buscar tarefas"
              value={fBusca}
              onChange={(e) => { setFBusca(e.target.value); filtroNoEndereco('q', e.target.value); }}
              placeholder="Buscar…"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
            <select aria-label="Filtrar por responsável" value={fPessoa} onChange={(e) => filtrarPessoa(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Todas as pessoas</option>
              <option value="sem-vinculo">Sem vínculo de pessoa</option>
              {(estrutura?.pessoas ?? []).map((pessoa) => <option key={pessoa.id} value={pessoa.id}>{rotuloDaPessoa(pessoa)}{!pessoa.isActive ? ' (inativo)' : ''}</option>)}
            </select>
            {user?.id && <button aria-pressed={fPessoa === user.id} onClick={() => { filtrarPessoa(user.id, true); setVisao('tabela'); filtroNoEndereco('visao', 'tabela'); }} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">Minhas tarefas</button>}
            <select aria-label="Filtrar por texto legado" value={fAssignee} onChange={(e) => {
                const texto = e.target.value;
                if (texto) { setFPessoa(''); setTodasListas(false); filtroNoEndereco('assigneeUserId', ''); filtroNoEndereco('semResponsavel', ''); filtroNoEndereco('escopo', ''); }
                setFAssignee(texto); filtroNoEndereco('assignee', texto);
              }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Texto legado: todos</option>
              {estrutura?.responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {/*
              O AGENTE É OUTRO EIXO, não o mesmo do responsável (fatia A4). O
              seletor acima filtra por quem RESPONDE pela tarefa; este, por quem
              a tem NA MÃO. Um seletor só faria as duas perguntas parecerem a
              mesma — e é a confusão que a fatia existe para desfazer.
            */}
            <select aria-label="Filtrar por agente" value={fAgente} onChange={(e) => { setFAgente(e.target.value); filtroNoEndereco('agente', e.target.value); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Todos os agentes</option>
              <option value="livres">Sem agente (livres)</option>
              {estrutura?.agentes.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.nome}{a.tarefas > 0 ? ` (${a.tarefas})` : ''}
                </option>
              ))}
            </select>
            {!todasListas && camposDaLista.filter((c) => c.type === 'drop_down' && c.options.length > 0).map((c) => (
              <select
                key={c.id}
                aria-label={`Filtrar por ${c.name}`}
                value={c.options.some((o) => o.id === fOpcao) ? fOpcao : ''}
                onChange={(e) => { setFOpcao(e.target.value); filtroNoEndereco('opcao', e.target.value); }}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
              >
                <option value="">{c.name}: todos</option>
                {c.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ))}
            <select disabled={todasListas} aria-label="Filtrar por status" value={fStatus} onChange={(e) => { setFStatus(e.target.value); filtroNoEndereco('statusId', e.target.value); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
              <option value="">Todos os status</option>
              {lista?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="text-sm text-muted"><input type="checkbox" checked={fArquivadas} onChange={(e) => { setFArquivadas(e.target.checked); filtroNoEndereco('arquivadas', e.target.checked ? '1' : ''); }} /> Incluir arquivadas</label>
            <label className="text-sm text-muted"><input type="checkbox" checked={fAtrasadas} onChange={(e) => { setFAtrasadas(e.target.checked); filtroNoEndereco('overdue', e.target.checked ? '1' : ''); }} /> Só atrasadas</label>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(['board', 'tabela'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { if (v === 'board') { setTodasListas(false); filtroNoEndereco('escopo', ''); } setVisao(v); filtroNoEndereco('visao', v); }}
                  aria-pressed={visao === v}
                  className={`px-3 py-1.5 text-sm capitalize ${visao === v ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {v === 'board' ? 'Quadro' : 'Tabela'}
                </button>
              ))}
            </div>
            {editable && lista && (
              <button
                onClick={() => setConfigAberta(true)}
                title="Configurar lista (etapas e campos)"
                className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-text"
              >
                <Settings2 size={15} />
              </button>
            )}
          </div>
        </div>

        {listaDoLinkAusente && <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">A lista deste link ainda não está disponível no seu quadro. Escolha uma das listas disponíveis.</p>}
        {erro && (
          <div className="flex items-center justify-between rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            <span>{erro}</span>
            <button onClick={refresh} className="underline">Recarregar lista</button>
            <button aria-label="Fechar erro" onClick={() => setErro(null)}><X size={14} /></button>
          </div>
        )}

        {conflitoEtapa && <div role="alert" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <p>Esta tarefa mudou desde que você abriu. Sua alteração não foi gravada.</p>
          <p className="font-medium">Alteração não salva</p>
          <dl className="text-xs"><dt>Tarefa</dt><dd>{conflitoEtapa.titulo}</dd><dt>Etapa</dt><dd>{conflitoEtapa.etapa}</dd></dl>
          <button className="underline" onClick={() => { recargaEtapa.current = bump + 1; refresh(); }}>Recarregar lista</button>
        </div>}
        {lista && tarefas && visao === 'board' && (
          <Board
            lista={lista} tarefas={visiveis} editable={editable && !conflitoEtapa && !salvandoEtapa} token={token}
            agentes={estrutura?.agentes ?? []}
            onAbrir={abrirTarefa} onMudou={refresh} onErro={setErro} onMoverEtapa={moverEtapa}
          />
        )}
        {tarefas && visao === 'tabela' && (
          <Tabela tarefas={visiveis} campos={todasListas ? [] : camposDaLista.map((c) => c.name)} onAbrir={abrirTarefa} />
        )}
      </div>

      {painelId && estrutura && (
        <PainelTarefa
          key={`${user?.id ?? ''}:${token}:${painelId}`} id={painelId} estrutura={estrutura} editable={editable && !conflitoEtapa} token={token} usuarioId={user?.id ?? null}
          onFechar={fecharTarefa} onMoverLista={(id) => { trocarLista(id); mudarEndereco(id, painelId); }}
          onMudou={refresh} onErro={setErro}
        />
      )}
      {configAberta && lista && (
        <ConfigLista lista={lista} token={token} onFechar={() => { setConfigAberta(false); refresh(); }} onErro={setErro} />
      )}
    </div>
  );
}

// ---------- board por status (colunas coloridas, quick-add por coluna) ----------

/**
 * O LIMITE DA ETAPA, no cabeçalho da coluna (esteira de clientes).
 *
 * `3/2` em vermelho quando passou, `2/2` em amarelo quando encheu, `1/2` neutro.
 * AVISA, NÃO TRAVA: o arraste para uma coluna cheia continua funcionando. O
 * limite é combinado do time; quem decide furar é a conversa de quinta, não um
 * erro no meio do arraste. A contagem é a das tarefas VISÍVEIS com os filtros —
 * o `title` diz isso para ninguém ler "1/2" filtrado como folga real.
 */
function ContagemDaEtapa({ quantas, limite }: { quantas: number; limite: number | null | undefined }) {
  if (limite == null) {
    return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{quantas}</span>;
  }
  const estado = quantas > limite ? 'passou' : quantas === limite ? 'cheia' : 'folga';
  const cor = estado === 'passou' ? 'bg-bad/15 text-bad' : estado === 'cheia' ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted';
  const dica = estado === 'passou'
    ? `Acima do limite: ${quantas} de ${limite}. Termine antes de puxar mais.`
    : `Limite de ${limite} ao mesmo tempo (contagem com os filtros aplicados).`;
  return (
    <span data-estado-limite={estado} title={dica} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cor}`}>
      {quantas}/{limite}
    </span>
  );
}

function Board({ lista, tarefas, editable, token, agentes, onAbrir, onMudou, onErro, onMoverEtapa }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; editable: boolean; token: string | null;
  agentes: TrabAgenteDto[];
  onAbrir: (id: string) => void; onMudou: () => void; onErro: (m: string) => void;
  onMoverEtapa: (t: TrabTarefaResumo, statusId: string) => Promise<void>;
}) {
  /*
   * ARRASTAR E SOLTAR com a API nativa do HTML5, sem biblioteca: dependência
   * nova é decisão humana (02-CONSTRAINTS). O `<select>` "Mover etapa" do cartão
   * continua lá — é o caminho do teclado e do celular, onde arrastar não existe.
   */
  const [sobre, setSobre] = useState<string | null>(null);
  const soltar = (statusId: string, e: React.DragEvent) => {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer.getData('text/plain');
    const t = tarefas.find((x) => x.id === id);
    if (!t || t.statusId === statusId) return;
    void onMoverEtapa(t, statusId);
  };
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {lista.statuses.map((st) => {
        const itens = tarefas.filter((t) => t.statusId === st.id);
        return (
          <div
            key={st.id}
            data-coluna={st.id}
            className={`w-72 shrink-0 rounded-lg transition ${sobre === st.id ? 'bg-brand/5 outline outline-1 outline-brand-dim' : ''}`}
            onDragOver={editable ? (e) => { e.preventDefault(); if (sobre !== st.id) setSobre(st.id); } : undefined}
            onDragLeave={editable ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null); } : undefined}
            onDrop={editable ? (e) => soltar(st.id, e) : undefined}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium capitalize">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                {st.name}
              </span>
              <ContagemDaEtapa quantas={itens.length} limite={st.limite} />
            </div>
            <div className="space-y-2">
              {itens.map((t) => (
                <Cartao key={t.id} t={t} lista={lista} editable={editable} token={token} agentes={agentes} onAbrir={onAbrir} onMudou={onMudou} onErro={onErro} onMoverEtapa={onMoverEtapa} />
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

function Cartao({ t, lista, editable, token, agentes, onAbrir, onMudou, onErro, onMoverEtapa }: {
  t: TrabTarefaResumo; lista: TrabListaDto; editable: boolean; token: string | null;
  agentes: TrabAgenteDto[];
  onAbrir: (id: string) => void; onMudou: () => void; onErro: (m: string) => void;
  onMoverEtapa: (t: TrabTarefaResumo, statusId: string) => Promise<void>;
}) {
  const pr = PRIORIDADES.find((p) => p.key === t.priority);
  const agente = nomeDoAgente(t);
  // Etapa fechada não envelhece: cliente encerrado não está "parado".
  const dias = t.statusType === 'closed' ? null : diasDesde(t.statusDesde);
  const minutos = t.minutos ?? 0;
  return (
    <div
      className="rounded-lg border border-border bg-surface p-3"
      data-work-task-id={t.id}
      draggable={editable}
      onDragStart={editable ? (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
    >
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
        <ResponsavelDaTarefa tarefa={t} />
        {t.dueDate && <span className={t.overdue ? 'text-bad' : ''}>{dataBR(t.dueDate)}</span>}
        {t.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={10} />{t.comments}</span>}
        {t.subtasks > 0 && <span>{t.subtasks} sub</span>}
      </div>
      {/*
        IDADE NA ETAPA E HORAS (esteira de clientes). A idade só aparece quando a
        data existe — tarefa anterior à esteira não tem, e "0d" seria mentira. Com
        14 dias ou mais na mesma etapa, o selo fica amarelo: é a pergunta "isto
        está parado?" respondida sem abrir a gaveta.
      */}
      {(dias !== null || minutos > 0) && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {dias !== null && (
            <span
              data-idade-dias={dias}
              title={`Nesta etapa desde ${dataHoraBR(t.statusDesde)}`}
              className={`flex items-center gap-0.5 ${dias >= 14 ? 'text-warn' : 'text-muted'}`}
            >
              <Hourglass size={10} />{dias}d na etapa
            </span>
          )}
          {minutos > 0 && (
            <span title="Horas apontadas nesta tarefa" className="flex items-center gap-0.5 text-muted">
              <Clock size={10} />{formatarHoras(minutos)}
            </span>
          )}
        </div>
      )}
      {/*
        QUEM ESTÁ COM A TAREFA, no cartão (fatia A4).
        O selo aparece só quando há agente: uma linha "sem agente" em toda
        tarefa livre seria ruído em cima do caso normal. O `title` diz desde
        quando — é o que responde "isto está parado?" sem abrir a gaveta.
      */}
      {agente && (
        <div
          className="mt-1.5 flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand"
          title={`Assumida por ${agente} em ${dataHoraBR(t.agenteEm)}`}
        >
          <Bot size={11} className="shrink-0" />
          <span className="truncate">{agente}</span>
        </div>
      )}
      {editable && (
        <ControleDoAgente t={t} agentes={agentes} token={token} onMudou={onMudou} onErro={onErro} />
      )}
      {editable && (
        <select
          value={t.statusId}
          onChange={(e) => { void onMoverEtapa(t, e.target.value); }}
          title="Mover etapa"
          className="mt-2 w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] outline-none focus:border-brand-dim"
        >
          {lista.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * ASSUMIR E SOLTAR, na tela (fatia A4).
 *
 * Duas coisas que esta peça faz de propósito:
 *
 *  1. AGENTE QUE NÃO TRABALHA APARECE DESABILITADO, não escondido. `podeAssumir`
 *     vem da API (quem sabe quais estados trabalham é `estado-do-agente.ts`) e a
 *     opção diz o estado ao lado do nome. Esconder faria a pessoa procurar um
 *     agente que existe; oferecer sem marcar faria ela descobrir a regra pelo
 *     409.
 *  2. O ERRO DA API APARECE COMO VEIO. A frase do 409 nomeia quem ficou com a
 *     tarefa, e reescrevê-la aqui ("não foi possível assumir") trocaria a única
 *     informação útil por educação. O quadro recarrega junto, então a pessoa vê
 *     o dono novo no mesmo instante em que lê o motivo.
 */
function ControleDoAgente({ t, agentes, token, onMudou, onErro }: {
  t: TrabTarefaResumo; agentes: TrabAgenteDto[]; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  const chamar = (caminho: string, corpo: Record<string, unknown>) => {
    setOcupado(true);
    apiPost(`/trabalho/tarefas/${t.id}/${caminho}`, corpo, token)
      .then(onMudou)
      .catch((e) => onErro(e.message))
      .finally(() => setOcupado(false));
  };

  if (t.agenteId) {
    return (
      <button
        disabled={ocupado}
        onClick={() => chamar('soltar', {})}
        title="Devolver a tarefa para a fila. Qualquer pessoa pode soltar — inclusive quando o agente travou e falhou."
        className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted transition hover:text-text disabled:opacity-50"
      >
        <Unlock size={10} /> Soltar
      </button>
    );
  }

  return (
    <select
      value=""
      disabled={ocupado || agentes.length === 0}
      onChange={(e) => e.target.value && chamar('assumir', { agente: e.target.value })}
      title="Entregar a um agente. Só um agente é dono da tarefa por vez."
      className="mt-2 w-full rounded border border-dashed border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted outline-none focus:border-brand-dim disabled:opacity-50"
    >
      <option value="">{agentes.length === 0 ? 'Nenhum agente nesta empresa' : 'Entregar a um agente…'}</option>
      {agentes.map((a) => (
        <option key={a.slug} value={a.slug} disabled={!a.podeAssumir}>
          {a.nome}{a.podeAssumir ? '' : ` — ${a.estado}, não assume`}
        </option>
      ))}
    </select>
  );
}

/**
 * O mesmo checkout, na gaveta da tarefa — com o que o cartão não tem espaço
 * para dizer: o nome de quem está com ela e DESDE QUANDO, em texto, não em
 * `title`. É a gaveta que alguém abre para decidir se solta.
 */
function ControleDoAgenteNaGaveta({ t, agentes, editable, token, onMudou, onErro }: {
  t: TrabTarefaDetalhe; agentes: TrabAgenteDto[]; editable: boolean; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const agente = nomeDoAgente(t);
  return (
    <div className="space-y-1">
      <div className="text-[13px]">
        {agente ? (
          <span className="flex items-center gap-1 text-brand">
            <Bot size={12} className="shrink-0" />
            {agente}
          </span>
        ) : (
          <span className="text-muted">Livre — nenhum agente assumiu</span>
        )}
      </div>
      {agente && (
        <div className="text-[11px] text-muted">desde {dataHoraBR(t.agenteEm)}</div>
      )}
      {editable && (
        <ControleDoAgente t={t} agentes={agentes} token={token} onMudou={onMudou} onErro={onErro} />
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

function Tabela({ tarefas, campos, onAbrir }: {
  tarefas: TrabTarefaResumo[]; campos: string[]; onAbrir: (id: string) => void;
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
            {/* Duas colunas, porque são dois eixos: quem responde e quem executa. */}
            <th className="px-3 py-2">Agente</th>
            <th className="px-3 py-2">Prazo</th>
            {campos.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {tarefas.map((t) => (
            <tr key={t.id} data-work-task-id={t.id} onClick={() => onAbrir(t.id)} className="cursor-pointer border-b border-border/50 hover:bg-surface-2/50">
              <td className="px-3 py-2"><button onClick={(e) => { e.stopPropagation(); onAbrir(t.id); }} className="text-left hover:text-brand focus-visible:outline-brand">{t.title}</button></td>
              <td className="px-3 py-2">
                <span className="rounded px-1.5 py-0.5 text-[11px] capitalize" style={{ background: `${t.statusColor}26`, color: t.statusColor }}>
                  {t.statusName}
                </span>
              </td>
              <td className="px-3 py-2 capitalize">{t.priority}</td>
              <td className="px-3 py-2"><ResponsavelDaTarefa tarefa={t} /></td>
              <td className="px-3 py-2" title={t.agenteId ? `Assumida em ${dataHoraBR(t.agenteEm)}` : undefined}>
                {nomeDoAgente(t) ?? '—'}
              </td>
              <td className={`px-3 py-2 ${t.overdue ? 'text-bad' : ''}`}>{dataBR(t.dueDate)}</td>
              {campos.map((c) => {
                const v = t.values.find((x) => x.fieldName === c);
                const valor = v?.type === 'moeda' && v.value ? formatarValorMonetario(v.value) : v?.value;
                return <td key={c} className="px-3 py-2 text-muted">{v?.optionName ?? valor ?? '—'}</td>;
              })}
            </tr>
          ))}
          {tarefas.length === 0 && (
            <tr><td colSpan={6 + campos.length} className="px-3 py-6 text-center text-muted">Nada por aqui.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- painel da tarefa (drawer): TODO campo editável ----------

function separarAnexos(description: string | null): {
  texto: string; sufixo: string; anexos: Array<{ nome: string; caminho: string }>;
} {
  const original = description ?? '';
  const marcador = 'Anexos preservados\n';
  const inicio = original.lastIndexOf(marcador);
  if (inicio < 0 || (inicio > 0 && !original.slice(0, inicio).endsWith('\n\n'))) {
    return { texto: original, sufixo: '', anexos: [] };
  }
  const linhas = original.slice(inicio + marcador.length).split('\n');
  const anexos = linhas.map((linha) => {
    const m = /^- \[([^\]]+)\]\((\/api\/trabalho\/arquivos\/[^/\s)]+\/[^/\s)]+)\)$/.exec(linha);
    return m ? { nome: m[1], caminho: m[2] } : null;
  }).filter((a): a is { nome: string; caminho: string } => !!a);
  return anexos.length === linhas.length
    ? { texto: original.slice(0, inicio).trimEnd(), sufixo: original.slice(inicio), anexos }
    : { texto: original, sufixo: '', anexos: [] };
}

function separarDependencias(description: string): {
  texto: string; sufixo: string; itens: Array<{ tipo: string; nome: string; href: string | null }>;
} {
  const marcador = 'Dependências preservadas\n';
  const inicio = description.lastIndexOf(marcador);
  if (inicio < 0 || (inicio > 0 && !description.slice(0, inicio).endsWith('\n\n'))) {
    return { texto: description, sufixo: '', itens: [] };
  }
  const linhas = description.slice(inicio + marcador.length).split('\n');
  const itens = linhas.map((linha) => {
    const link = /^- ([^:]+): \[([^\]]+)\]\((\/trabalho\?lista=[^\s)]+&tarefa=[0-9a-f-]{36})\)$/.exec(linha);
    if (link) return { tipo: link[1], nome: link[2], href: link[3] };
    const externo = /^- ([^:]+): (tarefa ClickUp .+ fora deste lote)$/.exec(linha);
    return externo ? { tipo: externo[1], nome: externo[2], href: null } : null;
  }).filter((item): item is { tipo: string; nome: string; href: string | null } => !!item);
  return itens.length === linhas.length
    ? { texto: description.slice(0, inicio).trimEnd(), sufixo: description.slice(inicio), itens }
    : { texto: description, sufixo: '', itens: [] };
}

function PainelTarefa({ id, estrutura, editable, token, usuarioId, onFechar, onMoverLista, onMudou, onErro }: {
  id: string; estrutura: TrabEstrutura; editable: boolean; token: string | null;
  /** Quem está logado — só o autor de um lançamento de horas vê o botão de apagar. */
  usuarioId: string | null;
  onFechar: () => void; onMoverLista: (id: string) => void;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const [t, setT] = useState<TrabTarefaDetalhe | null>(null);
  const [comentario, setComentario] = useState('');
  const [novaTag, setNovaTag] = useState('');
  const [edicaoDescricao, setEdicaoDescricao] = useState(false);
  const [descricaoRascunho, setDescricaoRascunho] = useState('');
  const [salvando, setSalvando] = useState(false);
  const escrita = useRef(false);
  const [conflito, setConflito] = useState<{ mudanca: Record<string, unknown>; recarregado: boolean; gravado?: boolean; indeterminado?: boolean } | null>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const fecharRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { focoAnterior.current = document.activeElement as HTMLElement; }, []);
  useEffect(() => setEdicaoDescricao(false), [id]);
  const leitura = useRef(0), operacao = useRef(0), ativo = useRef(true);
  const vigente = (epoch: number) => ativo.current && operacao.current === epoch;
  const recarregar = useCallback((epoch = operacao.current) => {
    if (!ativo.current || operacao.current !== epoch) return Promise.resolve(null);
    const atual = ++leitura.current;
    return apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${id}`, token)
      .then((t) => { if (ativo.current && operacao.current === epoch && atual === leitura.current) { setT(t); return t; } return null; })
      .catch((e) => {
        if (ativo.current && operacao.current === epoch && atual === leitura.current) {
          if ([401, 403, 404].includes(e?.status)) setT(null);
          onErro(e.message);
        }
        return null;
      });
  }, [id, token, onErro]);
  useEffect(() => {
    ativo.current = true; void recarregar();
    return () => { ativo.current = false; leitura.current += 1; operacao.current += 1; };
  }, [recarregar]);

  const todasListas = useMemo(
    () => [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas],
    [estrutura],
  );
  const lista = todasListas.find((l) => l.id === t?.listId);
  const campos = [...(lista?.fields ?? []), ...estrutura.camposGlobais];

  const salvar = async (mudanca: Record<string, unknown>) => {
    if (!ativo.current || !t || !editable || escrita.current || (conflito && !conflito.recarregado)) return false;
    if (!t.updatedAt || !Number.isFinite(Date.parse(t.updatedAt)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(t.updatedAt)) { onErro('Recarregue a tarefa antes de editar: a versão não está disponível.'); return false; }
    const epoch = ++operacao.current;
    escrita.current = true; setSalvando(true);
    try {
      await apiPatch(`/trabalho/tarefas/${id}`, { ...mudanca, expectedUpdatedAt: t.updatedAt }, token);
      if (!vigente(epoch)) return false;
      const atual = await recarregar(epoch);
      if (!vigente(epoch)) return false;
      if (!atual) { setConflito({ mudanca, recarregado: false, gravado: true }); onMudou(); return false; }
      setConflito(null); onMudou(); return true;
    } catch (e) {
      if (!vigente(epoch)) return false;
      const status = (e as { status?: number } | null)?.status;
      if (status === 409) setConflito((c) => ({ mudanca: { ...c?.mudanca, ...mudanca }, recarregado: false }));
      else {
        if (status && [401, 403, 404].includes(status)) setT(null);
        else if (status === undefined || status >= 500) setConflito({ mudanca, recarregado: false, indeterminado: true });
        onErro(e instanceof Error ? e.message : 'Não foi possível concluir a alteração.');
      }
      return false;
    } finally { if (vigente(epoch)) { escrita.current = false; setSalvando(false); } }
  };

  const moverLista = (destino: string) => {
    if (destino === t?.listId) return;
    const epoch = operacao.current + 1;
    void salvar({ listId: destino }).then((salvo) => { if (salvo && vigente(epoch)) onMoverLista(destino); });
  };
  const arquivar = async () => {
    const epoch = operacao.current + 1;
    if (await salvar({ archived: true }) && vigente(epoch)) onFechar();
  };

  const baixarAnexo = async (nome: string, caminho: string) => {
    try {
      const blob = await apiBlob(caminho.slice('/api'.length), token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { onErro((e as Error).message); }
  };

  const comentar = () => {
    if (!comentario.trim()) return;
    apiPost(`/trabalho/tarefas/${id}/comentarios`, { text: comentario.trim() }, token)
      .then(() => { setComentario(''); recarregar(); })
      .catch((e) => onErro(e.message));
  };

  const criarEAnexarTag = () => {
    if (!novaTag.trim() || !t || !editable || escrita.current || (conflito && !conflito.recarregado)) return;
    const existente = estrutura.tags.find((x) => x.name.toLowerCase() === novaTag.trim().toLowerCase());
    const anexar = (tagId: string) => salvar({ tagIds: [...t.tags.map((x) => x.id), tagId] }).then((salvo) => { if (salvo) setNovaTag(''); });
    if (existente) void anexar(existente.id);
    else {
      apiPost<{ id: string }>('/trabalho/tags', { name: novaTag.trim() }, token)
        .then((tag) => anexar(tag.id))
        .catch((e) => onErro(e.message));
    }
  };

  if (!t) return null;
  const ro = !editable || salvando || !!(conflito && !conflito.recarregado);
  const anexos = separarAnexos(t.description);
  const dependencias = separarDependencias(anexos.texto);
  const nomesListas = new Map([
    ...estrutura.folders.flatMap((f) => f.lists.map((l) => [l.id, `${f.name} / ${l.name}`] as const)),
    ...estrutura.listasSoltas.map((l) => [l.id, l.name] as const),
  ]);

  const rascunho = conflito ? Object.entries(conflito.mudanca).map(([campo, valor]) => {
    const rotulos: Record<string, string> = { title: 'Título', description: 'Descrição', statusId: 'Etapa', listId: 'Lista', assigneeUserId: 'Responsável', priority: 'Prioridade', dueDate: 'Prazo', startDate: 'Início', tagIds: 'Etiquetas', campos: 'Campos da tarefa', archived: 'Arquivamento' };
    let texto = campo === 'archived' ? valor ? 'Arquivar tarefa' : 'Restaurar tarefa' : valor == null ? 'Sem valor' : String(valor);
    if (campo === 'assigneeUserId') { const pessoa = estrutura.pessoas?.find((p) => p.id === valor); texto = valor == null ? 'Sem vínculo de pessoa' : pessoa ? rotuloDaPessoa(pessoa) : 'Pessoa indisponível'; }
    if (campo === 'statusId') texto = lista?.statuses.find((st) => st.id === valor)?.name ?? 'Etapa indisponível';
    if (campo === 'listId') texto = nomesListas.get(String(valor)) ?? 'Lista indisponível';
    if (campo === 'tagIds' && Array.isArray(valor)) texto = valor.map((tag) => estrutura.tags.find((tg) => tg.id === tag)?.name ?? 'Etiqueta indisponível').join(', ') || 'Sem etiquetas';
    if (campo === 'campos' && valor && typeof valor === 'object' && !Array.isArray(valor)) texto = Object.entries(valor).map(([fieldId, dado]) => {
      const field = campos.find((c) => c.id === fieldId);
      const v = dado as { optionId?: string | null; value?: string | null };
      return `${field?.name ?? 'Campo'}: ${field?.options.find((o) => o.id === v.optionId)?.name ?? v.value ?? 'Sem valor'}`;
    }).join('; ');
    return { campo, rotulo: rotulos[campo] ?? 'Alteração', texto };
  }) : [];

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto) onFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); fecharRef.current?.focus(); }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const destino = focoAnterior.current;
            if (destino?.isConnected && destino !== document.body) destino.focus();
            else document.getElementById('root-os-main')?.focus();
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l border-border bg-surface shadow-2xl"
        >
      <Dialog.Title className="sr-only">Detalhes da tarefa</Dialog.Title>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <input
          aria-label="Título da tarefa"
          key={t.updatedAt}
          defaultValue={t.title}
          disabled={ro}
          onBlur={(e) => e.target.value !== t.title && salvar({ title: e.target.value })}
          className="w-full bg-transparent text-sm font-semibold outline-none focus:text-brand"
        />
        <div className="flex shrink-0 items-center gap-1">
          {editable && !t.archived && (
            <button title="Arquivar" aria-label="Arquivar tarefa" disabled={ro} onClick={() => void arquivar()} className="p-1 text-muted hover:text-bad disabled:opacity-50">
              <Archive size={15} />
            </button>
          )}
          <button ref={fecharRef} aria-label="Fechar tarefa" onClick={onFechar} className="grid min-h-11 min-w-11 place-items-center text-muted hover:text-text focus-visible:outline-brand"><X size={16} /></button>
        </div>
      </div>

      <div key={t.updatedAt} className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        {conflito && <div role="alert" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <p>{conflito.indeterminado
            ? conflito.recarregado ? 'A versão atual foi carregada. Confira o resultado antes de decidir sobre a alteração abaixo.' : 'Não foi possível confirmar a alteração. Recarregue a tarefa antes de tentar novamente.'
            : conflito.gravado
            ? conflito.recarregado ? 'A versão atual foi carregada. A alteração gravada continua abaixo.' : 'A alteração foi gravada, mas não conseguimos ler a versão atual. Recarregue a tarefa antes de editar novamente.'
            : conflito.recarregado ? 'Confira a versão atual antes de editar novamente. Seu rascunho continua abaixo.' : 'Esta tarefa mudou desde que você abriu. Sua alteração não foi gravada.'}</p>
          <p className="font-medium">{conflito.indeterminado ? 'Alteração a conferir' : conflito.gravado ? 'Alteração gravada' : 'Alteração não salva'}</p>
          <dl className="space-y-1 text-xs">{rascunho.map((r) => <div key={r.campo}><dt className="font-medium">{r.rotulo}</dt><dd className="whitespace-pre-wrap break-words">{r.texto}</dd></div>)}</dl>
          <button className="underline disabled:opacity-50" disabled={salvando} onClick={async () => { const epoch = operacao.current; const atual = await recarregar(epoch); if (atual && vigente(epoch)) { setEdicaoDescricao(false); setConflito((c) => c ? { ...c, recarregado: true } : c); if (atual.listId !== t.listId) onMoverLista(atual.listId); onMudou(); } }}>Recarregar tarefa</button>
          <button className="ml-3 underline disabled:opacity-50" disabled={salvando || !conflito.recarregado} onClick={() => setConflito(null)}>Descartar alteração</button>
        </div>}
        <LinkDoTrilho taskId={t.id} token={token} />
        <FontesDaTarefa taskId={t.id} />
        <EditorialTaskLink taskId={t.id} />
        <OrigemComercialDaTarefa taskId={t.id} />
        {/* linha de propriedades — tudo editável */}
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Lista">
            <select disabled={ro} value={t.listId} onChange={(e) => moverLista(e.target.value)} className={INP}>
              {todasListas.map((l) => <option key={l.id} value={l.id}>{nomesListas.get(l.id)}</option>)}
            </select>
            {!ro && <p className="mt-1 text-[11px] text-muted">Mover mantém este card; a lista de destino define a primeira etapa.</p>}
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
          {/*
            DOIS CAMPOS, DOIS EIXOS (fatia A4). "Responsável (pessoa)" é quem
            responde pela tarefa; "Agente executor" é quem a tem na mão agora.
            O rótulo diz "(pessoa)" porque sem isso os dois campos lado a lado
            pareciam a mesma pergunta feita duas vezes.
          */}
          <Campo rotulo="Responsável (pessoa)">
            <SeletorResponsavel tarefa={t} pessoas={estrutura.pessoas ?? []} disabled={ro} onChange={(assigneeUserId) => salvar({ assigneeUserId })} />
          </Campo>
          <Campo rotulo="Responsável antigo (texto)">
            <p className="text-[13px] text-muted">{t.assignee ?? 'Sem registro antigo'}</p>
          </Campo>
          <Campo rotulo="Agente executor">
            {/*
              NÃO é `salvar({...})`: entregar a tarefa a um agente passa pelo
              CHECKOUT (`/assumir`), não pelo PATCH que edita campo. Um `PATCH
              agenteId` seria a escrita sem corrida que a fatia veio proibir —
              ela sobrescreveria o dono atual e devolveria sucesso.
            */}
            <ControleDoAgenteNaGaveta
              t={t} agentes={estrutura.agentes} editable={editable} token={token}
              onMudou={() => { recarregar(); onMudou(); }} onErro={onErro}
            />
          </Campo>
          {/*
            Sem mudança de dia, nada vai à API. Reenviar o mesmo dia como
            meio-dia local trocava o instante importado (em São Paulo, 03:00Z
            virava 15:00Z) e, com ele, a hora em que a tarefa passa a contar
            como vencida.
          */}
          <Campo rotulo="Início">
            <input type="date" disabled={ro} defaultValue={paraInputDate(t.startDate)} onBlur={(e) => e.target.value !== paraInputDate(t.startDate) && salvar({ startDate: deInputDate(e.target.value) })} className={INP} />
          </Campo>
          <Campo rotulo="Prazo">
            <input type="date" disabled={ro} defaultValue={paraInputDate(t.dueDate)} onBlur={(e) => e.target.value !== paraInputDate(t.dueDate) && salvar({ dueDate: deInputDate(e.target.value) })} className={INP} />
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
                if (c.type === 'data') {
                  // Só o dia que mudou vai à API, no `AAAA-MM-DD` de sempre;
                  // alterar e voltar ao dia gravado antes de sair não é edição.
                  const dia = diaDoCampoData(v?.value ?? null);
                  return (
                    <Campo key={c.id} rotulo={c.name}>
                      <input
                        type="date"
                        disabled={ro}
                        defaultValue={dia}
                        onBlur={(e) => e.target.value !== dia && salvar({ campos: { [c.id]: { value: e.target.value || null } } })}
                        className={INP}
                      />
                    </Campo>
                  );
                }
                if (c.type === 'moeda') {
                  // A gaveta mostra o canônico como se digita (`BRL 1500.00` vira
                  // `1.500,00`) e só vai à API com valor que mudou: texto igual ao
                  // da abertura ou a mesma quantia escrita de outro jeito não é
                  // edição. Digitação que não lê volta ao texto de antes, sem PATCH.
                  const gravado = v?.value ?? null;
                  const moeda = moedaDoValor(gravado) ?? MOEDA_PADRAO;
                  const inicial = ehValorMonetarioCanonico(gravado) ? paraDigitarPtBr(gravado) : (gravado ?? '');
                  return (
                    <Campo key={c.id} rotulo={c.name}>
                      <span className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">{moeda}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={ro}
                          defaultValue={inicial}
                          onBlur={(e) => {
                            const texto = e.target.value;
                            if (texto === inicial) return;
                            if (texto.trim() === '') {
                              if (gravado !== null) void salvar({ campos: { [c.id]: { value: null } } });
                              return;
                            }
                            const lido = lerValorDigitadoPtBr(texto, moeda);
                            if (lido.motivo !== undefined) {
                              e.target.value = inicial;
                              onErro(`${c.name}: ${lido.motivo}. Nada foi gravado.`);
                              return;
                            }
                            e.target.value = paraDigitarPtBr(lido.valor);
                            if (lido.valor !== gravado) void salvar({ campos: { [c.id]: { value: lido.valor } } });
                          }}
                          className={INP}
                        />
                      </span>
                    </Campo>
                  );
                }
                return (
                  <Campo key={c.id} rotulo={c.name}>
                    <input
                      disabled={ro}
                      type={c.type === 'numero' ? 'number' : 'text'}
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

        <HorasDaTarefa
          t={t} editable={editable} token={token} usuarioId={usuarioId}
          onMudou={() => { recarregar(); onMudou(); }} onErro={onErro}
        />

        {/* etiquetas */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Etiquetas</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {t.tags.map((tg) => (
              <span key={tg.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${tg.color}26`, color: tg.color }}>
                {tg.name}
                {!ro && (
                  <button onClick={() => salvar({ tagIds: t.tags.filter((x) => x.id !== tg.id).map((x) => x.id) })}>
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            {editable && (
              <input
                disabled={ro}
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Descrição e material vigente</div>
            {(edicaoDescricao || !ro) && <button type="button" disabled={ro} onClick={async () => {
              if (!edicaoDescricao) { setDescricaoRascunho(dependencias.texto); setEdicaoDescricao(true); return; }
              const novo = [descricaoRascunho.trimEnd(), dependencias.sufixo, anexos.sufixo].filter(Boolean).join('\n\n') || null;
              if (novo === t.description || await salvar({ description: novo })) setEdicaoDescricao(false);
            }} className="text-[11px] text-brand hover:underline">{edicaoDescricao ? 'Concluir edição' : 'Editar texto'}</button>}
          </div>
          {edicaoDescricao ? (
            <textarea
              aria-label="Descrição e material vigente"
              disabled={ro}
              value={descricaoRascunho}
              onChange={(e) => setDescricaoRascunho(e.target.value)}
              onBlur={(e) => {
                const novo = [e.target.value.trimEnd(), dependencias.sufixo, anexos.sufixo].filter(Boolean).join('\n\n') || null;
                if (novo !== t.description) salvar({ description: novo });
              }}
              rows={12}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
              placeholder="—"
            />
          ) : (
            <div className="max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] leading-6">
              {dependencias.texto || <span className="text-muted">Sem descrição.</span>}
            </div>
          )}
          {dependencias.itens.length > 0 && (
            <div className="mt-3 rounded-lg border border-border px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Dependências ({dependencias.itens.length})</div>
              <ul className="space-y-1">
                {dependencias.itens.map((item, i) => <li key={`${item.nome}:${i}`} className="break-words text-[13px]">
                  <span className="text-muted">{item.tipo}: </span>
                  {item.href ? <a href={item.href} className="text-brand hover:underline">{item.nome}</a> : item.nome}
                </li>)}
              </ul>
            </div>
          )}
          {anexos.anexos.length > 0 && (
            <div className="mt-3 rounded-lg border border-border px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Anexos preservados ({anexos.anexos.length})</div>
              <div className="space-y-1">
                {anexos.anexos.map((a) => (
                  <button key={a.caminho} type="button" onClick={() => void baixarAnexo(a.nome, a.caminho)}
                    className="block max-w-full break-all text-left text-[13px] text-brand hover:underline">
                    Baixar {a.nome}
                  </button>
                ))}
              </div>
            </div>
          )}
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

        <AtividadeDaTarefa taskId={t.id} token={token} userId={usuarioId} />

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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * HORAS DA TAREFA (esteira de clientes).
 *
 * Três decisões que a peça carrega:
 *  1. A ETAPA NÃO SE ESCOLHE. A hora cai na etapa atual da tarefa, e a tela diz
 *     isso no botão. Deixar escolher faria a soma por etapa ser ajustada à mão —
 *     e é o número que decide preço.
 *  2. A HORA SE DIGITA COMO SE FALA: "1,5", "1.5" ou "1:30". A conversão para
 *     minutos inteiros é da tela; a API só recebe inteiro.
 *  3. SÓ O AUTOR VÊ "APAGAR". A API recusa com 403 de qualquer jeito; esconder o
 *     botão evita oferecer um clique que vai dar erro.
 */
function HorasDaTarefa({ t, editable, token, usuarioId, onMudou, onErro }: {
  t: TrabTarefaDetalhe; editable: boolean; token: string | null; usuarioId: string | null;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const [horas, setHoras] = useState('');
  const [dia, setDia] = useState(hojeEmBrasilia());
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const apontamentos = t.apontamentos ?? [];
  const porEtapa = t.minutosPorEtapa ?? [];
  const minutos = minutosDeTexto(horas);

  const lancar = () => {
    if (minutos === null || enviando) return;
    setEnviando(true);
    apiPost(`/trabalho/tarefas/${t.id}/apontamentos`, { minutos, dia, nota: nota.trim() || null }, token)
      .then(() => { setHoras(''); setNota(''); onMudou(); })
      .catch((e) => onErro(e.message))
      .finally(() => setEnviando(false));
  };

  return (
    <div data-secao="horas">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Horas</span>
        <span className="text-[13px] font-semibold" data-total-minutos={t.minutos ?? 0}>
          {(t.minutos ?? 0) > 0 ? formatarHoras(t.minutos) : 'nenhuma apontada'}
        </span>
      </div>

      {porEtapa.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {porEtapa.map((e) => (
            <span key={e.etapa} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
              {e.etapa} · <span className="text-text">{formatarHoras(e.minutos)}</span>
            </span>
          ))}
        </div>
      )}

      {editable && (
        <div className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
          <div className="grid grid-cols-[5.5rem_1fr] gap-1.5">
            <input
              aria-label="Horas gastas"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lancar()}
              placeholder="1,5 ou 1:30"
              inputMode="decimal"
              className={INP}
            />
            <input aria-label="Dia" type="date" value={dia} max={hojeEmBrasilia()} onChange={(e) => setDia(e.target.value)} className={INP} />
          </div>
          <input
            aria-label="O que foi feito"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lancar()}
            placeholder="O que foi feito (opcional)"
            maxLength={500}
            className={INP}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {horas && minutos === null ? 'Hora inválida: de 1 minuto a 24h.' : `Entra na etapa ${t.statusName}.`}
            </span>
            <button
              onClick={lancar}
              disabled={minutos === null || enviando}
              className="shrink-0 rounded-lg bg-brand/15 px-3 py-1 text-[12px] text-brand enabled:hover:bg-brand/25 disabled:opacity-40"
            >
              {minutos !== null ? `Apontar ${formatarHoras(minutos)}` : 'Apontar'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {apontamentos.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-[11px] text-muted">
                {new Date(`${a.dia}T12:00:00`).toLocaleDateString('pt-BR')} · {a.autorNome} · {a.etapa}
              </div>
              <div className="text-[13px]">
                <span className="font-medium">{formatarHoras(a.minutos)}</span>
                {a.nota && <span className="text-muted"> — {a.nota}</span>}
              </div>
            </div>
            {editable && a.autorId !== null && a.autorId === usuarioId && (
              <button
                title="Apagar este lançamento"
                aria-label={`Apagar ${formatarHoras(a.minutos)} de ${a.dia}`}
                onClick={() => { void apiDelete(`/trabalho/apontamentos/${a.id}`, token).then(onMudou).catch((e) => onErro(e.message)); }}
                className="shrink-0 p-0.5 text-muted hover:text-bad"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
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
        <option value="">Sem pasta</option>
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
      {/*
        OU A PARTIR DE UM MODELO: etapas, limites e campos prontos. O nome
        digitado vale para o modelo também; vazio = o nome do modelo.
      */}
      <div className="border-t border-border pt-1.5">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">ou usar um modelo</div>
        {Object.values(MODELOS_DE_LISTA).map((m) => (
          <button
            key={m.chave}
            title={m.descricao}
            onClick={() =>
              apiPost('/trabalho/listas/modelo', { modelo: m.chave, folderId: pasta || null, name: nome.trim() || undefined }, token)
                .then(() => { setNome(''); setAberto(false); onDone(); })
                .catch((e) => onErro(e.message))
            }
            className="block w-full rounded px-1.5 py-1 text-left text-xs text-brand hover:bg-brand/10"
          >
            {m.nome}
            <span className="block text-[10px] text-muted">{m.descricao}</span>
          </button>
        ))}
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
              {/*
                LIMITE DE TRABALHO EM ANDAMENTO. Vazio = sem limite (manda `null`).
                Valor fora de 1..99 volta para o que estava: a API recusaria com
                400, e a caixa mostrando o número recusado seria uma tela mentindo.
              */}
              <input
                type="number" min={1} max={99}
                aria-label={`Limite de ${s.name}`}
                title="Limite de tarefas ao mesmo tempo nesta etapa (vazio = sem limite)"
                defaultValue={s.limite ?? ''}
                placeholder="∞"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const limite = v === '' ? null : Number(v);
                  if (limite !== null && !(Number.isInteger(limite) && limite >= 1 && limite <= 99)) {
                    e.target.value = s.limite == null ? '' : String(s.limite);
                    return;
                  }
                  if (limite !== (s.limite ?? null)) trata(apiPatch(`/trabalho/statuses/${s.id}`, { limite }, token));
                }}
                className="w-12 shrink-0 rounded border border-border bg-surface-2 px-1 py-1 text-center text-[11px] outline-none"
              />
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

/*
 * O trilho de onboarding pendurado neste cartão (23/09/2026). A esteira de
 * clientes é a VISTA de fora (fase por coluna); o trilho é a vista de dentro
 * (portões, propostas, link). Um cartão sem trilho mostra o caminho para criar.
 */
function LinkDoTrilho({ taskId, token }: { taskId: string; token: string | null }) {
  const [trilho, setTrilho] = useState<{ id: string; cliente: string; faseRotulo: string; faltando: string[] } | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    apiGet<{ id: string; cliente: string; faseRotulo: string; cardId: string | null; faltando: string[] }[]>(`/tenants/onboarding/trilhos?cardId=${encodeURIComponent(taskId)}`, token)
      .then((lista) => setTrilho(lista[0] ?? null))
      .catch(() => setTrilho(null));
  }, [taskId, token]);
  if (trilho === undefined) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
      {trilho ? (
        <a href={`/onboarding/${trilho.id}`} className="underline underline-offset-2">
          Trilho de onboarding · {trilho.faseRotulo}{trilho.faltando.length ? ` · falta ${trilho.faltando.length}` : ' · portão cumprido'}
        </a>
      ) : (
        <span className="text-muted">Sem trilho de onboarding. <a href="/onboarding" className="underline underline-offset-2">Criar na bancada</a> e ligar a este cartão.</span>
      )}
    </div>
  );
}
