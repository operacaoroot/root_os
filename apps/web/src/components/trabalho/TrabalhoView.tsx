'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Archive, Bot, Clock, DoorOpen, ExternalLink, Flag, Hourglass, MessageSquare, Plus, Repeat, Settings2, Unlock, X } from 'lucide-react';
import {
  MODELOS_DE_LISTA, MOEDA_PADRAO, ehValorMonetarioCanonico, formatarValorMonetario, lerValorDigitadoPtBr,
  listaDaImplantacao, moedaDoValor, paraDigitarPtBr, LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO,
  DICA_DO_NOME_DA_TAREFA, AGRUPAMENTOS, ROTULO_DO_AGRUPAMENTO, agruparTarefas, descreverRecorrencia,
  ROTULO_DA_REGUA_DE_PRAZO, reguaDePrazo, GRUPOS_DA_REGUA_DE_PRAZO,
} from '@mktos/shared';
import type {
  VistaQuadro, TrabClienteDto, TrabAgenteDto, TrabEstrutura, TrabListaDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabEstruturaSugeridaResultado, TrabMovimentoDoCartao, TrabMovimentoDoQuadro,
  Agrupamento, RecorrenciaDaTarefa, SituacaoDoPrazo,
} from '@mktos/shared';
import { apiBlob, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { tarefasDeTrabalho } from '@/lib/work-projection';
import { useTarefaNaUrl, type AbaDaTarefa } from '@/lib/tarefa-na-url';
import { BancadaDoTrilho } from '@/components/onboarding/BancadaDoTrilho';
import { SeletorDeCliente, type ClienteEscolhido } from './SeletorDeCliente';
import { VistasDoQuadro } from './VistasDoQuadro';
import { BotaoDeFiltros, type DefinicaoDeFiltro, type ValoresDeFiltro } from '@/components/filtros/BotaoDeFiltros';
import { IniciarOnboardingDaImplantacao } from './IniciarOnboardingDaImplantacao';
import { AtividadeDaTarefa } from './AtividadeDaTarefa';
import { EditorialTaskLink } from './EditorialTaskLink';
import { OrigemComercialDaTarefa } from '@/app/leads/OrigemComercialDaTarefa';
import { FontesDaTarefa } from './FontesDaTarefa';
import { OutrosResponsaveis, ResponsavelDaTarefa, SeletorOutrosResponsaveis, SeletorResponsavel, rotuloDaPessoa } from './ResponsavelDaTarefa';
import { CalendarioDeTarefas, diaDoPrazo, prazoDoDia } from './CalendarioDeTarefas';
import { diasDesde, formatarHoras, hojeEmBrasilia, minutosDeTexto } from '@/lib/horas';
import {
  CHAVE_DA_DENSIDADE, DENSIDADES, DIAS_DE_ALERTA_NA_ETAPA, LARGURA_DA_COLUNA,
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

/**
 * ATRASADA É POR DIA (versão final, F4): a régua de prazo do Lucas diz "Hoje" para o
 * que vence hoje, e a tela não pode pintar de vermelho o mesmo cartão. O `overdue` da
 * API compara o instante (o prazo importado do ClickUp é meia-noite de São Paulo e vira
 * "vencido" às 00:01); aqui ele só vale quando o DIA do prazo já passou.
 */
function cabeNoRecorte(recorte: RecorteDePrazo, situacao: SituacaoDoPrazo): boolean {
  return recorte === 'emdia' ? situacao === 'hoje' || situacao === 'proximos_7' || situacao === 'mais_tarde' : recorte === situacao;
}

function atrasada(t: Pick<TrabTarefaResumo, 'overdue' | 'dueDate'>): boolean {
  if (!t.overdue) return false;
  const dia = diaDoPrazo(t.dueDate);
  return !dia || dia < hojeEmBrasilia();
}
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
type Visao = 'board' | 'tabela' | 'calendario';
export type VisaoDoTrabalho = Visao | 'lista' | 'quadro';

/** `?visao=` do endereço → a visão. Valor desconhecido devolve `null` (vale a inicial). */
export function visaoDoEndereco(v: string | null): Visao | null {
  if (v === 'board' || v === 'quadro') return 'board';
  if (v === 'tabela' || v === 'lista') return 'tabela';
  // O calendário do Lucas (versão final, F4): arrastar muda o prazo, com versão.
  if (v === 'calendario') return 'calendario';
  return null;
}

/** `?pasta=`: vazio = a árvore inteira; `sem-pasta` = só as listas soltas; senão o id da pasta de topo. */
export const PASTA_SEM_PASTA = 'sem-pasta';

/**
 * `?pasta=todas` (versão final, F4): "Todas as tarefas", o Everything do ClickUp. As
 * tarefas de todas as pastas e listas numa visão só, sem card repetido e sem cadastro
 * como tarefa (a API aplica as regras com `todas=1`). No quadro, as colunas são o TIPO
 * da etapa (a fazer, em andamento, concluída), porque cada lista tem as suas etapas.
 */
export const PASTA_TODAS = 'todas';

/**
 * `?prazo=` (versão final, F4): o recorte da RÉGUA DE PRAZO do Lucas, que a Visão geral
 * do Dia a dia manda ao abrir o Trabalho filtrado. Vale a grafia da régua (`proximos_7`,
 * `sem_prazo`) e a curta (`proximos7`, `semprazo`); `emdia` junta hoje, próximos 7 dias
 * e mais tarde (o "em dia" do resumo por pessoa). O "atrasadas" continua `overdue=1`.
 */
export type RecorteDePrazo = SituacaoDoPrazo | 'emdia';
export function recorteDePrazo(v: string | null): RecorteDePrazo | '' {
  const x = (v ?? '').replace(/_/g, '').toLowerCase();
  const mapa: Record<string, RecorteDePrazo> = {
    atrasada: 'atrasada', atrasadas: 'atrasada', hoje: 'hoje', proximos7: 'proximos_7', maistarde: 'mais_tarde',
    semprazo: 'sem_prazo', feita: 'feita', concluidas: 'feita', emdia: 'emdia',
  };
  return mapa[x] ?? '';
}
const ROTULO_DO_RECORTE = (r: RecorteDePrazo) => (r === 'emdia' ? 'Em dia' : ROTULO_DA_REGUA_DE_PRAZO[r]);

/**
 * As chaves do endereço que são FILTRO (o painel "Filtros"). Pasta, segmento, lista,
 * visão, agrupamento e a tarefa aberta não estão aqui: "Limpar tudo" não mexe nelas.
 */
export const CHAVES_DOS_FILTROS = [
  'assigneeUserId', 'semResponsavel', 'assignee', 'escopo', 'overdue', 'prazo', 'statusId', 'opcao',
  'cliente', 'tagId', 'agente', 'concluidas', 'arquivadas', 'q',
] as const;

/** As colunas do quadro de "Todas": o tipo da etapa, com o id virtual `tipo:<tipo>`. */
const COLUNAS_POR_TIPO = [
  { id: 'tipo:open', name: 'A fazer', type: 'open', color: '#87909e' },
  { id: 'tipo:custom', name: 'Em andamento', type: 'custom', color: '#f9a400' },
  { id: 'tipo:closed', name: 'Concluídas', type: 'closed', color: '#30a46c' },
] as const;

/** A primeira etapa da lista com o tipo pedido (a mesma regra do lote e do quadro de "Todas"). */
function etapaDoTipo(listas: TrabListaDto[], listId: string, tipo: string): string | null {
  const l = listas.find((x) => x.id === listId);
  return l?.statuses.find((st) => st.type === tipo)?.id ?? null;
}

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

/**
 * `/trabalho/todas` (rodada da interface U3, 20/10/2026): a tela "Todas as tarefas"
 * é o mesmo `?pasta=todas`, fixo pela rota. Com `aoSairDeTodas`, escolher uma lista
 * ou uma pasta sai da rota para `/trabalho` com o endereço novo (a busca, com `?`).
 */
export function TrabalhoView({ visaoInicial = 'board', modo = 'trabalho', aoSairDeTodas }: {
  visaoInicial?: VisaoDoTrabalho;
  modo?: ModoDoTrabalho;
  aoSairDeTodas?: (busca: string) => void;
}) {
  const { token, ready, can, user } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !can('tarefas.ver')) return <p className="text-muted">Sem permissão para ver tarefas.</p>;
  // A conta entra na chave: trocar de pessoa com o mesmo token não herda filtro nem painel.
  return <TrabalhoConteudo key={`${user?.id ?? ''}:${token}:${modo}:${aoSairDeTodas ? 'todas' : ''}`} visaoInicial={visaoDoEndereco(visaoInicial) ?? 'board'} modo={modo} aoSairDeTodas={aoSairDeTodas} />;
}

/**
 * Os SEGMENTOS de "Todas" (U3): `?segmento=<id da pasta de topo>` ou `sem-pasta`,
 * combinado com `pasta=todas`. A API recorta com `segmentoId` (as subpastas entram).
 */
export const SEGMENTO_SEM_PASTA = 'sem-pasta';

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

function TrabalhoConteudo({ visaoInicial, modo, aoSairDeTodas }: { visaoInicial: Visao; modo: ModoDoTrabalho; aoSairDeTodas?: (busca: string) => void }) {
  const implantacao = modo === 'implantacao';
  // Na rota `/trabalho/todas` a pasta é sempre "Todas", com ou sem `?pasta=` no endereço.
  const todasFixa = !!aoSairDeTodas && !implantacao;
  const geralNoEndereco = () => {
    const p = new URLSearchParams(window.location.search);
    return todasFixa || (p.get('pasta') === PASTA_TODAS && !p.get('lista'));
  };
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
  const [novaListaAberta, setNovaListaAberta] = useState(false);
  const [fAssignee, setFAssignee] = useState('');
  const [fPessoa, setFPessoa] = useState('');
  const [todasListas, setTodasListas] = useState(false);
  const [fAgente, setFAgente] = useState('');
  const [fBusca, setFBusca] = useState('');
  const [fOpcao, setFOpcao] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCliente, setFCliente] = useState('');
  const [clientes, setClientes] = useState<TrabClienteDto[]>([]);
  const [fArquivadas, setFArquivadas] = useState(false);
  const [fConcluidas, setFConcluidas] = useState<'mostrar' | 'ocultar'>('mostrar');
  const [fAgrupar, setFAgrupar] = useState<Agrupamento>('nenhum');
  const [fPrazo, setFPrazo] = useState<RecorteDePrazo | ''>('');
  const [fEtiqueta, setFEtiqueta] = useState('');
  const [fSegmento, setFSegmento] = useState('');
  // Seleção em lote da Lista (versão final, F4): cada escrita sai com a versão lida.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [avisoDoLote, setAvisoDoLote] = useState<string | null>(null);
  const [fEscopo, setFEscopo] = useState<Escopo>('todos');
  const [densidade, setDensidade] = useState<Densidade>('compacto');
  const [movimento, setMovimento] = useState<Map<string, TrabMovimentoDoCartao>>(new Map());
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
      // Abrir e fechar o pop-up mexe só em `tarefa`/`tarefaAba`: o quadro não recarrega.
      const assinatura = assinaturaSemTarefa();
      if (filtrosLidos.current === assinatura) return;
      filtrosLidos.current = assinatura;
      setFAssignee(p.get('assignee') ?? ''); setFBusca(p.get('q') ?? '');
      setFPessoa(p.get('assigneeUserId') ?? (p.get('semResponsavel') === '1' ? 'sem-vinculo' : ''));
      setTodasListas(p.get('escopo') === 'pessoal' && !!p.get('assigneeUserId'));
      setFOpcao(p.get('opcao') ?? ''); setFAgente(p.get('agente') ?? '');
      setFStatus(p.get('statusId') ?? ''); setFArquivadas(p.get('arquivadas') === '1'); setFCliente(p.get('cliente') ?? '');
      // `concluidas=1` (o link da Visão geral) e a ausência da chave mostram; `ocultar` esconde.
      setFConcluidas(p.get('concluidas') === 'ocultar' ? 'ocultar' : 'mostrar');
      setFPrazo(recorteDePrazo(p.get('prazo')));
      setFEtiqueta(p.get('tagId') ?? ''); setFSegmento(p.get('segmento') ?? '');
      const agrupar = p.get('agrupar');
      setFAgrupar((AGRUPAMENTOS as readonly string[]).includes(agrupar ?? '') ? agrupar as Agrupamento : 'nenhum');
      setSelecionadas(new Set());
      /*
       * DOIS ESCOPOS NA MESMA CHAVE, SEM SE PISAR. `escopo=todos|meus|atrasados`
       * é o recorte do quadro (rodada I2); `escopo=pessoal&assigneeUserId=` é o
       * "Minhas tarefas" da produção (14/10): as tarefas de UMA pessoa em todas
       * as listas, sempre na Lista. `pessoal` nunca vira escopo do quadro, e o
       * recorte do quadro nunca liga o modo de todas as listas.
       * `overdue=1` (o link antigo do "só atrasadas") continua valendo como "atrasados".
       */
      const escopo = p.get('escopo');
      const pessoal = escopo === 'pessoal' && !!p.get('assigneeUserId');
      setFEscopo(escopo && escopo !== 'pessoal' ? lerEscopo(escopo) : p.get('overdue') === '1' ? 'atrasados' : 'todos');
      setVisao(pessoal ? 'tabela' : visaoDoEndereco(p.get('visao')) ?? visaoInicial);
      // "Todas" com uma lista no link (o clique numa lista da Visão geral) é aquela lista.
      setFPasta(todasFixa ? PASTA_TODAS : p.get('pasta') === PASTA_TODAS && p.get('lista') ? '' : p.get('pasta') ?? '');
      listaAtual.current = null; setListaId(null); setUrlPronta(true);
      setBump((b) => b + 1);
    };
    ler(); window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, [visaoInicial, todasFixa]);

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

  /** Sai do "todas as listas" (escopo `pessoal`) sem apagar o recorte do quadro (`meus`/`atrasados`). */
  const sairDoPessoal = () => {
    if (!todasListas) return;
    setTodasListas(false);
    filtroNoEndereco('escopo', fEscopo === 'todos' ? '' : fEscopo);
  };

  const filtrarPessoa = (id: string, geral = todasListas) => {
    const pessoal = geral && !!id && id !== 'sem-vinculo';
    if (pessoal) {
      // O modo de todas as listas ocupa a chave `escopo`: o recorte do quadro volta a "todos".
      setTodasListas(true); setFEscopo('todos'); filtroNoEndereco('escopo', 'pessoal');
    } else sairDoPessoal();
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
        if (!listaAtual.current && implantacao) {
          const achada = listaDaImplantacao(e.folders);
          setSemImplantacao(!achada);
          if (achada) trocarLista(achada.listaId);
        } else if (!listaAtual.current && !geralNoEndereco()) {
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
    // geralNoEndereco só lê o endereço e `todasFixa`, que entra aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, readable, urlPronta, bump, trocarLista, implantacao, todasFixa]);

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
        // Em "Todas as tarefas" o pop-up abre por cima da visão geral: nenhuma lista é escolhida.
        if (implantacao || geralNoEndereco()) return;
        trocarLista(t.listId, listaAtual.current ?? new URLSearchParams(window.location.search).get('lista'));
        mudarEndereco(t.listId, t.id);
      })
      .catch((e) => { if (ativa && new URLSearchParams(window.location.search).get('tarefa') === tarefaId) setErro(`Não foi possível abrir a tarefa do link: ${e.message}`); });
    return () => { ativa = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estrutura, token, readable, trocarLista, implantacao, todasFixa]);

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

  /** Sair de "Todas" (para uma lista ou uma pasta) leva o segmento junto. */
  const sairDoSegmento = () => {
    if (!fSegmento) return;
    setFSegmento(''); filtroNoEndereco('segmento', '');
  };

  const selecionarLista = (id: string) => {
    // Na rota de Todas, abrir uma lista é ir para o Trabalho com ela.
    if (todasFixa) { aoSairDeTodas?.(`?lista=${encodeURIComponent(id)}`); return; }
    sairDoPessoal(); sairDoSegmento();
    // Escolher uma lista na árvore sai de "Todas as tarefas" e volta à árvore inteira.
    if (fPasta === PASTA_TODAS) { setFPasta(''); filtroNoEndereco('pasta', ''); }
    setSelecionadas(new Set());
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
    if (todasFixa && pasta !== PASTA_TODAS) { aoSairDeTodas?.(pasta ? `?pasta=${encodeURIComponent(pasta)}` : ''); return; }
    if (pasta !== PASTA_TODAS) sairDoSegmento();
    setFPasta(pasta); filtroNoEndereco('pasta', todasFixa ? '' : pasta);
    setSelecionadas(new Set());
    if (pasta === PASTA_TODAS) {
      sairDoPessoal();
      listaAtual.current = null; setListaId(null); mudarEndereco(null, null);
      return;
    }
    if (!estrutura) return;
    const daPasta = listasDaPasta(estrutura, pasta);
    if (listaId && daPasta.some((l) => l.id === listaId)) return;
    if (daPasta[0]) { selecionarLista(daPasta[0].id); return; }
    listaAtual.current = null; setListaId(null); mudarEndereco(null, null);
  };
  /*
   * O endereço de quando o pop-up abriu: o voltar que o fecha cai nele e o
   * quadro não recarrega. Em "todas as listas" a tarefa pode ser de outra lista:
   * a lista real dela vai para o endereço antes (a regra da produção, 14/10), e
   * o filtro pessoal fica.
   */
  const abrirTarefa = (id: string, aba?: AbaDaTarefa) => {
    const registro = tarefas?.items.find((tarefa) => tarefa.id === id);
    if (registro && registro.listId !== listaAtual.current && fPasta !== PASTA_TODAS) {
      trocarLista(registro.listId);
      const url = new URL(window.location.href);
      url.searchParams.set('lista', registro.listId);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    filtrosLidos.current = assinaturaSemTarefa(); tarefaUrl.abrir(id, aba);
  };
  const fecharTarefa = tarefaUrl.fechar;

  const lista: TrabListaDto | null = useMemo(() => {
    if (!estrutura || !listaId) return null;
    return [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas].find((l) => l.id === listaId) ?? null;
  }, [estrutura, listaId]);

  // Resposta antiga nunca publica itens nem erros na consulta seguinte.
  useEffect(() => {
    setTarefas(null);
    const geral = fPasta === PASTA_TODAS;
    if (!ready || !token || !readable || (!listaId && !todasListas && !geral) || !urlPronta) return;
    let ativa = true;
    setErro(null);
    const p = new URLSearchParams(geral ? { todas: '1' } : todasListas ? {} : { listId: listaId! });
    if (fAssignee) p.set('assignee', fAssignee);
    if (fPessoa === 'sem-vinculo') p.set('semResponsavel', '1');
    else if (fPessoa) p.set('assigneeUserId', fPessoa);
    if (fBusca) p.set('q', fBusca);
    // Etapa e opção são da lista: em "todas as listas" não valem.
    if (fOpcao && !todasListas && !geral) p.set('opcao', fOpcao);
    if (fStatus && !todasListas && !geral) p.set('statusId', fStatus);
    if (fCliente) p.set('cliente', fCliente);
    if (fArquivadas) p.set('arquivadas', '1');
    if (fEtiqueta) p.set('tagId', fEtiqueta);
    // O segmento só vale em "Todas" (a API recusa sem `todas=1`).
    if (geral && fSegmento) p.set('segmentoId', fSegmento);
    tarefasDeTrabalho(token, p, () => ativa)
      .then((r) => { if (ativa) {
        setTarefas(r);
        if (recargaEtapa.current === bump) { setConflitoEtapa(null); recargaEtapa.current = null; }
      } })
      .catch((e) => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, [ready, token, readable, urlPronta, listaId, todasListas, fPasta, fAssignee, fPessoa, fBusca, fOpcao, fStatus, fCliente, fArquivadas, fEtiqueta, fSegmento, bump]);

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

  /*
   * Agente, atraso e "meus" filtram a coleção completa, após a última página.
   * "Meus" casa pela CONTA (`assigneeUserId === user.id`, a regra da produção:
   * identidade por ID, não por nome). Só a tarefa ainda sem vínculo de pessoa
   * cai no nome antigo em texto, para o legado do ClickUp não sumir do recorte.
   */
  const visiveis = useMemo(() => {
    const itens = tarefas?.items ?? [];
    const agora = new Date();
    // Vários responsáveis (versão final): "meus" é ser a principal OU uma das demais, sempre pela conta.
    const meu = (t: TrabTarefaResumo) => (t.assigneeUserId || t.outrosResponsaveisIds?.length
      ? t.assigneeUserId === user?.id || !!user?.id && !!t.outrosResponsaveisIds?.includes(user.id)
      : ehMeu(t.assignee, user?.name));
    return itens.filter((t) => (fEscopo !== 'atrasados' || atrasada(t)) &&
      (fEscopo !== 'meus' || meu(t)) &&
      (fConcluidas !== 'ocultar' || t.statusType !== 'closed') &&
      (!fPrazo || cabeNoRecorte(fPrazo, reguaDePrazo(t.dueDate, t.statusType, agora))) &&
      (!fAgente || (fAgente === 'livres' ? !t.agenteId : t.agenteSlug === fAgente)));
  }, [tarefas, fAgente, fEscopo, fConcluidas, fPrazo, user?.id, user?.name]);
  const geral = fPasta === PASTA_TODAS;
  // Sem uma lista aberta: "Todas as tarefas" ou o "todas as listas" da pessoa.
  const semLista = geral || todasListas;
  const todasAsListas = useMemo(() => (estrutura ? [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas] : []), [estrutura]);
  /** A lista virtual do quadro de "Todas": colunas pelo tipo da etapa. */
  const listaGeral: TrabListaDto = useMemo(() => ({
    id: PASTA_TODAS, name: 'Todas as tarefas', total: visiveis.length, order: 0, externalId: null, fields: [],
    statuses: COLUNAS_POR_TIPO.map((c, i) => ({ id: c.id, name: c.name, type: c.type, color: c.color, order: i, total: 0, limite: null })),
  }) as unknown as TrabListaDto, [visiveis.length]);
  const visiveisNoQuadroGeral = useMemo(
    () => visiveis.map((t) => ({ ...t, statusId: `tipo:${t.statusType}` })),
    [visiveis],
  );

  /** No quadro de "Todas", soltar numa coluna é ir à primeira etapa daquele tipo na lista da tarefa. */
  const moverPorTipo = async (t: TrabTarefaResumo, colunaId: string) => {
    const real = tarefas?.items.find((x) => x.id === t.id);
    if (!real) return;
    const destino = etapaDoTipo(todasAsListas, real.listId, colunaId.replace(/^tipo:/, ''));
    if (!destino) { setErro(`A lista ${real.listName ?? 'da tarefa'} não tem uma etapa desse tipo.`); return; }
    await moverEtapa(real, destino);
  };

  /**
   * ORDEM MANUAL (versão final, F4): a sequência da coluna ou da lista vai inteira,
   * cada tarefa com a versão lida. Uma versão vencida derruba tudo (409) e a tela pede
   * para recarregar; nada é gravado pela metade.
   */
  const reordenar = async (ids: string[]) => {
    if (!editable) return;
    const itens = ids.map((id) => tarefas?.items.find((t) => t.id === id)).filter((t): t is TrabTarefaResumo => !!t);
    if (itens.length !== ids.length || itens.some((t) => !t.updatedAt)) { setErro('Recarregue a lista antes de reordenar: a versão de alguma tarefa não está disponível.'); return; }
    try {
      await apiPost('/trabalho/tarefas/ordem', { itens: itens.map((t) => ({ id: t.id, expectedUpdatedAt: t.updatedAt })) }, token);
      refresh();
    } catch (e) {
      setErro((e as { status?: number }).status === 409 ? 'Alguma tarefa mudou desde que a lista foi lida. Recarregue antes de reordenar.' : (e as Error).message);
    }
  };

  /** O prazo pelo calendário: um PATCH com a versão lida, como o campo Prazo do pop-up. */
  const mudarPrazo = async (id: string, dia: string) => {
    const t = tarefas?.items.find((x) => x.id === id);
    if (!editable || !t) return;
    if (!t.updatedAt) { setErro('Recarregue a lista antes de alterar esta tarefa: a versão não está disponível.'); return; }
    try {
      await apiPatch(`/trabalho/tarefas/${t.id}`, { dueDate: prazoDoDia(dia), expectedUpdatedAt: t.updatedAt }, token);
      refresh();
    } catch (e) {
      setErro((e as { status?: number }).status === 409 ? `A tarefa "${t.title}" mudou desde que a lista foi lida. O prazo não foi gravado; recarregue a lista.` : (e as Error).message);
    }
  };

  /**
   * O LOTE (versão final, F4): uma escrita por tarefa, em sequência, cada uma com a
   * versão lida e pelas regras de sempre (cliente, porta da implantação, auditoria).
   * Conflito numa não desfaz as outras: a tela diz quantas foram e quantas pedem recarga.
   */
  const aplicarLote = async (mudanca: (t: TrabTarefaResumo) => Record<string, unknown> | string, oQue: string) => {
    if (!editable || !tarefas) return;
    const alvo = tarefas.items.filter((t) => selecionadas.has(t.id));
    let ok = 0, conflito = 0;
    const erros: string[] = [];
    setAvisoDoLote('Aplicando…');
    for (const t of alvo) {
      const m = mudanca(t);
      if (typeof m === 'string') { erros.push(`${t.title}: ${m}`); continue; }
      if (!t.updatedAt) { erros.push(`${t.title}: a versão não está disponível`); continue; }
      try {
        await apiPatch(`/trabalho/tarefas/${t.id}`, { ...m, expectedUpdatedAt: t.updatedAt }, token);
        ok += 1;
      } catch (e) {
        if ((e as { status?: number }).status === 409) conflito += 1;
        else erros.push(`${t.title}: ${(e as Error).message}`);
      }
    }
    const partes = [`${oQue}: ${ok} ${ok === 1 ? 'tarefa alterada' : 'tarefas alteradas'}.`];
    if (conflito) partes.push(`${conflito} ${conflito === 1 ? 'mudou' : 'mudaram'} desde a leitura e não ${conflito === 1 ? 'foi gravada' : 'foram gravadas'}; recarregue e tente de novo.`);
    if (erros.length) partes.push(erros.join(' · '));
    setAvisoDoLote(partes.join(' '));
    setSelecionadas(new Set());
    refresh();
  };
  // Com conflito de versão aberto ou etapa gravando, o quadro não aceita outra escrita.
  const quadroEditavel = editable && !conflitoEtapa && !salvandoEtapa;

  const semListas = estrutura !== null && estrutura.folders.every((f) => f.lists.length === 0) && estrutura.listasSoltas.length === 0;
  // A árvore ao lado (a partir de 1024 px) rola sozinha até o fim da janela, como o quadro:
  // com muitas listas ela esticava a página e escondia a rolagem lateral do quadro.
  const arvore = useRef<HTMLElement>(null);
  const alturaDaArvore = useAlturaAteOFim(arvore, 24, 1024);

  if (ready && !readable) return <p className="text-muted">Sem permissão para ver tarefas.</p>;

  // A lista da implantação não recebe cartão solto, em nenhuma tela (a API também recusa).
  const listaEhImplantacao = !!lista && !!estrutura && listaDaImplantacao(estrutura.folders)?.listaId === lista.id;
  const pastaDaLista = lista && estrutura ? estrutura.folders.find((f) => f.lists.some((l) => l.id === lista.id))?.id ?? '' : '';

  /*
   * OS FILTROS NUM BOTÃO SÓ (rodada da interface U2, 20/10/2026). Os filtros que
   * ficavam soltos no cabeçalho vão para o painel de "Filtros (n)". As chaves no
   * endereço são as de sempre (`?assigneeUserId=`, `?prazo=`…): é o que a vista
   * salva guarda e o que o link carrega. Os valores saem do estado da tela, e cada
   * mudança passa pelas mesmas regras de antes (pessoa, texto antigo, recorte).
   * Visão, densidade e agrupamento são formas de ver e ficam fora do painel.
   */
  const pessoaEscolhida = !!fPessoa && fPessoa !== 'sem-vinculo';
  const camposComOpcao = camposDaLista.filter((c) => c.type === 'drop_down' && c.options.length > 0);
  const opcoesDePessoa = [
    { valor: 'sem-vinculo', rotulo: 'Sem vínculo de pessoa' },
    ...(estrutura?.pessoas ?? []).map((pessoa) => ({ valor: pessoa.id, rotulo: `${rotuloDaPessoa(pessoa)}${!pessoa.isActive ? ' (inativo)' : ''}` })),
  ];
  const opcoesDeCliente = [
    { valor: 'sem', rotulo: 'Sem cliente (para limpar)' },
    ...clientes.filter((c) => c.id !== 'interno').map((c) => ({ valor: c.id, rotulo: c.nome })),
  ];
  const opcoesDeEtapa = (lista?.statuses ?? []).map((st) => ({ valor: st.id, rotulo: st.name }));
  const filtroDaPessoa: DefinicaoDeFiltro = { chave: 'assigneeUserId', rotulo: 'Responsável', tipo: 'pessoa', vazio: 'Todas as pessoas', opcoes: opcoesDePessoa };
  const filtroDoCliente: DefinicaoDeFiltro = { chave: 'cliente', rotulo: 'Cliente', tipo: 'cliente', vazio: 'Todos os clientes', opcoes: opcoesDeCliente };
  const filtroDaBusca: DefinicaoDeFiltro = { chave: 'q', rotulo: 'Busca', tipo: 'texto', placeholder: 'Nome da tarefa' };
  const definicoesDosFiltros: DefinicaoDeFiltro[] = implantacao ? [
    filtroDaPessoa,
    filtroDoCliente,
    { chave: 'statusId', rotulo: 'Etapa', tipo: 'etapa', vazio: 'Todas as etapas', opcoes: opcoesDeEtapa },
    { chave: 'escopo', rotulo: 'Só as atrasadas', tipo: 'booleano', valorMarcado: 'atrasados' },
    filtroDaBusca,
  ] : [
    filtroDaPessoa,
    ...(pessoaEscolhida && !geral ? [{ chave: 'todasAsListas', rotulo: 'Em todas as listas', tipo: 'booleano' as const, dica: 'As tarefas da pessoa em todas as listas, na Lista.' }] : []),
    { chave: 'escopo', rotulo: 'Recorte', tipo: 'opcoes', vazio: 'Todas', opcoes: [{ valor: 'meus', rotulo: 'Só as minhas' }, { valor: 'atrasados', rotulo: 'Só as atrasadas' }] },
    { chave: 'prazo', rotulo: 'Prazo', tipo: 'prazo', vazio: 'Qualquer prazo', opcoes: [...GRUPOS_DA_REGUA_DE_PRAZO.map((g) => ({ valor: g, rotulo: ROTULO_DA_REGUA_DE_PRAZO[g] })), { valor: 'emdia', rotulo: 'Em dia' }] },
    ...(!semLista ? [{ chave: 'statusId', rotulo: 'Status', tipo: 'etapa' as const, vazio: 'Todos os status', opcoes: opcoesDeEtapa }] : []),
    filtroDoCliente,
    ...((estrutura?.tags ?? []).length ? [{ chave: 'tagId', rotulo: 'Etiqueta', tipo: 'etiqueta' as const, vazio: 'Todas as etiquetas', opcoes: (estrutura?.tags ?? []).map((tg) => ({ valor: tg.id, rotulo: tg.name })) }] : []),
    ...(!semLista && camposComOpcao.length ? [{
      chave: 'opcao', rotulo: 'Campo da lista', tipo: 'opcoes' as const, vazio: 'Todos',
      opcoes: camposComOpcao.flatMap((c) => c.options.map((o) => ({ valor: o.id, rotulo: `${c.name}: ${o.name}` }))),
    }] : []),
    // O agente é outro eixo (fatia A4): quem tem a tarefa NA MÃO, não quem responde por ela.
    { chave: 'agente', rotulo: 'Agente', tipo: 'opcoes', vazio: 'Todos os agentes', opcoes: [{ valor: 'livres', rotulo: 'Sem agente (livres)' }, ...(estrutura?.agentes ?? []).map((a) => ({ valor: a.slug, rotulo: `${a.nome}${a.tarefas > 0 ? ` (${a.tarefas})` : ''}` }))] },
    ...((estrutura?.responsaveis ?? []).length ? [{ chave: 'assignee', rotulo: 'Responsável (texto antigo)', tipo: 'opcoes' as const, vazio: 'Todos', opcoes: (estrutura?.responsaveis ?? []).map((r) => ({ valor: r, rotulo: r })), dica: 'O nome escrito nas tarefas importadas, antes do vínculo com a conta.' }] : []),
    { chave: 'concluidas', rotulo: 'Ocultar concluídas', tipo: 'booleano', valorMarcado: 'ocultar' },
    { chave: 'arquivadas', rotulo: 'Incluir arquivadas', tipo: 'booleano' },
    filtroDaBusca,
  ];
  const valoresDosFiltros: ValoresDeFiltro = {
    assigneeUserId: fPessoa,
    todasAsListas: todasListas ? '1' : '',
    escopo: todasListas || fEscopo === 'todos' ? '' : fEscopo,
    prazo: fPrazo,
    statusId: fStatus,
    cliente: fCliente,
    tagId: fEtiqueta,
    opcao: fOpcao,
    agente: fAgente,
    assignee: fAssignee,
    concluidas: fConcluidas === 'ocultar' ? 'ocultar' : '',
    arquivadas: fArquivadas ? '1' : '',
    q: fBusca,
  };
  const mudarFiltro = (chave: string, valor: string) => {
    setSelecionadas(new Set());
    switch (chave) {
      case 'assigneeUserId': filtrarPessoa(valor); return;
      case 'todasAsListas':
        if (valor && pessoaEscolhida) { filtrarPessoa(fPessoa, true); setVisao('tabela'); filtroNoEndereco('visao', 'lista'); }
        else sairDoPessoal();
        return;
      case 'escopo': {
        // O recorte do quadro ocupa a chave `escopo`: escolher um sai do "todas as listas".
        const escopo = lerEscopo(valor);
        setTodasListas(false); setFEscopo(escopo); filtroNoEndereco('escopo', escopo === 'todos' ? '' : escopo); filtroNoEndereco('overdue', '');
        return;
      }
      case 'prazo': setFPrazo(recorteDePrazo(valor)); filtroNoEndereco('prazo', valor); return;
      case 'statusId': setFStatus(valor); filtroNoEndereco('statusId', valor); return;
      case 'cliente': setFCliente(valor); filtroNoEndereco('cliente', valor); return;
      case 'tagId': setFEtiqueta(valor); filtroNoEndereco('tagId', valor); return;
      case 'opcao': setFOpcao(valor); filtroNoEndereco('opcao', valor); return;
      case 'agente': setFAgente(valor); filtroNoEndereco('agente', valor); return;
      case 'assignee':
        // O texto antigo e o vínculo de pessoa não valem juntos.
        if (valor) { sairDoPessoal(); setFPessoa(''); filtroNoEndereco('assigneeUserId', ''); filtroNoEndereco('semResponsavel', ''); }
        setFAssignee(valor); filtroNoEndereco('assignee', valor);
        return;
      case 'concluidas': setFConcluidas(valor === 'ocultar' ? 'ocultar' : 'mostrar'); filtroNoEndereco('concluidas', valor === 'ocultar' ? 'ocultar' : ''); return;
      case 'arquivadas': setFArquivadas(!!valor); filtroNoEndereco('arquivadas', valor ? '1' : ''); return;
      case 'q': setFBusca(valor); filtroNoEndereco('q', valor); return;
    }
  };
  /** "Limpar tudo": tira os filtros do endereço e mantém pasta, segmento, lista, visão e agrupamento. */
  const limparFiltros = () => {
    setSelecionadas(new Set());
    setTodasListas(false); setFPessoa(''); setFAssignee(''); setFEscopo('todos'); setFPrazo(''); setFStatus(''); setFOpcao('');
    setFCliente(''); setFEtiqueta(''); setFAgente(''); setFConcluidas('mostrar'); setFArquivadas(false); setFBusca('');
    const url = new URL(window.location.href);
    for (const k of CHAVES_DOS_FILTROS) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Na rota de Todas os segmentos ocupam o lugar das pastas; em /trabalho as pastas ficam como estão. */}
      {estrutura && !implantacao && !todasFixa && (
        <BarraDePastas
          pastas={pastasDeTopo} temSoltas={estrutura.listasSoltas.length > 0} atual={fPasta}
          semPastas={estrutura.folders.length === 0} editable={editable} token={token}
          onEscolher={selecionarPasta} onMudou={refresh} onErro={setErro}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* árvore: pastas → listas (só as da pasta escolhida no topo) */}
      {!implantacao && (
      <aside ref={arvore} style={alturaDaArvore ? { maxHeight: alturaDaArvore } : undefined} className="max-h-44 w-full shrink-0 space-y-3 overflow-y-auto border-b border-border pb-2 pr-1 lg:max-h-none lg:w-52 lg:border-b-0 lg:pb-0">
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
            aberto={novaListaAberta} onAbrir={() => setNovaListaAberta(true)} onFechar={() => setNovaListaAberta(false)}
            pastaInicial={fPasta === PASTA_SEM_PASTA ? '' : estrutura.folders.some((f) => f.id === fPasta) ? fPasta : undefined}
          />
        )}
        {estrutura && listasVisiveis.length === 0 && (
          <p className="px-1 text-[12px] text-muted">Nenhuma lista {fPasta ? 'nesta pasta' : 'ainda'}.</p>
        )}
      </aside>
      )}

      {/* miolo: no quadro ele é coluna flexível, para as colunas terem a altura da janela e rolarem cada uma */}
      <div className={`min-w-0 flex-1 ${visao === 'board' && (lista || geral) ? 'flex min-h-0 flex-col gap-3' : 'space-y-4'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{implantacao ? 'Implantação de clientes' : geral ? 'Todas as tarefas' : todasListas ? 'Tarefas da pessoa em todas as listas' : lista?.name ?? 'Trabalho'}</h1>
            <p className="text-sm text-muted">
              {implantacao && lista ? `${PASTA_DA_IMPLANTACAO} · ${lista.name} · ` : ''}
              {geral ? 'Todas as pastas e listas, sem card repetido e sem cadastro como tarefa · ' : ''}
              {!listaId && !semLista && estrutura ? 'Selecione uma lista para ver as tarefas.' : tarefas ? `${visiveis.length} ${visiveis.length === 1 ? 'tarefa' : 'tarefas'}${visiveis.length !== tarefas.total ? ` de ${tarefas.total} na consulta` : ''}` : erro ? 'Consulta indisponível' : 'Carregando…'}
            </p>
          </div>
          {/*
            O CABEÇALHO (rodada da interface U2, 20/10/2026): as ações da lista aberta, as
            formas de ver (Quadro · Lista · Calendário, agrupamento, densidade) e, sempre por
            último, o par [Vistas] [Filtros (n)]. Os filtros moram no painel do botão.
            Nada passa da largura da tela a 390 px.
          */}
          <div className="flex min-w-0 flex-wrap items-center gap-2 [&>select]:min-w-0 [&>select]:max-w-full">
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
                aria-label="Configurar lista (etapas e campos)"
                className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-text"
              >
                <Settings2 size={15} />
              </button>
            )}
            {/* Quadro e Lista: a mesma fonte (WorkTask), duas formas de ver. */}
            <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Visão das tarefas">
              {(['board', 'tabela', 'calendario'] as const).map((v) => (
                <button
                  key={v}
                  data-testid={v === 'board' ? 'trabalho-visao-quadro' : v === 'tabela' ? 'trabalho-visao-lista' : 'trabalho-visao-calendario'}
                  // O quadro da pessoa em todas as listas não existe: escolher Quadro sai dele.
                  onClick={() => { if (v === 'board') sairDoPessoal(); setVisao(v); setSelecionadas(new Set()); filtroNoEndereco('visao', v === 'board' ? 'board' : v === 'tabela' ? 'lista' : 'calendario'); }}
                  aria-pressed={visao === v}
                  className={`px-3 py-1.5 text-sm max-md:min-h-[44px] ${visao === v ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'}`}
                >
                  {v === 'board' ? 'Quadro' : v === 'tabela' ? 'Lista' : 'Calendário'}
                </button>
              ))}
            </div>
            {visao === 'tabela' && (
              <select
                aria-label="Agrupar a lista"
                data-testid="trabalho-agrupar"
                value={fAgrupar}
                onChange={(e) => { const a = e.target.value as Agrupamento; setFAgrupar(a); filtroNoEndereco('agrupar', a === 'nenhum' ? '' : a); }}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none max-md:min-h-[44px]"
              >
                {AGRUPAMENTOS.map((a) => <option key={a} value={a}>{a === 'nenhum' ? 'Sem grupos' : `Agrupar: ${ROTULO_DO_AGRUPAMENTO[a]}`}</option>)}
              </select>
            )}
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
            {/* T3: a vista salva (filtros, densidade e visão), por pessoa, no servidor. A Implantação tem as dela. */}
            <VistasDoQuadro
              token={token}
              tela={implantacao ? 'implantacao' : 'quadro'}
              testId={implantacao ? 'implantacao' : 'trabalho'}
              enderecoTemFiltro={[...CHAVES_DOS_FILTROS, 'visao', 'agrupar'].some((k) => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(k))}
              // As chaves opcionais só entram quando fogem do padrão: a vista salva antes delas continua igual.
              atual={{
                densidade, visao,
                filtros: {
                  assignee: fAssignee, agente: fAgente, statusId: fStatus, cliente: fCliente, escopo: fEscopo, q: fBusca,
                  ...(fPessoa ? { pessoa: fPessoa } : {}), ...(fPrazo ? { prazo: fPrazo } : {}), ...(fEtiqueta ? { etiqueta: fEtiqueta } : {}),
                  ...(fOpcao ? { opcao: fOpcao } : {}), ...(fArquivadas ? { arquivadas: true } : {}),
                },
                ...(fAgrupar !== 'nenhum' ? { agrupamento: fAgrupar } : {}), ...(fConcluidas === 'ocultar' ? { concluidas: 'ocultar' as const } : {}),
              }}
              aplicar={(v: VistaQuadro) => {
                // A vista grava o recorte do quadro na chave `escopo`: sai do "todas as listas".
                setTodasListas(false); setSelecionadas(new Set());
                escolherDensidade(v.densidade); setVisao(v.visao);
                const pessoa = v.filtros.pessoa ?? '';
                setFAssignee(v.filtros.assignee); setFAgente(v.filtros.agente); setFStatus(v.filtros.statusId);
                setFCliente(v.filtros.cliente); setFEscopo(v.filtros.escopo); setFBusca(v.filtros.q);
                setFPessoa(pessoa); setFPrazo(recorteDePrazo(v.filtros.prazo ?? null)); setFEtiqueta(v.filtros.etiqueta ?? '');
                setFOpcao(v.filtros.opcao ?? ''); setFArquivadas(!!v.filtros.arquivadas);
                setFAgrupar(v.agrupamento ?? 'nenhum'); setFConcluidas(v.concluidas ?? 'mostrar');
                const url = new URL(window.location.href);
                for (const [k, val] of [['assignee', v.filtros.assignee], ['agente', v.filtros.agente], ['statusId', v.filtros.statusId], ['cliente', v.filtros.cliente], ['escopo', v.filtros.escopo === 'todos' ? '' : v.filtros.escopo], ['q', v.filtros.q], ['visao', v.visao === 'board' ? '' : v.visao === 'calendario' ? 'calendario' : 'lista'],
                  ['agrupar', v.agrupamento && v.agrupamento !== 'nenhum' ? v.agrupamento : ''], ['concluidas', v.concluidas === 'ocultar' ? 'ocultar' : ''],
                  ['assigneeUserId', pessoa && pessoa !== 'sem-vinculo' ? pessoa : ''], ['semResponsavel', pessoa === 'sem-vinculo' ? '1' : ''],
                  ['prazo', v.filtros.prazo ?? ''], ['tagId', v.filtros.etiqueta ?? ''], ['opcao', v.filtros.opcao ?? ''], ['arquivadas', v.filtros.arquivadas ? '1' : ''], ['overdue', '']] as const) {
                  if (val) url.searchParams.set(k, val); else url.searchParams.delete(k);
                }
                window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
              }}
            />
            <BotaoDeFiltros
              filtros={definicoesDosFiltros}
              valores={valoresDosFiltros}
              aoMudar={mudarFiltro}
              aoLimparTudo={limparFiltros}
              testId={implantacao ? 'implantacao-filtros' : 'trabalho-filtros'}
            />
          </div>
        </div>

        {geral && estrutura && (
          <SegmentosDeTodas
            pastas={pastasDeTopo}
            todasAsPastas={estrutura.folders}
            temSoltas={estrutura.listasSoltas.length > 0}
            atual={fSegmento}
            onEscolher={(seg) => { setSelecionadas(new Set()); setFSegmento(seg); filtroNoEndereco('segmento', seg); }}
          />
        )}

        {implantacao && semImplantacao && (
          <p role="status" data-testid="implantacao-sem-lista" className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            A lista {LISTA_DA_IMPLANTACAO} da pasta {PASTA_DA_IMPLANTACAO} ainda não existe nesta empresa. Ela nasce com o primeiro contrato fechado no comercial, ou pela estrutura sugerida em Tarefas.
          </p>
        )}
        {listaEhImplantacao && editable && (
          <p className="text-[12px] text-muted" data-testid="implantacao-porta">{PORTA_DA_IMPLANTACAO}</p>
        )}
        {/* A2: a terceira porta, sempre a partir de um lead do funil (nunca cartão solto). */}
        {implantacao && (
          <IniciarOnboardingDaImplantacao onIniciado={(r) => { refresh(); tarefaUrl.abrir(r.cardId); }} />
        )}
        {!implantacao && semListas && !erro && <section aria-label="Começar em Trabalho" className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Comece por uma lista</h2>
          <p className="text-sm text-muted">Não há listas disponíveis para sua conta. Uma lista organiza as etapas e recebe as tarefas.</p>
          {editable ? <><p className="text-sm text-muted">Crie uma lista ou escolha um modelo. Depois, adicione uma tarefa na etapa inicial.</p><button type="button" onClick={() => setNovaListaAberta(true)} className="min-h-11 rounded-lg border border-brand-dim px-3 text-sm text-brand">Criar primeira lista</button></> : <p className="text-sm text-muted">Peça a uma pessoa com acesso de edição para criar ou disponibilizar uma lista.</p>}
        </section>}
        {!implantacao && estrutura && can('pauta.ver') && <details className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Conteúdo a partir de uma tarefa</summary>
          <p className="mt-2 text-muted">Abra uma tarefa e escolha “Abrir material e Produção”. Ali você vincula o material, confere a versão e segue as decisões permitidas à sua conta. Após a aprovação, “Preparar conta e horário” leva ao Marketing.</p>
          {can('obsidian.ver') && <a href="/contexto" className="mt-2 inline-block text-brand underline">Criar tarefa usando uma fonte do Contexto</a>}
        </details>}
        {fPrazo && (
          <p role="status" data-testid="trabalho-recorte-prazo" className="flex w-fit items-center gap-2 rounded-full border border-brand-dim bg-brand/10 px-3 py-1 text-[12px]">
            Prazo: {ROTULO_DO_RECORTE(fPrazo)}
            <button type="button" aria-label="Tirar o recorte de prazo" onClick={() => { setFPrazo(''); filtroNoEndereco('prazo', ''); }}><X size={12} /></button>
          </p>
        )}
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
        {lista && !geral && tarefas && visao === 'board' && (
          <Board
            lista={fConcluidas === 'ocultar' ? { ...lista, statuses: lista.statuses.filter((st) => st.type !== 'closed') } : lista}
            tarefas={visiveis} editable={quadroEditavel} podeCriar={quadroEditavel && !listaEhImplantacao} token={token}
            agentes={estrutura?.agentes ?? []} pessoas={estrutura?.pessoas ?? []} trilhos={trilhos} movimento={movimento} densidade={densidade}
            onAbrir={abrirTarefa} onMudou={refresh} onErro={setErro} onMoverEtapa={moverEtapa} onReordenar={reordenar}
          />
        )}
        {/* "Todas as tarefas" no quadro: colunas pelo tipo da etapa; soltar leva à primeira etapa do tipo na lista da tarefa. */}
        {geral && tarefas && visao === 'board' && (
          <Board
            lista={fConcluidas === 'ocultar' ? { ...listaGeral, statuses: listaGeral.statuses.filter((st) => st.type !== 'closed') } : listaGeral}
            tarefas={visiveisNoQuadroGeral} editable={quadroEditavel} podeCriar={false} token={token}
            agentes={estrutura?.agentes ?? []} pessoas={estrutura?.pessoas ?? []} trilhos={trilhos} movimento={new Map()} densidade={densidade}
            semMovimento
            onAbrir={abrirTarefa} onMudou={refresh} onErro={setErro} onMoverEtapa={moverPorTipo} onReordenar={reordenar}
          />
        )}
        {/* A Lista também serve "Todas" e o "todas as listas" da pessoa, sem lista aberta e sem campos de uma lista só. */}
        {(lista || semLista) && tarefas && visao === 'tabela' && (
          <>
            {avisoDoLote && (
              <p role="status" data-testid="trabalho-lote-aviso" className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span>{avisoDoLote}</span>
                <button type="button" aria-label="Fechar aviso" onClick={() => setAvisoDoLote(null)}><X size={14} /></button>
              </p>
            )}
            {editable && selecionadas.size > 0 && estrutura && (
              <BarraDoLote
                quantas={selecionadas.size} pessoas={estrutura.pessoas ?? []}
                etapas={semLista ? null : lista?.statuses ?? null}
                onLimpar={() => setSelecionadas(new Set())}
                onEtapa={(destino) => void aplicarLote((t) => {
                  if (!destino.startsWith('tipo:')) return { statusId: destino };
                  return etapaDoTipo(todasAsListas, t.listId, destino.slice(5)) ?? 'a lista não tem uma etapa desse tipo';
                }, 'Etapa')}
                onConcluir={() => void aplicarLote((t) => {
                  const fechada = etapaDoTipo(todasAsListas, t.listId, 'closed');
                  return fechada ? { statusId: fechada } : 'a lista não tem etapa de concluída';
                }, 'Concluir')}
                onResponsavel={(id) => void aplicarLote(() => ({ assigneeUserId: id }), 'Responsável')}
                onPrazo={(dia) => void aplicarLote(() => ({ dueDate: dia ? prazoDoDia(dia) : null }), 'Prazo')}
              />
            )}
            <Tabela
              tarefas={visiveis} campos={semLista ? [] : camposDaLista.map((c) => c.name)} trilhos={trilhos} onAbrir={abrirTarefa}
              mostrarLista={semLista} pessoas={estrutura?.pessoas ?? []} agrupamento={fAgrupar}
              selecao={editable ? { marcadas: selecionadas, mudar: setSelecionadas } : null}
              onReordenar={editable && !conflitoEtapa ? reordenar : null}
            />
          </>
        )}
        {(lista || semLista) && tarefas && visao === 'calendario' && (
          <CalendarioDeTarefas
            itens={visiveis.map((t) => ({
              id: t.id, titulo: t.title, prazo: t.dueDate, concluida: t.statusType === 'closed',
              detalhe: [t.clienteNome, t.assigneeUserName, semLista ? t.listName : null].filter(Boolean).join(' · '),
            }))}
            podeEditar={quadroEditavel} onAbrir={(id) => abrirTarefa(id)} onMudarPrazo={mudarPrazo}
            testid="trabalho-calendario"
          />
        )}
      </div>
      </div>

      {painelId && estrutura && (
        <PainelTarefa
          key={`${user?.id ?? ''}:${token}:${painelId}`} id={painelId} estrutura={estrutura} editable={editable && !conflitoEtapa} token={token} usuarioId={user?.id ?? null}
          aba={tarefaUrl.aba} onTrocarAba={tarefaUrl.trocarAba} onAbrirOutra={(outra) => abrirTarefa(outra)}
          onFechar={fecharTarefa} onMoverLista={(id) => { if (geral) { refresh(); return; } trocarLista(id); mudarEndereco(id, painelId); }}
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
function Board({ lista, tarefas, editable, podeCriar, token, agentes, pessoas = [], trilhos, movimento, densidade, onAbrir, onMudou, onErro, onMoverEtapa, onReordenar, semMovimento = false }: {
  lista: TrabListaDto; tarefas: TrabTarefaResumo[]; editable: boolean; podeCriar: boolean; token: string | null;
  agentes: TrabAgenteDto[]; pessoas?: PessoaDaEstrutura[]; trilhos: Map<string, TrilhoDoCartao>;
  movimento: Map<string, TrabMovimentoDoCartao>; densidade: Densidade;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void; onMudou: () => void; onErro: (m: string) => void;
  /** Toda troca de etapa (arraste e seletor) passa pela versão lida (`expectedUpdatedAt`). */
  onMoverEtapa: (t: TrabTarefaResumo, statusId: string) => Promise<void>;
  /** Ordem manual: soltar um cartão sobre outro da MESMA coluna grava a sequência da coluna. */
  onReordenar?: (ids: string[]) => Promise<void>;
  /** "Todas as tarefas": o movimento não foi lido, então o cartão não diz "sem movimento". */
  semMovimento?: boolean;
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
    void onMoverEtapa(t, statusId);
  };
  /** Soltar sobre um cartão da mesma coluna: o arrastado entra antes dele (a ordem manual). */
  const soltarSobre = (alvo: TrabTarefaResumo, e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/plain');
    const t = tarefas.find((x) => x.id === id);
    if (!t || t.statusId !== alvo.statusId) return; // outra coluna: a coluna trata (troca de etapa)
    e.preventDefault(); e.stopPropagation(); setSobre(null);
    if (t.id === alvo.id || !onReordenar) return;
    const seq = tarefas.filter((x) => x.statusId === alvo.statusId && x.id !== t.id).map((x) => x.id);
    seq.splice(Math.max(0, seq.indexOf(alvo.id)), 0, t.id);
    void onReordenar(seq);
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
  const caixaDoQuadro = useRef<HTMLDivElement>(null);
  const altura = useAlturaAteOFim(caixaDoQuadro);
  const irParaColuna = (statusId: string) => {
    const alvo = rolagem.current?.querySelector<HTMLElement>(`[data-coluna="${statusId}"]`);
    alvo?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  return (
    <div ref={caixaDoQuadro} data-testid="trabalho-quadro-caixa" className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5" style={altura ? { height: altura, flex: 'none' } : undefined}>
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
                  key={t.id} t={t} lista={lista} editable={editable} token={token} agentes={agentes} pessoas={pessoas} semMovimento={semMovimento}
                  onSoltarSobre={editable ? (e) => soltarSobre(t, e) : undefined}
                  trilho={trilhos.get(t.id) ?? null} mov={movimento.get(t.id) ?? null} densidade={densidade}
                  balaoAberto={balao?.id === t.id}
                  onBalao={(ancora) => setBalao(ancora ? { id: t.id, ancora } : null)}
                  onAbrir={(id, aba) => { setBalao(null); onAbrir(id, aba); }} onMudou={onMudou} onErro={onErro}
                  onMoverEtapa={onMoverEtapa}
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

/*
 * A ALTURA DO QUADRO ATÉ O FIM DA JANELA (versão final, F4). A conta fixa de antes
 * (`100dvh - topo - margem`) não sabia das abas do módulo, da aba da Rodada na
 * Implantação nem da barra de filtros que quebra linha quando o menu lateral recolhe
 * ou expande: a página ganhava rolagem própria e a barra de rolagem LATERAL do quadro
 * ficava abaixo da dobra. Agora o quadro mede onde começa e ocupa o resto da janela;
 * remede ao redimensionar e quando a página muda de tamanho (menu recolhido, filtros).
 * No celular (abaixo de 768 px) as colunas são uma faixa com encaixe e a altura é livre.
 */
function useAlturaAteOFim(ref: React.RefObject<HTMLElement | null>, folga = 24, larguraMinima = 768) {
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el || window.innerWidth < larguraMinima) { setAltura(null); return; }
      const nova = Math.max(340, Math.floor(window.innerHeight - el.getBoundingClientRect().top - folga));
      setAltura((antes) => (antes === nova ? antes : nova));
    };
    medir();
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(document.body);
    const pai = ref.current?.parentElement;
    if (pai) observador?.observe(pai);
    return () => { window.removeEventListener('resize', medir); observador?.disconnect(); };
  }, [ref, folga, larguraMinima]);
  return altura;
}

function Cartao({ t, lista, editable, token, agentes, pessoas = [], onSoltarSobre, semMovimento = false, trilho, mov, densidade, balaoAberto, onBalao, onAbrir, onMudou, onErro, onMoverEtapa }: {
  t: TrabTarefaResumo; lista: TrabListaDto; editable: boolean; token: string | null; semMovimento?: boolean;
  agentes: TrabAgenteDto[]; pessoas?: PessoaDaEstrutura[]; onSoltarSobre?: (e: React.DragEvent) => void;
  trilho: TrilhoDoCartao | null; mov: TrabMovimentoDoCartao | null; densidade: Densidade;
  balaoAberto: boolean; onBalao: (ancora: DOMRect | null) => void;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void; onMudou: () => void; onErro: (m: string) => void;
  onMoverEtapa: (t: TrabTarefaResumo, statusId: string) => Promise<void>;
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
      className={`group relative rounded-lg border bg-surface px-2 py-1.5 transition focus-within:border-brand hover:border-brand-dim ${mov?.procedencia ? `border-border border-l-2 ${mov.procedencia.tipo === 'saiu_do_funil' ? 'border-l-warn' : 'border-l-brand'}` : 'border-border'}`}
      data-work-task-id={t.id}
      data-densidade={densidade}
      draggable={editable}
      onDragStart={editable ? (e) => { esconder(); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onDrop={onSoltarSobre}
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
      {semMovimento ? (
        <p className="mt-0.5 truncate text-[11.5px] text-muted" title={t.listName}>{t.listName ?? ''}</p>
      ) : (
      <p className={`mt-0.5 truncate text-[11.5px] ${mov?.proximaAcao ? 'text-text' : 'text-muted'}`} title={mov?.proximaAcao?.texto ?? undefined}>
        {mov?.proximaAcao ? mov.proximaAcao.texto : 'sem próxima ação'}
        {mov?.proximaAcao?.quando && <span className="text-muted"> · {dataBR(mov.proximaAcao.quando)}</span>}
      </p>
      )}
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
            {/* O responsável é a CONTA (produção, 14/10); o nome antigo em texto fica só no painel. */}
            <ResponsavelDaTarefa tarefa={t} />
            <OutrosResponsaveis ids={t.outrosResponsaveisIds ?? []} pessoas={pessoas} />
            {t.recorrencia && <span title={descreverRecorrencia(t.recorrencia)} className="flex items-center"><Repeat size={10} /><span className="sr-only">{descreverRecorrencia(t.recorrencia)}</span></span>}
            {t.dueDate && <span className={atrasada(t) ? 'text-bad' : ''}>{dataBR(t.dueDate)}</span>}
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
              data-procedencia={mov.procedencia.tipo}
              className={`relative z-10 mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-os-mono text-[10px] ${mov.procedencia.tipo === 'saiu_do_funil' ? 'border-warn/50 text-warn hover:bg-warn/10' : 'border-brand/40 text-brand hover:bg-brand/10'}`}
              title={mov.procedencia.tipo === 'saiu_do_funil' ? 'O lead saiu do funil: decida se o card segue ou é arquivado. Abrir o lead no comercial' : 'Abrir o lead no comercial'}
            >
              {mov.procedencia.rotulo}
            </a>
          )}
          {trilho && <div className="relative z-10"><AtalhoDoTrilho trilho={trilho} onAbrir={() => onAbrir(t.id, 'trilho')} /></div>}
        </>
      )}
      {compacto && mov?.procedencia && <span className="sr-only">{mov.procedencia.rotulo}</span>}
      {!semMovimento && <p
        className="mt-0.5 truncate font-os-mono text-[10px] text-muted"
        data-testid={`trabalho-rodape-${t.id}`}
        title={ultimo ? `${ultimo.quem} · ${ultimo.frase} · ${dataHoraBR(ultimo.em)}` : undefined}
      >
        {ultimo ? `${ultimo.quem} · ${ultimo.frase} · ${haCurto(ultimo.em)}` : 'sem movimento registrado'}
      </p>}
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
            onChange={(e) => { void onMoverEtapa(t, e.target.value); }}
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

type PessoaDaEstrutura = NonNullable<TrabEstrutura['pessoas']>[number];

/*
 * A LISTA (tabela). Serve uma lista, "Todas as tarefas" e o "todas as listas" da
 * pessoa. Versão final, F4: seleção em lote (a caixa de cada linha e a do cabeçalho),
 * agrupamento das vistas (inclusive a régua de prazo do Lucas) e ordem manual
 * (arrastar a linha sobre outra grava a sequência da lista, ou do grupo).
 */
function Tabela({ tarefas, campos, trilhos, onAbrir, mostrarLista = false, pessoas = [], agrupamento = 'nenhum', selecao = null, onReordenar = null }: {
  tarefas: TrabTarefaResumo[]; campos: string[]; trilhos: Map<string, TrilhoDoCartao>;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void;
  mostrarLista?: boolean; pessoas?: PessoaDaEstrutura[]; agrupamento?: Agrupamento;
  selecao?: { marcadas: Set<string>; mudar: (s: Set<string>) => void } | null;
  onReordenar?: ((ids: string[]) => Promise<void>) | null;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const grupos = useMemo(() => {
    const vista = tarefas.map((t) => ({
      t, titulo: t.title, status: t.statusName, statusTipo: t.statusType, lista: t.listName ?? '',
      cliente: t.clienteNome, prioridade: t.priority, prazo: t.dueDate, criadaEm: '',
    }));
    return agruparTarefas(vista, agrupamento, new Date()).map((g) => ({ ...g, itens: g.itens.map((x) => x.t) }));
  }, [tarefas, agrupamento]);
  const colunas = 7 + campos.length + (mostrarLista ? 1 : 0) + (selecao ? 1 : 0);
  const todasMarcadas = !!selecao && tarefas.length > 0 && tarefas.every((t) => selecao.marcadas.has(t.id));
  const marcar = (id: string, sim: boolean) => {
    if (!selecao) return;
    const n = new Set(selecao.marcadas);
    if (sim) n.add(id); else n.delete(id);
    selecao.mudar(n);
  };
  const soltar = (grupo: TrabTarefaResumo[], alvo: string) => {
    const id = arrastando;
    setArrastando(null);
    if (!id || id === alvo || !onReordenar || !grupo.some((t) => t.id === id)) return;
    const seq = grupo.map((t) => t.id).filter((x) => x !== id);
    seq.splice(Math.max(0, seq.indexOf(alvo)), 0, id);
    void onReordenar(seq);
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
            {selecao && (
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox" aria-label="Selecionar todas as tarefas visíveis" data-testid="trabalho-selecionar-todas"
                  checked={todasMarcadas}
                  onChange={(e) => selecao.mudar(e.target.checked ? new Set(tarefas.map((t) => t.id)) : new Set())}
                />
              </th>
            )}
            <th className="px-3 py-2">Tarefa</th>
            {mostrarLista && <th className="px-3 py-2">Lista</th>}
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
        {grupos.map((g) => (
          <tbody key={g.chave} data-grupo={g.chave}>
            {agrupamento !== 'nenhum' && (
              <tr className="border-b border-border bg-surface-2/60">
                <th colSpan={colunas} scope="colgroup" className="px-3 py-1.5 text-left font-os-mono text-[11px] uppercase tracking-wide text-muted">
                  {g.rotulo} · {g.itens.length}
                </th>
              </tr>
            )}
            {g.itens.map((t) => (
              <tr
                key={t.id} data-work-task-id={t.id} onClick={() => onAbrir(t.id)}
                draggable={!!onReordenar}
                onDragStart={onReordenar ? (e) => { setArrastando(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                onDragEnd={() => setArrastando(null)}
                onDragOver={onReordenar ? (e) => { if (arrastando) e.preventDefault(); } : undefined}
                onDrop={onReordenar ? (e) => { e.preventDefault(); soltar(g.itens, t.id); } : undefined}
                className={`cursor-pointer border-b border-border/50 hover:bg-surface-2/50 ${arrastando === t.id ? 'opacity-50' : ''}`}
              >
                {selecao && (
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox" aria-label={`Selecionar ${t.title}`} data-testid={`trabalho-selecionar-${t.id}`}
                      checked={selecao.marcadas.has(t.id)} onChange={(e) => marcar(t.id, e.target.checked)}
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <button onClick={(e) => { e.stopPropagation(); onAbrir(t.id); }} className="text-left hover:text-brand focus-visible:outline-brand">{t.title}</button>
                  {t.recorrencia && <span title={descreverRecorrencia(t.recorrencia)} className="ml-1 inline-flex align-middle text-muted"><Repeat size={11} /><span className="sr-only">{descreverRecorrencia(t.recorrencia)}</span></span>}
                  {trilhos.get(t.id) && <AtalhoDoTrilho trilho={trilhos.get(t.id)!} onAbrir={() => onAbrir(t.id, 'trilho')} />}
                </td>
                {mostrarLista && <td className="px-3 py-2 text-muted">{t.listName ?? '—'}</td>}
                <td className="px-3 py-2">{t.clienteNome ?? <span className="font-os-mono text-[10px] text-warn">sem cliente</span>}</td>
                <td className="px-3 py-2">
                  <span className="rounded px-1.5 py-0.5 text-[11px] capitalize" style={{ background: `${t.statusColor}26`, color: t.statusColor }}>
                    {t.statusName}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize">{t.priority}</td>
                <td className="px-3 py-2"><ResponsavelDaTarefa tarefa={t} /> <OutrosResponsaveis ids={t.outrosResponsaveisIds ?? []} pessoas={pessoas} /></td>
                <td className="px-3 py-2" title={t.agenteId ? `Assumida em ${dataHoraBR(t.agenteEm)}` : undefined}>
                  {nomeDoAgente(t) ?? '—'}
                </td>
                <td className={`px-3 py-2 ${atrasada(t) ? 'text-bad' : ''}`}>{dataBR(t.dueDate)}</td>
                {campos.map((c) => {
                  const v = t.values.find((x) => x.fieldName === c);
                  const valor = v?.type === 'moeda' && v.value ? formatarValorMonetario(v.value) : v?.value;
                  return <td key={c} className="px-3 py-2 text-muted">{v?.optionName ?? valor ?? '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        ))}
        {tarefas.length === 0 && (
          <tbody><tr><td colSpan={colunas} className="px-3 py-6 text-center text-muted">Nada por aqui.</td></tr></tbody>
        )}
      </table>
    </div>
  );
}

/*
 * A BARRA DO LOTE (versão final, F4): etapa, responsável, prazo e concluir para as
 * tarefas marcadas. Numa lista, as etapas são as dela; em "Todas" (várias listas), o
 * tipo da etapa, que cada tarefa traduz para a primeira etapa daquele tipo na lista dela.
 */
function BarraDoLote({ quantas, pessoas, etapas, onLimpar, onEtapa, onConcluir, onResponsavel, onPrazo }: {
  quantas: number; pessoas: PessoaDaEstrutura[]; etapas: TrabListaDto['statuses'] | null;
  onLimpar: () => void; onEtapa: (statusId: string) => void; onConcluir: () => void;
  onResponsavel: (id: string | null) => void; onPrazo: (dia: string | null) => void;
}) {
  const [dia, setDia] = useState('');
  const campo = 'rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand-dim';
  return (
    <div role="group" aria-label="Alterar as tarefas selecionadas" data-testid="trabalho-lote" className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-brand-dim bg-surface px-3 py-2">
      <span className="text-sm"><b className="font-os-mono">{quantas}</b> {quantas === 1 ? 'selecionada' : 'selecionadas'}</span>
      <select aria-label="Mover as selecionadas de etapa" value="" onChange={(e) => e.target.value && onEtapa(e.target.value)} className={campo}>
        <option value="">Etapa…</option>
        {(etapas ?? COLUNAS_POR_TIPO).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
      </select>
      <select aria-label="Responsável das selecionadas" value="" onChange={(e) => e.target.value && onResponsavel(e.target.value === 'sem-vinculo' ? null : e.target.value)} className={campo}>
        <option value="">Responsável…</option>
        {pessoas.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{rotuloDaPessoa(p)}</option>)}
        <option value="sem-vinculo">Sem vínculo de pessoa</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        Prazo
        <input type="date" aria-label="Prazo das selecionadas" value={dia} onChange={(e) => setDia(e.target.value)} className={campo} />
        <button type="button" disabled={!dia} onClick={() => { onPrazo(dia); setDia(''); }} className="rounded-md border border-border px-2 py-1 text-sm hover:border-brand-dim disabled:opacity-50">Aplicar</button>
      </label>
      <button type="button" data-testid="trabalho-lote-concluir" onClick={onConcluir} className="rounded-md bg-brand/15 px-3 py-1 text-sm text-brand hover:bg-brand/25">Concluir</button>
      <button type="button" onClick={onLimpar} className="ml-auto text-sm text-muted hover:text-text">Limpar seleção</button>
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
          key={`${user?.id ?? ''}:${token}:${tarefa.tarefaId}`} id={tarefa.tarefaId} estrutura={estrutura} editable={can('tarefas.editar')}
          token={token} usuarioId={user?.id ?? null} aba={tarefa.aba} onTrocarAba={tarefa.trocarAba} onAbrirOutra={(outra) => tarefa.abrir(outra)}
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
function PainelTarefa({ id, estrutura, editable, token, usuarioId, aba = 'tarefa', onTrocarAba, onFechar, onMoverLista, onMudou, onErro, onAbrirOutra }: {
  id: string; estrutura: TrabEstrutura; editable: boolean; token: string | null;
  aba?: AbaDaTarefa; onTrocarAba?: (aba: AbaDaTarefa) => void;
  /** Abre outra tarefa no mesmo pop-up (a próxima ocorrência). */
  onAbrirOutra?: (id: string) => void;
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
  const [descricaoRascunho, setDescricaoRascunho] = useState('');
  const [salvando, setSalvando] = useState(false);
  // A próxima ocorrência que a conclusão de uma tarefa que se repete criou (versão final, F4).
  const [proxima, setProxima] = useState<{ id: string; dueDate: string | null } | null>(null);
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
      const gravada = await apiPatch<TrabTarefaDetalhe | null>(`/trabalho/tarefas/${id}`, { ...mudanca, expectedUpdatedAt: t.updatedAt }, token);
      if (!vigente(epoch)) return false;
      if (gravada?.proxima) setProxima(gravada.proxima);
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
    const rotulos: Record<string, string> = { title: 'Título', description: 'Descrição', statusId: 'Etapa', listId: 'Lista', assigneeUserId: 'Responsável', priority: 'Prioridade', dueDate: 'Prazo', startDate: 'Início', tagIds: 'Etiquetas', campos: 'Campos da tarefa', archived: 'Arquivamento', clienteId: 'Cliente', outrosResponsaveisIds: 'Outros responsáveis', recorrencia: 'Repetir' };
    let texto = campo === 'archived' ? valor ? 'Arquivar tarefa' : 'Restaurar tarefa' : valor == null ? 'Sem valor' : String(valor);
    if (campo === 'assigneeUserId') { const pessoa = estrutura.pessoas?.find((p) => p.id === valor); texto = valor == null ? 'Sem vínculo de pessoa' : pessoa ? rotuloDaPessoa(pessoa) : 'Pessoa indisponível'; }
    if (campo === 'statusId') texto = lista?.statuses.find((st) => st.id === valor)?.name ?? 'Etapa indisponível';
    if (campo === 'listId') texto = nomesListas.get(String(valor)) ?? 'Lista indisponível';
    if (campo === 'clienteId') texto = valor === t.clienteId ? t.clienteNome ?? 'Cliente atual' : 'Outro cliente escolhido';
    if (campo === 'outrosResponsaveisIds' && Array.isArray(valor)) texto = valor.map((u) => { const pessoa = estrutura.pessoas?.find((x) => x.id === u); return pessoa ? rotuloDaPessoa(pessoa) : 'Pessoa indisponível'; }).join(', ') || 'Ninguém além do principal';
    if (campo === 'recorrencia') texto = valor ? descreverRecorrencia(valor as RecorrenciaDaTarefa) : 'Não repete';
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
          data-testid="tarefa-popup"
          className={`fixed z-50 flex flex-col border-border bg-surface shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[92dvh] max-md:rounded-t-xl max-md:border-t md:inset-y-0 md:right-0 md:border-l ${aba === 'trilho' && trilho ? 'md:w-[min(1040px,100vw)]' : 'md:w-[520px]'} w-full md:max-w-full`}
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
        {trilho ? (
          <button type="button" onClick={() => onTrocarAba?.('trilho')} className="block w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[12px] underline-offset-2 hover:underline">
            Trilho de onboarding · {trilho.faseRotulo}{trilho.faltando.length ? ` · falta ${trilho.faltando.length}` : ' · portão cumprido'}
          </button>
        ) : trilho === null && listaDaImplantacao(estrutura.folders)?.listaId === t.listId ? (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">Sem trilho de onboarding ligado a este cartão.</p>
        ) : null}
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
            <SeletorResponsavel tarefa={t} pessoas={estrutura.pessoas ?? []} disabled={ro} onChange={(assigneeUserId) => salvar({ assigneeUserId })} />
          </Campo>
          {/* Vários responsáveis (versão final, F4): o primeiro é o principal, acima; os demais aqui. */}
          <Campo rotulo="Outros responsáveis">
            <SeletorOutrosResponsaveis
              principal={t.assigneeUserId ?? null} ids={t.outrosResponsaveisIds ?? []} pessoas={estrutura.pessoas ?? []}
              disabled={ro} onChange={(outrosResponsaveisIds) => salvar({ outrosResponsaveisIds })}
            />
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
        <RepetirTarefa regra={t.recorrencia ?? null} prazo={t.dueDate} disabled={ro} onChange={(recorrencia) => salvar({ recorrencia })} />
        {proxima && (
          <p role="status" data-testid="tarefa-proxima" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
            Próxima ocorrência criada para {dataBR(proxima.dueDate)}.{' '}
            <button type="button" className="text-brand underline" onClick={() => onAbrirOutra?.(proxima.id)}>Abrir</button>
          </p>
        )}

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

/*
 * REPETIR (versão final, F4, no molde do Dia a dia do Lucas): a regra mora na tarefa;
 * ao concluí-la (por qualquer caminho), a API cria a próxima ocorrência com o prazo
 * seguinte. Gravar a regra é um PATCH com a versão lida, como todo campo do pop-up.
 */
function RepetirTarefa({ regra, prazo, disabled, onChange }: {
  regra: RecorrenciaDaTarefa | null; prazo: string | null; disabled: boolean;
  onChange: (r: RecorrenciaDaTarefa | null) => Promise<unknown>;
}) {
  const modo = !regra ? '' : regra.tipo === 'semanal' && [...regra.dias].sort().join() === '1,2,3,4,5' ? 'uteis' : regra.tipo;
  const dia = paraInputDate(prazo);
  const diaDoMes = dia ? Number(dia.slice(8)) : 1;
  const diaDaSemana = dia ? new Date(`${dia}T12:00:00Z`).getUTCDay() : 1;
  const mudarModo = (m: string) => {
    if (!m) return void onChange(null);
    if (m === 'diaria') return void onChange({ tipo: 'diaria' });
    if (m === 'uteis') return void onChange({ tipo: 'semanal', dias: [1, 2, 3, 4, 5] });
    if (m === 'semanal') return void onChange({ tipo: 'semanal', dias: [diaDaSemana] });
    if (m === 'mensal') return void onChange({ tipo: 'mensal', dia: diaDoMes });
    if (m === 'intervalo') return void onChange({ tipo: 'intervalo', dias: 2 });
  };
  const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return (
    <div data-testid="tarefa-repetir">
      <Campo rotulo="Repetir">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Repetir a tarefa" disabled={disabled} value={modo} onChange={(e) => mudarModo(e.target.value)} className={`${INP} w-auto`}>
            <option value="">Não repete</option>
            <option value="diaria">Todo dia</option>
            <option value="uteis">Dias úteis (segunda a sexta)</option>
            <option value="semanal">Toda semana…</option>
            <option value="mensal">Todo mês…</option>
            <option value="intervalo">A cada N dias…</option>
          </select>
          {regra?.tipo === 'semanal' && modo === 'semanal' && (
            <span className="flex gap-1">
              {LETRAS.map((l, i) => {
                const marcado = regra.dias.includes(i);
                return (
                  <button
                    key={i} type="button" disabled={disabled} title={NOMES[i]} aria-label={NOMES[i]} aria-pressed={marcado}
                    onClick={() => { const dias = marcado ? regra.dias.filter((x) => x !== i) : [...regra.dias, i]; if (dias.length) void onChange({ tipo: 'semanal', dias }); }}
                    className={`h-7 w-7 rounded-full text-xs ${marcado ? 'bg-brand/25 text-text' : 'border border-border text-muted hover:border-brand-dim'}`}
                  >
                    {l}
                  </button>
                );
              })}
            </span>
          )}
          {regra?.tipo === 'mensal' && (
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              no dia
              <input type="number" min={1} max={31} disabled={disabled} defaultValue={regra.dia} aria-label="Dia do mês"
                onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 31 && n !== regra.dia) void onChange({ tipo: 'mensal', dia: n }); }}
                className={`${INP} w-16`} />
            </label>
          )}
          {regra?.tipo === 'intervalo' && (
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              a cada
              <input type="number" min={1} max={365} disabled={disabled} defaultValue={regra.dias} aria-label="Intervalo em dias"
                onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 365 && n !== regra.dias) void onChange({ tipo: 'intervalo', dias: n }); }}
                className={`${INP} w-16`} />
              dias
            </label>
          )}
        </div>
      </Campo>
      {regra && (
        <p className="mt-1 text-[11px] text-muted">
          {descreverRecorrencia(regra)}. Ao concluir, a próxima nasce sozinha{prazo ? '' : ' (sem prazo, conta a partir do dia em que for concluída)'}.
        </p>
      )}
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

function NovaLista({ folders, token, aberto, onAbrir, onFechar, onDone, onErro, pastaInicial }: {
  folders: TrabEstrutura['folders']; token: string | null; aberto: boolean; onAbrir: () => void; onFechar: () => void; onDone: () => void; onErro: (m: string) => void;
  /** A pasta escolhida no topo; ausente = a primeira pasta. */
  pastaInicial?: string;
}) {
  const nomeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (aberto) nomeInput.current?.focus(); }, [aberto]);
  const [nome, setNome] = useState('');
  const [pasta, setPasta] = useState(pastaInicial ?? folders[0]?.id ?? '');
  if (!aberto) {
    return (
      <button onClick={() => onAbrir()} className="flex items-center gap-1 px-2 text-[12px] text-muted hover:text-brand">
        <Plus size={12} /> nova lista
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-2">
      <input ref={nomeInput} aria-label="Nome da nova lista" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da lista" className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none" />
      <select value={pasta} onChange={(e) => setPasta(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs outline-none">
        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        <option value="">Sem pasta</option>
      </select>
      <div className="flex gap-1">
        <button
          onClick={() =>
            nome.trim() &&
            apiPost('/trabalho/listas', { folderId: pasta || null, name: nome.trim() }, token)
              .then(() => { setNome(''); onFechar(); onDone(); })
              .catch((e) => onErro(e.message))
          }
          className="rounded bg-brand/15 px-2 py-1 text-xs text-brand"
        >
          Criar
        </button>
        <button onClick={() => onFechar()} className="px-2 py-1 text-xs text-muted">Cancelar</button>
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
                .then(() => { setNome(''); onFechar(); onDone(); })
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
 * OS SEGMENTOS DE "TODAS" (rodada da interface U3, 20/10/2026).
 *
 * "Todas as tarefas" junta as tarefas de todas as pastas e listas; o segmento recorta
 * por uma pasta de TOPO (as subpastas entram) ou só as listas soltas. O estado mora em
 * `?segmento=` e a API recorta com `segmentoId`. "Todas" tira o recorte.
 */
function SegmentosDeTodas({ pastas, todasAsPastas, temSoltas, atual, onEscolher }: {
  pastas: TrabEstrutura['folders']; todasAsPastas: TrabEstrutura['folders']; temSoltas: boolean; atual: string;
  onEscolher: (segmento: string) => void;
}) {
  const desconhecido = !!atual && atual !== SEGMENTO_SEM_PASTA && !todasAsPastas.some((f) => f.id === atual);
  const chip = (chave: string, rotulo: string, testid: string) => (
    <button
      key={testid}
      type="button"
      data-testid={testid}
      aria-pressed={atual === chave}
      onClick={() => onEscolher(chave)}
      title={rotulo}
      className={[
        'max-w-48 truncate rounded-full border px-3 py-1 text-[12px] transition max-md:min-h-[44px]',
        atual === chave ? 'border-brand-dim bg-brand/15 text-text' : 'border-border bg-surface text-muted hover:text-text',
      ].join(' ')}
    >
      {rotulo}
    </button>
  );
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Segmentos" data-testid="trabalho-segmentos">
        <span className="mr-1 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Segmento</span>
        {chip('', 'Todas', 'trabalho-segmento-todas')}
        {pastas.map((p) => chip(p.id, p.name, `trabalho-segmento-${p.id}`))}
        {(temSoltas || atual === SEGMENTO_SEM_PASTA) && chip(SEGMENTO_SEM_PASTA, 'Sem pasta', 'trabalho-segmento-sem-pasta')}
      </div>
      {desconhecido && (
        <p role="status" className="text-[12px] text-muted">A pasta deste link não existe nesta empresa. Escolha um segmento ou volte a Todas.</p>
      )}
    </div>
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
  // Sem pasta escolhida, a árvore mostra tudo e uma lista fica aberta: nenhum chip marcado.
  const ativa = atual === PASTA_SEM_PASTA || atual === PASTA_TODAS ? atual : existe(atual) ? atual : '';

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
        {/* "Todas" (versão final, F4): as tarefas de todas as pastas e listas numa visão só. */}
        {chip(PASTA_TODAS, 'Todas', 'trabalho-pasta-todas')}
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
