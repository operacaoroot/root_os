'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Archive, Bot, Clock, DoorOpen, ExternalLink, Flag, Hourglass, MessageSquare, Plus, Settings2, Unlock, X } from 'lucide-react';
import {
  MODELOS_DE_LISTA, MOEDA_PADRAO, ehValorMonetarioCanonico, formatarValorMonetario, lerValorDigitadoPtBr,
  listaDaImplantacao, moedaDoValor, paraDigitarPtBr, LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO,
  DICA_DO_NOME_DA_TAREFA,
} from '@mktos/shared';
import type {
  VistaQuadro, TrabClienteDto, TrabAgenteDto, TrabEstrutura, TrabListaDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabEstruturaSugeridaResultado, TrabMovimentoDoCartao, TrabMovimentoDoQuadro,
} from '@mktos/shared';
import { apiBlob, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { tarefasDeTrabalho } from '@/lib/work-projection';
import { useTarefaNaUrl, type AbaDaTarefa } from '@/lib/tarefa-na-url';
import { BancadaDoTrilho } from '@/components/onboarding/BancadaDoTrilho';
import { SeletorDeCliente, type ClienteEscolhido } from './SeletorDeCliente';
import { VistasDoQuadro } from './VistasDoQuadro';
import { diasDesde, formatarHoras, hojeEmBrasilia, minutosDeTexto } from '@/lib/horas';
import {
  CHAVE_DA_DENSIDADE, DENSIDADES, DIAS_DE_ALERTA_NA_ETAPA, ESCOPOS, LARGURA_DA_COLUNA,
  ehMeu, haCurto, lerDensidade, lerEscopo, posicaoDoBalao, type Densidade, type Escopo,
} from '@/lib/quadro-denso';

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

/** O endereço sem a tarefa aberta: abrir e fechar o pop-up não é trocar de filtro. */
function assinaturaSemTarefa(): string {
  const p = new URLSearchParams(window.location.search);
  p.delete('tarefa'); p.delete('tarefaAba');
  return `${window.location.pathname}?${p.toString()}`;
}

function mudarEndereco(listaId: string | null, tarefaId: string | null) {
  const url = new URL(window.location.href);
  if (listaId) url.searchParams.set('lista', listaId);
  else url.searchParams.delete('lista');
  if (tarefaId) url.searchParams.set('tarefa', tarefaId);
  else url.searchParams.delete('tarefa');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/*
 * QUADRO E LISTA SÃO UMA TELA SÓ (rodada do painel P2, 18/10/2026). As duas
 * visões leem a MESMA fonte (`WorkTask`, por `/trabalho/tarefas`). Internamente
 * a visão de lista continua se chamando `tabela`, e `?visao=tabela` segue valendo
 * para não quebrar link antigo; o que a tela escreve agora é `?visao=lista`.
 */
type Visao = 'board' | 'tabela';
export type VisaoDoTrabalho = Visao | 'lista' | 'quadro';

/** `?visao=` do endereço → a visão. Valor desconhecido devolve `null` (vale a inicial). */
export function visaoDoEndereco(v: string | null): Visao | null {
  if (v === 'board' || v === 'quadro') return 'board';
  if (v === 'tabela' || v === 'lista') return 'tabela';
  return null;
}

/** `?pasta=`: vazio = todas; `sem-pasta` = só as listas soltas; senão o id da pasta de topo. */
export const PASTA_SEM_PASTA = 'sem-pasta';

/** A pasta e todas as que estão dentro dela, em qualquer nível. */
function pastaEDescendentes(folders: TrabEstrutura['folders'], raiz: string): Set<string> {
  const dentro = new Set([raiz]);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const f of folders) {
      if (f.parentId && dentro.has(f.parentId) && !dentro.has(f.id)) { dentro.add(f.id); mudou = true; }
    }
  }
  return dentro;
}

/**
 * `modo="implantacao"` (rodada do trabalho T1, 19/10/2026): o item "Implantação
 * de clientes" abre o kanban denso da lista "Onboarding de cliente" da pasta
 * "Clientes", em tela cheia (sem a árvore nem as pastas), e sem "+ adicionar":
 * o cliente nasce do contrato assinado no comercial.
 */
export type ModoDoTrabalho = 'trabalho' | 'implantacao';

export function TrabalhoView({ visaoInicial = 'board', modo = 'trabalho' }: { visaoInicial?: VisaoDoTrabalho; modo?: ModoDoTrabalho }) {
  const { token, ready, can } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !can('tarefas.ver')) return <p className="text-muted">Sem permissão para ver tarefas.</p>;
  return <TrabalhoConteudo key={`${token}:${modo}`} visaoInicial={visaoDoEndereco(visaoInicial) ?? 'board'} modo={modo} />;
}

/** As listas que a pasta escolhida mostra. Pasta que não existe (link velho) = todas. */
function listasDaPasta(e: TrabEstrutura, pasta: string): TrabListaDto[] {
  if (pasta === PASTA_SEM_PASTA) return e.listasSoltas;
  if (pasta && e.folders.some((f) => f.id === pasta)) {
    const dentro = pastaEDescendentes(e.folders, pasta);
    return e.folders.filter((f) => dentro.has(f.id)).flatMap((f) => f.lists);
  }
  return [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas];
}

/** O trilho de onboarding ligado a um cartão (`OnboardingTrilho.cardId`). */
interface TrilhoDoCartao { id: string; cliente: string; faseRotulo: string }

function TrabalhoConteudo({ visaoInicial, modo }: { visaoInicial: Visao; modo: ModoDoTrabalho }) {
  const implantacao = modo === 'implantacao';
  const { token, ready, can, user } = useAuth();
  const editable = can('tarefas.editar');
  const readable = can('tarefas.ver');
  const [erro, setErro] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [listaId, setListaId] = useState<string | null>(null);
  const [listaDoLinkAusente, setListaDoLinkAusente] = useState(false);
  const [semImplantacao, setSemImplantacao] = useState(false);
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  const [fPasta, setFPasta] = useState('');
  const [trilhos, setTrilhos] = useState<Map<string, TrilhoDoCartao>>(new Map());
  const [tarefas, setTarefas] = useState<TrabTarefaLista | null>(null);
  // O pop-up da tarefa mora na URL (rodada do trabalho T2): voltar do navegador fecha.
  const tarefaUrl = useTarefaNaUrl();
  const painelId = tarefaUrl.tarefaId;
  const filtrosLidos = useRef<string | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [fAssignee, setFAssignee] = useState('');
  const [fAgente, setFAgente] = useState('');
  const [fBusca, setFBusca] = useState('');
  const [fOpcao, setFOpcao] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCliente, setFCliente] = useState('');
  const [clientes, setClientes] = useState<TrabClienteDto[]>([]);
  const [fArquivadas, setFArquivadas] = useState(false);
  const [fEscopo, setFEscopo] = useState<Escopo>('todos');
  const [densidade, setDensidade] = useState<Densidade>('compacto');
  const [movimento, setMovimento] = useState<Map<string, TrabMovimentoDoCartao>>(new Map());
  const [urlPronta, setUrlPronta] = useState(false);
  const listaAtual = useRef(listaId);
  listaAtual.current = listaId;
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((b) => b + 1), []);


  useEffect(() => {
    const ler = () => {
      const p = new URLSearchParams(window.location.search);
      // Abrir e fechar o pop-up mexe só em `tarefa`/`tarefaAba`: o quadro não recarrega.
      const assinatura = assinaturaSemTarefa();
      if (filtrosLidos.current === assinatura) return;
      filtrosLidos.current = assinatura;
      setFAssignee(p.get('assignee') ?? ''); setFBusca(p.get('q') ?? '');
      setFOpcao(p.get('opcao') ?? ''); setFAgente(p.get('agente') ?? '');
      setFStatus(p.get('statusId') ?? ''); setFArquivadas(p.get('arquivadas') === '1'); setFCliente(p.get('cliente') ?? '');
      // `overdue=1` (o link antigo do "só atrasadas") continua valendo como o escopo "atrasados".
      setFEscopo(p.get('escopo') ? lerEscopo(p.get('escopo')) : p.get('overdue') === '1' ? 'atrasados' : 'todos');
      setVisao(visaoDoEndereco(p.get('visao')) ?? visaoInicial);
      setFPasta(p.get('pasta') ?? '');
      listaAtual.current = null; setListaId(null); setUrlPronta(true);
      setBump((b) => b + 1);
    };
    ler(); window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, [visaoInicial]);

  // A densidade é preferência da pessoa neste navegador (I2), não do link.
  useEffect(() => {
    try { setDensidade(lerDensidade(window.localStorage.getItem(CHAVE_DA_DENSIDADE))); } catch { /* sem armazenamento: padrão */ }
  }, []);
  const escolherDensidade = (d: Densidade) => {
    setDensidade(d);
    try { window.localStorage.setItem(CHAVE_DA_DENSIDADE, d); } catch { /* sem armazenamento: vale só nesta visita */ }
  };

  const filtroNoEndereco = (chave: string, valor: string) => {
    const url = new URL(window.location.href);
    if (valor) url.searchParams.set(chave, valor); else url.searchParams.delete(chave);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
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
        if (!listaAtual.current && implantacao) {
          const achada = listaDaImplantacao(e.folders);
          setSemImplantacao(!achada);
          if (achada) trocarLista(achada.listaId);
        } else if (!listaAtual.current) {
          const todas = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas];
          const endereco = new URLSearchParams(window.location.search);
          const solicitada = endereco.get('lista');
          // Com uma pasta escolhida e sem lista no link, abre a primeira lista dela.
          const daPasta = listasDaPasta(e, endereco.get('pasta') ?? '');
          const preferida = solicitada
            ? todas.find((l) => l.id === solicitada || l.externalId === solicitada)
            : daPasta.find((l) => l.externalId === '901328341442') ?? daPasta[0];
          setListaDoLinkAusente(!!solicitada && !preferida);
          if (preferida) trocarLista(preferida.id);
        }
      })
      .catch((e) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, bump, trocarLista, implantacao]);

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
        if (implantacao) return;
        trocarLista(t.listId, listaAtual.current ?? new URLSearchParams(window.location.search).get('lista'));
        mudarEndereco(t.listId, t.id);
      })
      .catch((e) => { if (ativa && new URLSearchParams(window.location.search).get('tarefa') === tarefaId) setErro(`Não foi possível abrir a tarefa do link: ${e.message}`); });
    return () => { ativa = false; };
  }, [estrutura, token, readable, trocarLista, implantacao]);

  /*
   * OS TRILHOS LIGADOS AOS CARTÕES (implantação aglutinada, rodada do painel P2).
   * O vínculo é `OnboardingTrilho.cardId`, gravado quando a bancada liga o trilho
   * a um cartão: nada de casar por nome de cliente. Uma consulta só para a tela
   * inteira; falhar só tira o atalho, nunca o quadro.
   */
  useEffect(() => {
    if (!ready || !token || !readable || !urlPronta) return;
    let ativa = true;
    apiGet<{ id: string; cliente: string; faseRotulo: string; cardId: string | null }[]>('/tenants/onboarding/trilhos', token)
      .then((lista) => {
        if (!ativa || !Array.isArray(lista)) return;
        setTrilhos(new Map(lista.filter((t) => t.cardId).map((t) => [t.cardId!, { id: t.id, cliente: t.cliente, faseRotulo: t.faseRotulo }])));
      })
      .catch(() => { /* sem o atalho; o quadro segue */ });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta]);

  // Os clientes do filtro (T4). Falhar só tira o filtro.
  useEffect(() => {
    if (!ready || !token || !readable) return;
    let ativa = true;
    apiGet<TrabClienteDto[]>('/trabalho/clientes', token)
      .then((r) => { if (ativa && Array.isArray(r)) setClientes(r); })
      .catch(() => { /* sem o filtro de cliente */ });
    return () => { ativa = false; };
  }, [ready, token, readable, bump]);

  const selecionarLista = (id: string) => {
    setListaDoLinkAusente(false); trocarLista(id); mudarEndereco(id, null);
  };

  const listasVisiveis = useMemo(() => (estrutura ? listasDaPasta(estrutura, fPasta) : []), [estrutura, fPasta]);
  const pastasDeTopo = useMemo(() => (estrutura?.folders ?? []).filter((f) => !f.parentId), [estrutura]);
  const pastasVisiveis = useMemo(() => {
    if (!estrutura) return [];
    if (fPasta === PASTA_SEM_PASTA) return [];
    if (fPasta && estrutura.folders.some((f) => f.id === fPasta)) {
      const dentro = pastaEDescendentes(estrutura.folders, fPasta);
      return estrutura.folders.filter((f) => dentro.has(f.id));
    }
    return estrutura.folders;
  }, [estrutura, fPasta]);
  const mostraSoltas = !fPasta || fPasta === PASTA_SEM_PASTA || !estrutura?.folders.some((f) => f.id === fPasta);

  /** Trocar de pasta mantém a lista aberta se ela é da pasta; senão abre a primeira da pasta. */
  const selecionarPasta = (pasta: string) => {
    setFPasta(pasta); filtroNoEndereco('pasta', pasta);
    if (!estrutura) return;
    const daPasta = listasDaPasta(estrutura, pasta);
    if (listaId && daPasta.some((l) => l.id === listaId)) return;
    if (daPasta[0]) { selecionarLista(daPasta[0].id); return; }
    listaAtual.current = null; setListaId(null); mudarEndereco(null, null);
  };
  // O endereço de quando o pop-up abriu: o voltar que o fecha cai nele e o quadro não recarrega.
  const abrirTarefa = (id: string, aba?: AbaDaTarefa) => { filtrosLidos.current = assinaturaSemTarefa(); tarefaUrl.abrir(id, aba); };
  const fecharTarefa = tarefaUrl.fechar;

  const lista: TrabListaDto | null = useMemo(() => {
    if (!estrutura || !listaId) return null;
    return [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas].find((l) => l.id === listaId) ?? null;
  }, [estrutura, listaId]);

  // Resposta antiga nunca publica itens nem erros na consulta seguinte.
  useEffect(() => {
    setTarefas(null);
    if (!ready || !token || !readable || !listaId || !urlPronta) return;
    let ativa = true;
    setErro(null);
    const p = new URLSearchParams({ listId: listaId });
    if (fAssignee) p.set('assignee', fAssignee);
    if (fBusca) p.set('q', fBusca);
    if (fOpcao) p.set('opcao', fOpcao);
    if (fStatus) p.set('statusId', fStatus);
    if (fCliente) p.set('cliente', fCliente);
    if (fArquivadas) p.set('arquivadas', '1');
    tarefasDeTrabalho(token, p, () => ativa)
      .then((r) => { if (ativa) setTarefas(r); })
      .catch((e) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, listaId, fAssignee, fBusca, fOpcao, fStatus, fCliente, fArquivadas, bump]);

  /*
   * O MOVIMENTO DOS CARTÕES (I2): rodapé, balão, próxima ação e selo. Uma
   * leitura por lista aberta no quadro; falhar só tira o rodapé.
   */
  useEffect(() => {
    if (!ready || !token || !readable || !listaId || !urlPronta || visao !== 'board') return;
    let ativa = true;
    apiGet<TrabMovimentoDoQuadro>(`/trabalho/quadro/movimento?listId=${encodeURIComponent(listaId)}`, token)
      .then((r) => {
        if (!ativa) return;
        const itens = Array.isArray(r?.itens) ? r.itens : [];
        setMovimento(new Map(itens.map((i) => [i.tarefaId, i])));
      })
      .catch(() => { if (ativa) setMovimento(new Map()); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, listaId, visao, bump]);

  const camposDaLista = useMemo(
    () => [...(lista?.fields ?? []), ...(estrutura?.camposGlobais ?? [])],
    [lista, estrutura],
  );

  // Agente, atraso e "meus" filtram a coleção completa, após a última página.
  const visiveis = useMemo(() => {
    const itens = tarefas?.items ?? [];
    return itens.filter((t) => (fEscopo !== 'atrasados' || t.overdue) &&
      (fEscopo !== 'meus' || ehMeu(t.assignee, user?.name)) &&
      (!fAgente || (fAgente === 'livres' ? !t.agenteId : t.agenteSlug === fAgente)));
  }, [tarefas, fAgente, fEscopo, user?.name]);

  if (ready && !readable) return <p className="text-muted">Sem permissão para ver tarefas.</p>;

  // A lista da implantação não recebe cartão solto, em nenhuma tela (a API também recusa).
  const listaEhImplantacao = !!lista && !!estrutura && listaDaImplantacao(estrutura.folders)?.listaId === lista.id;
  const pastaDaLista = lista && estrutura ? estrutura.folders.find((f) => f.lists.some((l) => l.id === lista.id))?.id ?? '' : '';

  return (
    <div className={`flex h-full min-w-0 flex-col gap-3 ${visao === 'board' && lista ? 'md:h-[calc(100dvh-52px-2rem)] min-[820px]:h-[calc(100dvh-46px-3rem)]' : ''}`}>
      {estrutura && !implantacao && (
        <BarraDePastas
          pastas={pastasDeTopo} temSoltas={estrutura.listasSoltas.length > 0} atual={fPasta}
          semPastas={estrutura.folders.length === 0} editable={editable} token={token}
          onEscolher={selecionarPasta} onMudou={refresh} onErro={setErro}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* árvore: pastas → listas (só as da pasta escolhida no topo) */}
      {!implantacao && (
      <aside className="max-h-44 w-full shrink-0 space-y-3 overflow-y-auto border-b border-border pb-2 pr-1 lg:max-h-none lg:w-52 lg:border-b-0 lg:pb-0">
        {pastasVisiveis.map((f) => (
          <div key={f.id}>
            <div title={f.name} className="break-words px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{f.name}</div>
            <div className="mt-1 space-y-0.5">
              {f.lists.length === 0 && <p className="px-2 text-[11px] text-muted">Pasta vazia. Crie uma lista nela ou mova uma para cá.</p>}
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
        {estrutura && mostraSoltas && estrutura.listasSoltas.length > 0 && (
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
        {editable && estrutura && (
          <NovaLista
            key={fPasta} folders={estrutura.folders} token={token} onDone={refresh} onErro={setErro}
            pastaInicial={fPasta === PASTA_SEM_PASTA ? '' : estrutura.folders.some((f) => f.id === fPasta) ? fPasta : undefined}
          />
        )}
        {estrutura && listasVisiveis.length === 0 && (
          <p className="px-1 text-[12px] text-muted">Nenhuma lista {fPasta ? 'nesta pasta' : 'ainda'}.</p>
        )}
      </aside>
      )}

      {/* miolo: no quadro ele é coluna flexível, para as colunas terem a altura da janela e rolarem cada uma */}
      <div className={`min-w-0 flex-1 ${visao === 'board' && lista ? 'flex min-h-0 flex-col gap-3' : 'space-y-4'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{implantacao ? 'Implantação de clientes' : lista?.name ?? 'Trabalho'}</h1>
            <p className="text-sm text-muted">
              {implantacao && lista ? `${PASTA_DA_IMPLANTACAO} · ${lista.name} · ` : ''}
              {!listaId && estrutura ? 'Selecione uma lista para ver as tarefas.' : tarefas ? `${visiveis.length} ${visiveis.length === 1 ? 'tarefa' : 'tarefas'}${visiveis.length !== tarefas.total ? ` de ${tarefas.total} na consulta` : ''}` : erro ? 'Consulta indisponível' : 'Carregando…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Buscar tarefas"
              value={fBusca}
              onChange={(e) => { setFBusca(e.target.value); filtroNoEndereco('q', e.target.value); }}
              placeholder="Buscar cliente…"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
            <select aria-label="Filtrar por responsável" value={fAssignee} onChange={(e) => { setFAssignee(e.target.value); filtroNoEndereco('assignee', e.target.value); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Todos os responsáveis</option>
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
            {camposDaLista.filter((c) => c.type === 'drop_down' && c.options.length > 0).map((c) => (
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
            <select aria-label="Filtrar por cliente" data-testid="trabalho-filtro-cliente" value={fCliente} onChange={(e) => { setFCliente(e.target.value); filtroNoEndereco('cliente', e.target.value); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none">
              <option value="">Todos os clientes</option>
              <option value="sem">Sem cliente (para limpar)</option>
              {clientes.filter((c) => c.id !== 'interno').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select aria-label="Filtrar por status" value={fStatus} onChange={(e) => { setFStatus(e.target.value); filtroNoEndereco('statusId', e.target.value); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
              <option value="">Todos os status</option>
              {lista?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="text-sm text-muted"><input type="checkbox" checked={fArquivadas} onChange={(e) => { setFArquivadas(e.target.checked); filtroNoEndereco('arquivadas', e.target.checked ? '1' : ''); }} /> Incluir arquivadas</label>
            <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Quais tarefas">
              {ESCOPOS.map((e) => (
                <button
                  key={e.chave}
                  type="button"
                  data-testid={`trabalho-escopo-${e.chave}`}
                  aria-pressed={fEscopo === e.chave}
                  onClick={() => { setFEscopo(e.chave); filtroNoEndereco('escopo', e.chave === 'todos' ? '' : e.chave); filtroNoEndereco('overdue', ''); }}
                  className={`px-2.5 py-1.5 text-sm max-md:min-h-[44px] ${fEscopo === e.chave ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {e.rotulo}
                </button>
              ))}
            </div>
            {/* T3: a vista salva do quadro (filtros, densidade e visão), por pessoa, no servidor. */}
            <VistasDoQuadro
              token={token}
              enderecoTemFiltro={['assignee', 'q', 'opcao', 'agente', 'statusId', 'escopo', 'overdue', 'cliente', 'visao'].some((k) => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(k))}
              atual={{ densidade, visao, filtros: { assignee: fAssignee, agente: fAgente, statusId: fStatus, cliente: fCliente, escopo: fEscopo, q: fBusca } }}
              aplicar={(v: VistaQuadro) => {
                escolherDensidade(v.densidade); setVisao(v.visao);
                setFAssignee(v.filtros.assignee); setFAgente(v.filtros.agente); setFStatus(v.filtros.statusId);
                setFCliente(v.filtros.cliente); setFEscopo(v.filtros.escopo); setFBusca(v.filtros.q);
                const url = new URL(window.location.href);
                for (const [k, val] of [['assignee', v.filtros.assignee], ['agente', v.filtros.agente], ['statusId', v.filtros.statusId], ['cliente', v.filtros.cliente], ['escopo', v.filtros.escopo === 'todos' ? '' : v.filtros.escopo], ['q', v.filtros.q], ['visao', v.visao === 'board' ? '' : 'lista']] as const) {
                  if (val) url.searchParams.set(k, val); else url.searchParams.delete(k);
                }
                window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
              }}
            />
            {/* Quadro e Lista: a mesma fonte (WorkTask), duas formas de ver. */}
            <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Visão das tarefas">
              {(['board', 'tabela'] as const).map((v) => (
                <button
                  key={v}
                  data-testid={v === 'board' ? 'trabalho-visao-quadro' : 'trabalho-visao-lista'}
                  onClick={() => { setVisao(v); filtroNoEndereco('visao', v === 'board' ? 'board' : 'lista'); }}
                  aria-pressed={visao === v}
                  className={`px-3 py-1.5 text-sm ${visao === v ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {v === 'board' ? 'Quadro' : 'Lista'}
                </button>
              ))}
            </div>
            {visao === 'board' && (
              <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Densidade do quadro">
                {DENSIDADES.map((d) => (
                  <button
                    key={d.chave}
                    type="button"
                    data-testid={`trabalho-densidade-${d.chave}`}
                    aria-pressed={densidade === d.chave}
                    onClick={() => escolherDensidade(d.chave)}
                    className={`px-2.5 py-1.5 font-os-mono text-[11px] max-md:min-h-[44px] ${densidade === d.chave ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                  >
                    {d.rotulo}
                  </button>
                ))}
              </div>
            )}
            {/* A lista da implantação não muda de pasta (a API também recusa). */}
            {editable && lista && estrutura && !listaEhImplantacao && (
              <SeletorDePastaDaLista
                valor={pastaDaLista}
                pastas={estrutura.folders}
                onMover={(folderId) =>
                  apiPatch(`/trabalho/listas/${lista.id}`, { folderId: folderId || null }, token)
                    .then(refresh).catch((er) => setErro(er.message))
                }
              />
            )}
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

        {implantacao && semImplantacao && (
          <p role="status" data-testid="implantacao-sem-lista" className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            A lista {LISTA_DA_IMPLANTACAO} da pasta {PASTA_DA_IMPLANTACAO} ainda não existe nesta empresa. Ela nasce com o primeiro contrato fechado no comercial, ou pela estrutura sugerida em Tarefas.
          </p>
        )}
        {listaEhImplantacao && editable && (
          <p className="text-[12px] text-muted" data-testid="implantacao-porta">{PORTA_DA_IMPLANTACAO}</p>
        )}
        {listaDoLinkAusente && <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">A lista deste link ainda não está disponível no seu quadro. Escolha uma das listas disponíveis.</p>}
        {erro && (
          <div className="flex items-center justify-between rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            <span>{erro}</span>
            <button onClick={() => setErro(null)}><X size={14} /></button>
          </div>
        )}

        {lista && tarefas && visao === 'board' && (
          <Board
            lista={lista} tarefas={visiveis} editable={editable} podeCriar={editable && !listaEhImplantacao} token={token}
            agentes={estrutura?.agentes ?? []} trilhos={trilhos} movimento={movimento} densidade={densidade}
            onAbrir={abrirTarefa} onMudou={refresh} onErro={setErro}
          />
        )}
        {lista && tarefas && visao === 'tabela' && (
          <Tabela lista={lista} tarefas={visiveis} campos={camposDaLista.map((c) => c.name)} trilhos={trilhos} onAbrir={abrirTarefa} />
        )}
      </div>
      </div>

      {painelId && estrutura && (
        <PainelTarefa
          key={`${token}:${painelId}`} id={painelId} estrutura={estrutura} editable={editable} token={token} usuarioId={user?.id ?? null}
          aba={tarefaUrl.aba} onTrocarAba={tarefaUrl.trocarAba}
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

/*
 * O QUADRO DENSO (rodada da implantação I2, 18/10/2026). Vale para a visão
 * Quadro do Trabalho inteira; a Implantação é o caso de prova.
 *
 *  · COLUNAS NUMA LINHA SÓ, COM LARGURA FIXA, E O QUADRO ROLA PARA O LADO
 *    (rodada do trabalho T1, 19/10/2026: "não faz sentido ter coluna na parte
 *    de baixo"). `overflow-x: auto` com a barra visível; a roda com Shift e o
 *    arrasto do trackpad rolam de lado. Nunca quebra coluna para baixo. Os
 *    chips de etapa no topo levam até a coluna, como no funil. A coluna de
 *    saída (etapa fechada) fica esmaecida.
 *  · ROLAGEM POR COLUNA: cada uma tem o próprio `overflow-y` e a altura da
 *    janela; a página não rola inteira (o mesmo arranjo do funil do comercial).
 *    No celular as colunas viram uma faixa com encaixe, uma por vez.
 *  · O CARTÃO INTEIRO ABRE: o título é um botão cujo `::after` cobre o cartão
 *    (o "link esticado"). O nome acessível continua sendo o título, o Tab para
 *    nele e o Enter abre; o que é ação dentro do cartão fica acima da capa
 *    (`relative z-10`) e não abre o painel.
 *  · PARAR O MOUSE OU FOCAR mostra o balão com os três últimos passos e o
 *    último comentário, posicionado sem sair da tela, ligado por
 *    `aria-describedby` e fechado com Esc.
 *  · O RODAPÉ é a última movimentação ou o último comentário, da MESMA leitura
 *    da caixa de entrada (`GET /trabalho/quadro/movimento`). Falhar ali só tira
 *    o rodapé.
 */
function Board({ lista, tarefas, editable, podeCriar, token, agentes, trilhos, movimento, densidade, onAbrir, onMudou, onErro }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; editable: boolean; podeCriar: boolean; token: string | null;
  agentes: TrabAgenteDto[]; trilhos: Map<string, TrilhoDoCartao>;
  movimento: Map<string, TrabMovimentoDoCartao>; densidade: Densidade;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  /*
   * ARRASTAR E SOLTAR com a API nativa do HTML5, sem biblioteca: dependência
   * nova é decisão humana (02-CONSTRAINTS). O `<select>` "Mover etapa" do cartão
   * (densidade cheia) e o do painel continuam sendo o caminho do teclado e do
   * celular, onde arrastar não existe.
   */
  const [sobre, setSobre] = useState<string | null>(null);
  const [balao, setBalao] = useState<{ id: string; ancora: DOMRect } | null>(null);
  const [ultimoCliente, setUltimoCliente] = useState<ClienteEscolhido | null>(null);
  const soltar = (statusId: string, e: React.DragEvent) => {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer.getData('text/plain');
    const t = tarefas.find((x) => x.id === id);
    if (!t || t.statusId === statusId) return;
    apiPatch(`/trabalho/tarefas/${id}`, { statusId }, token).then(onMudou).catch((er) => onErro(er.message));
  };
  useEffect(() => {
    if (!balao) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setBalao(null); };
    const sumir = () => setBalao(null);
    document.addEventListener('keydown', fechar);
    window.addEventListener('scroll', sumir, true);
    return () => { document.removeEventListener('keydown', fechar); window.removeEventListener('scroll', sumir, true); };
  }, [balao]);
  const tarefaDoBalao = balao ? tarefas.find((t) => t.id === balao.id) ?? null : null;
  const rolagem = useRef<HTMLDivElement>(null);
  const irParaColuna = (statusId: string) => {
    const alvo = rolagem.current?.querySelector<HTMLElement>(`[data-coluna="${statusId}"]`);
    alvo?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
    <nav aria-label="Ir para a etapa" data-testid="trabalho-chips-de-etapa" className="flex shrink-0 gap-1 overflow-x-auto pb-0.5">
      {lista.statuses.map((st) => (
        <button
          key={st.id}
          type="button"
          onClick={() => irParaColuna(st.id)}
          className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-os-mono text-[10.5px] text-muted hover:border-brand-dim hover:text-text max-md:min-h-[44px]"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
          {st.name}
          <span className="tabular-nums">{tarefas.filter((t) => t.statusId === st.id).length}</span>
        </button>
      ))}
    </nav>
    <div
      ref={rolagem}
      data-testid="trabalho-quadro"
      data-densidade={densidade}
      tabIndex={0}
      aria-label={`Quadro de ${lista.name}: role para o lado para ver todas as etapas`}
      className="quadro-rolagem-lateral flex min-h-0 flex-1 snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2 outline-none focus-visible:ring-2 focus-visible:ring-brand md:snap-none"
      style={{ '--largura-da-coluna': `${LARGURA_DA_COLUNA[densidade]}px` } as React.CSSProperties}
    >
      {lista.statuses.map((st) => {
        const itens = tarefas.filter((t) => t.statusId === st.id);
        const saida = st.type === 'closed';
        return (
          <section
            key={st.id}
            data-coluna={st.id}
            aria-label={`${st.name}: ${itens.length} ${itens.length === 1 ? 'tarefa' : 'tarefas'}`}
            className={`flex w-[86%] min-w-0 shrink-0 grow-0 snap-start flex-col rounded border bg-bg2 max-md:max-h-[72dvh] md:w-[var(--largura-da-coluna)] md:min-h-0 ${sobre === st.id ? 'border-brand' : 'border-border'} ${saida ? 'opacity-60 focus-within:opacity-100 hover:opacity-100' : ''}`}
            onDragOver={editable ? (e) => { e.preventDefault(); if (sobre !== st.id) setSobre(st.id); } : undefined}
            onDragLeave={editable ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null); } : undefined}
            onDrop={editable ? (e) => soltar(st.id, e) : undefined}
          >
            <header className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-2 py-1.5">
              <span className="flex min-w-0 items-center gap-1.5 font-os-mono text-[11px] uppercase tracking-wide">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: st.color }} />
                <span className="truncate" title={st.name}>{st.name}</span>
              </span>
              <span className="font-os-mono"><ContagemDaEtapa quantas={itens.length} limite={st.limite} /></span>
            </header>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5" data-rolagem-da-coluna>
              {itens.map((t) => (
                <Cartao
                  key={t.id} t={t} lista={lista} editable={editable} token={token} agentes={agentes}
                  trilho={trilhos.get(t.id) ?? null} mov={movimento.get(t.id) ?? null} densidade={densidade}
                  balaoAberto={balao?.id === t.id}
                  onBalao={(ancora) => setBalao(ancora ? { id: t.id, ancora } : null)}
                  onAbrir={(id, aba) => { setBalao(null); onAbrir(id, aba); }} onMudou={onMudou} onErro={onErro}
                />
              ))}
              {podeCriar && <QuickAdd listaId={lista.id} statusId={st.id} token={token} clienteInicial={ultimoCliente} onCliente={setUltimoCliente} onDone={onMudou} onErro={onErro} />}
              {itens.length === 0 && !editable && <p className="px-1 text-xs text-muted">Nada nesta etapa.</p>}
            </div>
          </section>
        );
      })}
      {balao && tarefaDoBalao && (
        <BalaoDoCartao t={tarefaDoBalao} mov={movimento.get(balao.id) ?? null} ancora={balao.ancora} />
      )}
    </div>
    </div>
  );
}

const ATRASO_DO_BALAO_MS = 350;

function Cartao({ t, lista, editable, token, agentes, trilho, mov, densidade, balaoAberto, onBalao, onAbrir, onMudou, onErro }: {
  t: TrabTarefaResumo; lista: TrabListaDto; editable: boolean; token: string | null;
  agentes: TrabAgenteDto[]; trilho: TrilhoDoCartao | null; mov: TrabMovimentoDoCartao | null; densidade: Densidade;
  balaoAberto: boolean; onBalao: (ancora: DOMRect | null) => void;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  const pr = PRIORIDADES.find((p) => p.key === t.priority);
  const agente = nomeDoAgente(t);
  // Etapa fechada não envelhece: cliente encerrado não está "parado".
  const dias = t.statusType === 'closed' ? null : diasDesde(t.statusDesde);
  const minutos = t.minutos ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelar = () => { if (espera.current) { clearTimeout(espera.current); espera.current = null; } };
  const mostrar = (atraso: number) => {
    cancelar();
    espera.current = setTimeout(() => { if (ref.current) onBalao(ref.current.getBoundingClientRect()); }, atraso);
  };
  const esconder = () => { cancelar(); if (balaoAberto) onBalao(null); };
  useEffect(() => cancelar, []);
  const compacto = densidade === 'compacto';
  const cheio = densidade === 'cheio';
  const ultimo = mov?.ultimo ?? null;
  return (
    <div
      ref={ref}
      className={`group relative rounded-lg border bg-surface px-2 py-1.5 transition focus-within:border-brand hover:border-brand-dim ${mov?.procedencia ? 'border-border border-l-2 border-l-brand' : 'border-border'}`}
      data-work-task-id={t.id}
      data-densidade={densidade}
      draggable={editable}
      onDragStart={editable ? (e) => { esconder(); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onMouseEnter={() => mostrar(ATRASO_DO_BALAO_MS)}
      onMouseLeave={esconder}
    >
      <div className="flex items-start justify-between gap-1.5">
        <button
          type="button"
          onClick={() => onAbrir(t.id)}
          onFocus={() => mostrar(0)}
          onBlur={esconder}
          aria-describedby={balaoAberto ? `balao-do-cartao-${t.id}` : undefined}
          className={`min-w-0 text-left text-[13px] font-semibold leading-snug outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-brand ${compacto ? 'truncate' : 'break-words'}`}
        >
          {t.title}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          {dias !== null && (
            <span
              data-idade-dias={dias}
              title={`Nesta etapa desde ${dataHoraBR(t.statusDesde)}`}
              className={`font-os-mono text-[10px] tabular-nums ${dias > DIAS_DE_ALERTA_NA_ETAPA ? 'text-mag' : 'text-muted'}`}
            >
              {compacto ? <>{dias}d<span className="sr-only"> na etapa</span></> : `${dias}d na etapa`}
            </span>
          )}
          {t.externalUrl && !compacto && (
            <a href={t.externalUrl} target="_blank" rel="noreferrer" title="Abrir no ClickUp" className="relative z-10 text-muted hover:text-brand">
              <ExternalLink size={12} />
            </a>
          )}
        </span>
      </div>
      <p className={`mt-0.5 truncate text-[11.5px] ${mov?.proximaAcao ? 'text-text' : 'text-muted'}`} title={mov?.proximaAcao?.texto ?? undefined}>
        {mov?.proximaAcao ? mov.proximaAcao.texto : 'sem próxima ação'}
        {mov?.proximaAcao?.quando && <span className="text-muted"> · {dataBR(mov.proximaAcao.quando)}</span>}
      </p>
      {!compacto && (
        <>
          {(t.values.some((v) => v.optionName) || t.tags.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
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
          )}
          <p className="mt-1 truncate text-[11px]" data-testid={`trabalho-cliente-${t.id}`}>
            {t.clienteNome
              ? <span className="text-text" title={`Cliente: ${t.clienteNome}`}>{t.clienteNome}</span>
              : <span className="rounded border border-warn/50 px-1 font-os-mono text-[10px] text-warn">sem cliente</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {t.priority !== 'normal' && pr && <Flag size={11} style={{ color: pr.cor }} />}
            {t.assignee && <span>{t.assignee}</span>}
            {t.dueDate && <span className={t.overdue ? 'text-bad' : ''}>{dataBR(t.dueDate)}</span>}
            {t.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={10} />{t.comments}</span>}
            {t.subtasks > 0 && <span>{t.subtasks} sub</span>}
            {minutos > 0 && (
              <span title="Horas apontadas nesta tarefa" className="flex items-center gap-0.5">
                <Clock size={10} />{formatarHoras(minutos)}
              </span>
            )}
          </div>
          {mov?.procedencia && (
            <a
              href={`/comercial/lead/${mov.procedencia.leadId}`}
              data-testid={`trabalho-procedencia-${t.id}`}
              className="relative z-10 mt-1 inline-flex items-center gap-1 rounded border border-brand/40 px-1.5 py-0.5 font-os-mono text-[10px] text-brand hover:bg-brand/10"
              title="Abrir o lead no comercial"
            >
              {mov.procedencia.rotulo}
            </a>
          )}
          {trilho && <div className="relative z-10"><AtalhoDoTrilho trilho={trilho} onAbrir={() => onAbrir(t.id, 'trilho')} /></div>}
        </>
      )}
      {compacto && mov?.procedencia && <span className="sr-only">{mov.procedencia.rotulo}</span>}
      <p
        className="mt-0.5 truncate font-os-mono text-[10px] text-muted"
        data-testid={`trabalho-rodape-${t.id}`}
        title={ultimo ? `${ultimo.quem} · ${ultimo.frase} · ${dataHoraBR(ultimo.em)}` : undefined}
      >
        {ultimo ? `${ultimo.quem} · ${ultimo.frase} · ${haCurto(ultimo.em)}` : 'sem movimento registrado'}
      </p>
      {/*
        QUEM ESTÁ COM A TAREFA (fatia A4) aparece em TODA densidade: travada
        por agente é o que responde "isto está parado?", e esconder no compacto
        faria a tarefa parecer livre. Entregar e soltar, a partir do médio.
      */}
      {agente && (
        <div
          className={`flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand ${compacto ? 'mt-1' : 'mt-1.5'}`}
          title={`Assumida por ${agente} em ${dataHoraBR(t.agenteEm)}`}
        >
          <Bot size={11} className="shrink-0" />
          <span className="truncate">{agente}</span>
        </div>
      )}
      {!compacto && editable && (
        <div className="relative z-10">
          <ControleDoAgente t={t} agentes={agentes} token={token} onMudou={onMudou} onErro={onErro} />
        </div>
      )}
      {cheio && editable && (
        <div className="relative z-10">
          <select
            value={t.statusId}
            onChange={(e) =>
              apiPatch(`/trabalho/tarefas/${t.id}`, { statusId: e.target.value }, token).then(onMudou).catch((er) => onErro(er.message))
            }
            title="Mover etapa"
            aria-label={`Mover ${t.title} de etapa`}
            className="mt-1.5 w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] outline-none focus:border-brand-dim"
          >
            {lista.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/** O balão: os três últimos passos e o último comentário, sem sair da tela. Não recebe foco nem clique. */
function BalaoDoCartao({ t, mov, ancora }: { t: TrabTarefaResumo; mov: TrabMovimentoDoCartao | null; ancora: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(posicaoDoBalao(ancora, { largura: window.innerWidth, altura: window.innerHeight }, { largura: el.offsetWidth, altura: el.offsetHeight }));
  }, [ancora, mov]);
  const passos = mov?.passos ?? [];
  return (
    <div
      ref={ref}
      id={`balao-do-cartao-${t.id}`}
      role="tooltip"
      data-testid="trabalho-balao"
      className="pointer-events-none fixed z-50 w-72 max-w-[calc(100vw-16px)] rounded border border-border bg-surface-2 p-2.5 text-[11.5px] leading-snug shadow-lg"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <p className="truncate font-semibold">{t.title}</p>
      <p className="mt-1.5 font-os-mono text-[10px] uppercase tracking-[0.14em] text-muted">últimos passos</p>
      {passos.length === 0 ? (
        <p className="mt-0.5 text-muted">Nenhum movimento registrado.</p>
      ) : (
        <ol className="mt-0.5 space-y-0.5">
          {passos.map((p, i) => (
            <li key={`${p.em}-${i}`}><span className="text-text">{p.quem}</span> <span className="text-muted">· {p.frase} · {haCurto(p.em)}</span></li>
          ))}
        </ol>
      )}
      <p className="mt-1.5 font-os-mono text-[10px] uppercase tracking-[0.14em] text-muted">último comentário</p>
      {mov?.ultimoComentario ? (
        <p className="mt-0.5 break-words"><span className="text-text">{mov.ultimoComentario.quem}</span> <span className="text-muted">· {mov.ultimoComentario.frase} · {haCurto(mov.ultimoComentario.em)}</span></p>
      ) : (
        <p className="mt-0.5 text-muted">Sem comentário.</p>
      )}
      <p className="mt-2 border-t border-border pt-1.5 font-os-mono text-[10px] text-muted">clique abre o painel · Esc fecha</p>
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

/*
 * NOVA TAREFA NA COLUNA (rodada do trabalho T4): o nome no padrão imperativo
 * (verbo + objeto) e o CLIENTE obrigatório, escolhido no seletor. O último
 * cliente escolhido fica marcado para a próxima, na mesma visita.
 */
function QuickAdd({ listaId, statusId, token, clienteInicial, onCliente, onDone, onErro }: {
  listaId: string; statusId: string; token: string | null;
  clienteInicial: ClienteEscolhido | null; onCliente: (c: ClienteEscolhido) => void;
  onDone: () => void; onErro: (m: string) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(clienteInicial);
  const enviar = () => {
    if (!titulo.trim()) return;
    if (!cliente) { onErro('Escolha o cliente da tarefa. O trabalho da própria empresa vai para o cliente interno.'); return; }
    apiPost('/trabalho/tarefas', { listId: listaId, statusId, title: titulo.trim(), clienteId: cliente.id }, token)
      .then(() => { setTitulo(''); onDone(); })
      .catch((e) => onErro(e.message));
  };
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border px-2 py-1.5" data-testid={`trabalho-nova-${statusId}`}>
      <div className="flex items-center gap-1">
        <Plus size={12} className="shrink-0 text-muted" />
        <input
          value={titulo}
          aria-label="Nome da nova tarefa"
          title={DICA_DO_NOME_DA_TAREFA}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enviar()}
          placeholder="Nova tarefa…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted"
        />
      </div>
      {titulo.trim() && (
        <>
          <p className="text-[10.5px] leading-snug text-muted">{DICA_DO_NOME_DA_TAREFA}</p>
          <SeletorDeCliente valor={cliente} token={token} obrigatorio onEscolher={(c) => { setCliente(c); onCliente(c); }} testid={`trabalho-nova-cliente-${statusId}`} />
          <button type="button" onClick={enviar} disabled={!cliente} className="w-full rounded bg-brand/15 px-2 py-1 text-[11px] text-brand hover:bg-brand/25 disabled:opacity-50">
            Criar tarefa
          </button>
        </>
      )}
    </div>
  );
}

// ---------- visão tabela ----------

function Tabela({ lista, tarefas, campos, trilhos, onAbrir }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; campos: string[]; trilhos: Map<string, TrilhoDoCartao>;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Tarefa</th>
            <th className="px-3 py-2">Cliente</th>
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
              <td className="px-3 py-2">
                <button onClick={(e) => { e.stopPropagation(); onAbrir(t.id); }} className="text-left hover:text-brand focus-visible:outline-brand">{t.title}</button>
                {trilhos.get(t.id) && <AtalhoDoTrilho trilho={trilhos.get(t.id)!} onAbrir={() => onAbrir(t.id, 'trilho')} />}
              </td>
              <td className="px-3 py-2">{t.clienteNome ?? <span className="font-os-mono text-[10px] text-warn">sem cliente</span>}</td>
              <td className="px-3 py-2">
                <span className="rounded px-1.5 py-0.5 text-[11px] capitalize" style={{ background: `${t.statusColor}26`, color: t.statusColor }}>
                  {t.statusName}
                </span>
              </td>
              <td className="px-3 py-2 capitalize">{t.priority}</td>
              <td className="px-3 py-2">{t.assignee ?? '—'}</td>
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
            <tr><td colSpan={7 + campos.length} className="px-3 py-6 text-center text-muted">Nada por aqui.</td></tr>
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

/**
 * O pop-up da tarefa fora do Trabalho (Pendências, Minhas tarefas): lê a tarefa
 * da URL pelo mesmo `useTarefaNaUrl` e carrega a árvore que o painel precisa
 * (listas, etapas, campos, responsáveis). Quem chama só põe `<TarefaFlutuante />`
 * na tela e abre com `useTarefaNaUrl().abrir(id)`; `onMudou` recarrega a lista
 * de quem chamou depois de uma edição.
 */
export function TarefaFlutuante({ tarefa, onMudou }: { tarefa: ReturnType<typeof useTarefaNaUrl>; onMudou?: () => void }) {
  const { token, can, user } = useAuth();
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const aberta = !!tarefa.tarefaId;
  useEffect(() => {
    if (!aberta || estrutura || !token || !can('tarefas.ver')) return;
    let ativa = true;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => { if (ativa) setEstrutura(e); })
      .catch((e: Error) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [aberta, estrutura, token, can]);
  const mudou = useCallback(() => onMudou?.(), [onMudou]);
  if (!tarefa.tarefaId) return null;
  return (
    <>
      {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
      {estrutura && (
        <PainelTarefa
          key={`${token}:${tarefa.tarefaId}`} id={tarefa.tarefaId} estrutura={estrutura} editable={can('tarefas.editar')}
          token={token} usuarioId={user?.id ?? null} aba={tarefa.aba} onTrocarAba={tarefa.trocarAba}
          onFechar={tarefa.fechar} onMoverLista={() => mudou()} onMudou={mudou} onErro={setErro}
        />
      )}
    </>
  );
}

/*
 * O POP-UP ÚNICO DA TAREFA (rodada do trabalho T2, 19/10/2026). O mesmo
 * componente abre por cima de Pendências, Minhas tarefas, Trabalho e
 * Implantação, com o estado na URL (`?tarefa=<id>`, `lib/tarefa-na-url.ts`):
 * voltar do navegador fecha, Esc fecha, o foco fica preso no diálogo e volta a
 * quem abriu. No celular ele é uma folha que sobe de baixo. Quando o cartão tem
 * trilho de onboarding ligado (`OnboardingTrilho.cardId`), a bancada do trilho
 * é a aba "Trilho" (T1: a bancada antiga deixou de ser porta).
 */
function PainelTarefa({ id, estrutura, editable, token, usuarioId, aba = 'tarefa', onTrocarAba, onFechar, onMoverLista, onMudou, onErro }: {
  id: string; estrutura: TrabEstrutura; editable: boolean; token: string | null;
  aba?: AbaDaTarefa; onTrocarAba?: (aba: AbaDaTarefa) => void;
  /** Quem está logado — só o autor de um lançamento de horas vê o botão de apagar. */
  usuarioId: string | null;
  onFechar: () => void; onMoverLista: (id: string) => void;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const [t, setT] = useState<TrabTarefaDetalhe | null>(null);
  const [comentario, setComentario] = useState('');
  const [novaTag, setNovaTag] = useState('');
  const [edicaoDescricao, setEdicaoDescricao] = useState(false);
  const [trilho, setTrilho] = useState<{ id: string; cliente: string; faseRotulo: string; faltando: string[] } | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    let ativa = true;
    apiGet<{ id: string; cliente: string; faseRotulo: string; cardId: string | null; faltando: string[] }[]>(`/tenants/onboarding/trilhos?cardId=${encodeURIComponent(id)}`, token)
      .then((lista) => { if (ativa) setTrilho(Array.isArray(lista) ? lista[0] ?? null : null); })
      .catch(() => { if (ativa) setTrilho(null); });
    return () => { ativa = false; };
  }, [id, token]);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const fecharRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { focoAnterior.current = document.activeElement as HTMLElement; }, []);
  useEffect(() => setEdicaoDescricao(false), [id]);
  const leitura = useRef(0);
  const recarregar = useCallback(() => {
    const atual = ++leitura.current;
    apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${id}`, token)
      .then((t) => { if (atual === leitura.current) setT(t); })
      .catch((e) => { if (atual === leitura.current) onErro(e.message); });
  }, [id, token, onErro]);
  useEffect(() => { recarregar(); return () => { leitura.current += 1; }; }, [recarregar]);

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

  const moverLista = (destino: string) => {
    if (destino === t?.listId) return;
    apiPatch(`/trabalho/tarefas/${id}`, { listId: destino }, token)
      .then(() => { onMoverLista(destino); recarregar(); onMudou(); })
      .catch((e) => onErro(e.message));
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
  const anexos = separarAnexos(t.description);
  const dependencias = separarDependencias(anexos.texto);
  const nomesListas = new Map([
    ...estrutura.folders.flatMap((f) => f.lists.map((l) => [l.id, `${f.name} / ${l.name}`] as const)),
    ...estrutura.listasSoltas.map((l) => [l.id, l.name] as const),
  ]);

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
          data-testid="tarefa-popup"
          className={`fixed z-50 flex flex-col border-border bg-surface shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[92dvh] max-md:rounded-t-xl max-md:border-t md:inset-y-0 md:right-0 md:border-l ${aba === 'trilho' && trilho ? 'md:w-[min(1040px,100vw)]' : 'md:w-[520px]'} w-full md:max-w-full`}
        >
      <Dialog.Title className="sr-only">Detalhes da tarefa</Dialog.Title>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <input
          aria-label="Título da tarefa"
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
          <button ref={fecharRef} aria-label="Fechar tarefa" onClick={onFechar} className="grid min-h-11 min-w-11 place-items-center text-muted hover:text-text focus-visible:outline-brand"><X size={16} /></button>
        </div>
      </div>

      {trilho && (
        <div role="tablist" aria-label="Partes da tarefa" className="flex gap-1 border-b border-border px-3">
          {(['tarefa', 'trilho'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              data-testid={`tarefa-aba-${a}`}
              onClick={() => onTrocarAba?.(a)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] max-md:min-h-[44px] ${aba === a ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {a === 'tarefa' ? 'Tarefa' : `Trilho · ${trilho.faseRotulo}`}
            </button>
          ))}
        </div>
      )}
      {aba === 'trilho' && trilho ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm" data-testid="tarefa-trilho">
          <BancadaDoTrilho id={trilho.id} embutida />
        </div>
      ) : (
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        {trilho ? (
          <button type="button" onClick={() => onTrocarAba?.('trilho')} className="block w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[12px] underline-offset-2 hover:underline">
            Trilho de onboarding · {trilho.faseRotulo}{trilho.faltando.length ? ` · falta ${trilho.faltando.length}` : ' · portão cumprido'}
          </button>
        ) : trilho === null && listaDaImplantacao(estrutura.folders)?.listaId === t.listId ? (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">Sem trilho de onboarding ligado a este cartão.</p>
        ) : null}
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
          <Campo rotulo="Cliente">
            <SeletorDeCliente
              valor={t.clienteId ? { id: t.clienteId, nome: t.clienteNome ?? '' } : null}
              token={token}
              desabilitado={ro}
              testid="tarefa-cliente"
              onEscolher={(c) => { if (c.id !== t.clienteId) void salvar({ clienteId: c.id }); }}
            />
            {!t.clienteId && <p className="mt-1 text-[11px] text-warn">Sem cliente. Toda tarefa nova tem; escolha um para esta.</p>}
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
            <input
              list="trab-responsaveis" disabled={ro} defaultValue={t.assignee ?? ''}
              onBlur={(e) => (e.target.value || null) !== t.assignee && salvar({ assignee: e.target.value || null })}
              className={INP} placeholder="—"
            />
            <datalist id="trab-responsaveis">
              {estrutura.responsaveis.map((r) => <option key={r} value={r} />)}
            </datalist>
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Descrição e material vigente</div>
            {!ro && <button type="button" onClick={() => setEdicaoDescricao((v) => !v)} className="text-[11px] text-brand hover:underline">{edicaoDescricao ? 'Concluir edição' : 'Editar texto'}</button>}
          </div>
          {edicaoDescricao && !ro ? (
            <textarea
              key={`${t.id}:${t.updatedAt}`}
              defaultValue={dependencias.texto}
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
      )}
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

function NovaLista({ folders, token, onDone, onErro, pastaInicial }: {
  folders: TrabEstrutura['folders']; token: string | null; onDone: () => void; onErro: (m: string) => void;
  /** A pasta escolhida no topo; ausente = a primeira pasta. */
  pastaInicial?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [pasta, setPasta] = useState(pastaInicial ?? folders[0]?.id ?? '');
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
 * O ATALHO DO TRILHO no cartão e na linha (implantação aglutinada, rodada do
 * painel P2). Só aparece no cartão que TEM trilho ligado por `cardId`; o resto
 * da conversa (criar trilho, ligar ao cartão) continua na gaveta da tarefa.
 */
function AtalhoDoTrilho({ trilho, onAbrir }: { trilho: TrilhoDoCartao; onAbrir: () => void }) {
  // Desde a rodada do trabalho (T2), o trilho é a aba "Trilho" do pop-up do cartão.
  return (
    <button
      type="button"
      data-testid={`trabalho-trilho-${trilho.id}`}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}
      title={`Trilho de onboarding de ${trilho.cliente}`}
      className="mt-1.5 flex max-w-full items-center gap-1 text-left text-[11px] text-brand underline-offset-2 hover:underline"
    >
      <DoorOpen size={11} className="shrink-0" />
      <span className="truncate">Trilho · {trilho.faseRotulo}</span>
    </button>
  );
}

/*
 * "MOVER A LISTA PARA A PASTA" (rodada do painel P2; revisão P3 de 18/10/2026).
 *
 * Escolher com o mouse (ou pelo Playwright) grava na hora, como antes. Pelo
 * teclado, não: no Chrome e no Edge do Windows a seta num <select> fechado
 * dispara `change` a cada opção, e cada uma virava um PATCH e uma linha de
 * auditoria. Com tecla, a escolha fica pendente e grava no Enter ou ao sair do
 * campo; Esc desfaz.
 */
const TECLAS_QUE_NAVEGAM = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

function SeletorDePastaDaLista({ valor, pastas, onMover }: {
  valor: string; pastas: TrabEstrutura['folders']; onMover: (folderId: string) => void;
}) {
  const [escolha, setEscolha] = useState(valor);
  const pelaTecla = useRef(false);
  useEffect(() => { setEscolha(valor); }, [valor]);
  const gravar = (v: string) => {
    pelaTecla.current = false;
    if (v !== valor) onMover(v);
  };
  return (
    <select
      aria-label="Mover a lista para a pasta"
      aria-description="Com o teclado, a pasta escolhida grava no Enter ou ao sair do campo."
      data-testid="trabalho-mover-lista"
      title="Pasta desta lista"
      value={escolha}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); gravar(escolha); return; }
        if (e.key === 'Escape') { pelaTecla.current = false; setEscolha(valor); return; }
        if (TECLAS_QUE_NAVEGAM.has(e.key) || e.key.length === 1) pelaTecla.current = true;
      }}
      onChange={(e) => {
        setEscolha(e.target.value);
        if (!pelaTecla.current) gravar(e.target.value);
      }}
      onBlur={() => { if (pelaTecla.current) gravar(escolha); }}
      className="max-w-44 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none max-md:min-h-[44px]"
    >
      {pastas.map((f) => <option key={f.id} value={f.id}>Pasta: {f.name}</option>)}
      <option value="">Sem pasta</option>
    </select>
  );
}

/*
 * O SELETOR DE PASTA, no topo da tela (rodada do painel P2, 18/10/2026).
 *
 * As pastas são as de TOPO (`WorkFolder` sem mãe); escolher uma mostra na árvore
 * ela e as que estão dentro dela. O menu lateral não vira árvore de três níveis:
 * a pasta se escolhe aqui, e o estado mora em `?pasta=`. Sem pasta nenhuma, quem
 * pode editar vê o botão da estrutura sugerida (cria só o que falta, pelo nome).
 */
function BarraDePastas({ pastas, temSoltas, atual, semPastas, editable, token, onEscolher, onMudou, onErro }: {
  pastas: TrabEstrutura['folders']; temSoltas: boolean; atual: string; semPastas: boolean;
  editable: boolean; token: string | null;
  onEscolher: (pasta: string) => void; onMudou: () => void; onErro: (m: string) => void;
}) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const existe = (id: string) => pastas.some((p) => p.id === id);
  const ativa = atual === PASTA_SEM_PASTA ? PASTA_SEM_PASTA : existe(atual) ? atual : '';

  const chip = (chave: string, rotulo: string, testid: string) => (
    <button
      key={testid}
      type="button"
      data-testid={testid}
      aria-pressed={ativa === chave}
      onClick={() => onEscolher(chave)}
      className={[
        'max-w-48 truncate rounded-full border px-3 py-1 text-[12px] transition max-md:min-h-[44px]',
        ativa === chave ? 'border-brand-dim bg-brand/15 text-text' : 'border-border bg-surface text-muted hover:text-text',
      ].join(' ')}
      title={rotulo}
    >
      {rotulo}
    </button>
  );

  const criarPasta = () => {
    const n = nome.trim();
    if (!n) return;
    setOcupado(true);
    apiPost('/trabalho/pastas', { name: n }, token)
      .then(() => { setNome(''); setCriando(false); onMudou(); })
      .catch((e) => onErro(e.message))
      .finally(() => setOcupado(false));
  };

  const criarSugerida = () => {
    setOcupado(true);
    apiPost<TrabEstruturaSugeridaResultado>('/trabalho/estrutura/sugerida', {}, token)
      .then((r) => {
        const criadas = r ? r.criadas.pastas.length + r.criadas.listas.length : 0;
        setAviso(criadas > 0
          ? `Criadas ${r.criadas.pastas.length} pasta(s) e ${r.criadas.listas.length} lista(s). Renomeie ou mova o que quiser.`
          : 'A estrutura sugerida já existia; nada foi criado.');
        onMudou();
      })
      .catch((e) => onErro(e.message))
      .finally(() => setOcupado(false));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pastas">
        <span className="mr-1 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Pastas</span>
        {chip('', 'Todas', 'trabalho-pasta-todas')}
        {pastas.map((p) => chip(p.id, p.name, `trabalho-pasta-${p.id}`))}
        {(temSoltas || ativa === PASTA_SEM_PASTA) && chip(PASTA_SEM_PASTA, 'Sem pasta', 'trabalho-pasta-sem-pasta')}
        {editable && !criando && (
          <button
            type="button" data-testid="trabalho-nova-pasta" onClick={() => setCriando(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[12px] text-muted hover:text-brand"
          >
            <Plus size={12} /> Nova pasta
          </button>
        )}
        {editable && criando && (
          <span className="flex items-center gap-1">
            <input
              autoFocus aria-label="Nome da pasta nova" data-testid="trabalho-nova-pasta-nome"
              value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80}
              onKeyDown={(e) => { if (e.key === 'Enter') criarPasta(); if (e.key === 'Escape') setCriando(false); }}
              placeholder="Nome da pasta"
              className="w-40 rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] outline-none focus:border-brand-dim"
            />
            <button type="button" data-testid="trabalho-nova-pasta-criar" disabled={ocupado || !nome.trim()} onClick={criarPasta} className="rounded-full bg-brand/15 px-3 py-1 text-[12px] text-brand disabled:opacity-50">Criar</button>
            <button type="button" onClick={() => setCriando(false)} className="px-2 py-1 text-[12px] text-muted">Cancelar</button>
          </span>
        )}
      </div>
      {semPastas && editable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-[13px]">
          <span className="text-muted">
            Esta empresa ainda não tem pastas. A estrutura sugerida cria Administrativa, Gestão e Clientes, com a esteira, o onboarding e a execução dentro de Clientes.
          </span>
          <button
            type="button" data-testid="trabalho-estrutura-sugerida" disabled={ocupado} onClick={criarSugerida}
            className="rounded-lg bg-brand/15 px-3 py-1.5 text-[13px] text-brand disabled:opacity-50"
          >
            Criar a estrutura sugerida
          </button>
        </div>
      )}
      {aviso && <p role="status" className="text-[12px] text-muted">{aviso}</p>}
    </div>
  );
}
