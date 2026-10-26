'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrabEstrutura, TrabTarefaLista, TrabTarefaResumo } from '@mktos/shared';

import {
  CAMPOS_DE_ORDEM, COLUNAS_DE_MINHAS_TAREFAS, ROTULO_DO_CAMPO_DE_ORDEM, AGRUPAMENTOS, ROTULO_DO_AGRUPAMENTO,
  VISTA_PADRAO_DE_MINHAS_TAREFAS, ordenarTarefas,
  type Agrupamento, type CampoDeOrdem, type ColunaDeMinhasTarefas, type VistaMinhasTarefas, type VistaSalvaDto,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { useAuth } from '@/lib/auth';
import { tarefasDeTrabalho } from '@/lib/work-projection';
import { hojeEmBrasilia } from '@/lib/horas';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { MenuDaTarefaProvider } from '@/components/trabalho/MenuDaTarefa';
import { soDaEquipe, useIdsDaEquipe } from '@/components/trabalho/ResponsavelDaTarefa';
import { CalendarioDeTarefas, diaDoPrazo, prazoDoDia } from '@/components/trabalho/CalendarioDeTarefas';
import { AvisoDoLote, BarraDoLote, Tabela, atrasada, useEscritaDasTarefas } from '@/components/trabalho/TabelaDeTarefas';
import {
  BOTAO_PEQUENO,
  Carregando,
  ErroComRetentativa,
  FOCO,
  ROTULO,
  SELECT,
  Vazio,
} from './comum';

/*
 * A ABA MINHAS TAREFAS — as suas tarefas, na MESMA Lista do Trabalho.
 *
 * Layout 26/10: deixou de ser só leitura. A fonte é a do "todas as listas" da
 * pessoa no Trabalho (`/trabalho/tarefas?assigneeUserId=<você>`, a principal ou
 * uma das demais), e a tela é a Lista do Trabalho (`TabelaDeTarefas.tsx`): caixa
 * de seleção e a barra do lote (etapa, responsável, prazo, concluir), responsável,
 * agente e prazo editando na própria linha, ordem manual, e o clique na linha
 * abre o pop-up único da tarefa. Concluídas ficam escondidas até "Mostrar
 * concluídas". As vistas salvas, a ordenação, o agrupamento, o calendário e os
 * filtros continuam; lista, pasta, status, vencimento e cliente filtram aqui,
 * sobre o que chegou.
 */

// As colunas da vista salva continuam no formato (a vista é estrita); a Lista do Trabalho tem as dela.
export const COLUNAS = COLUNAS_DE_MINHAS_TAREFAS;
export type Coluna = ColunaDeMinhasTarefas;
export const CHAVE_DAS_COLUNAS = 'caixa.tarefas.colunas.v1';

const ROTULO_DO_VENCIMENTO: Record<Exclude<VistaMinhasTarefas['filtros']['vencimento'], ''>, string> = {
  vencidas: 'Vencidas',
  hoje: 'Vencem hoje',
  semana: 'Próximos 7 dias',
};

function lerColunas(): Set<Coluna> {
  try {
    const bruto = window.localStorage.getItem(CHAVE_DAS_COLUNAS);
    if (!bruto) return new Set(VISTA_PADRAO_DE_MINHAS_TAREFAS.colunas);
    const lidas = (JSON.parse(bruto) as unknown[]).filter((c): c is Coluna =>
      (COLUNAS as readonly string[]).includes(c as string),
    );
    return new Set(lidas);
  } catch {
    return new Set(VISTA_PADRAO_DE_MINHAS_TAREFAS.colunas);
  }
}

/*
 * AS VISTAS (rodada do trabalho T3, 19/10/2026). A pessoa escolhe ordenação
 * (qualquer coluna, crescente ou decrescente), agrupamento (vencimento no estilo
 * ClickUp, status, cliente, lista) e filtros, e SALVA como vista com nome, uma
 * marcada como padrão, no servidor (`/trabalho/vistas`). A primeira vez, a
 * preferência antiga de colunas do navegador vira a vista padrão.
 */
const CHAVE_DA_MIGRACAO = 'caixa.tarefas.vistas.migrado.v1';

/*
 * TABELA OU CALENDÁRIO (versão final, F4): o calendário do Lucas é uma das formas de
 * ver Minhas tarefas, o MESMO componente do Trabalho. Arrastar muda o prazo por um
 * PATCH com a versão lida; a preferência fica neste navegador.
 */
export const CHAVE_DA_FORMA = 'caixa.tarefas.forma.v1';
type Forma = 'tabela' | 'calendario';
function lerForma(): Forma {
  try { return window.localStorage.getItem(CHAVE_DA_FORMA) === 'calendario' ? 'calendario' : 'tabela'; } catch { return 'tabela'; }
}

/*
 * Layout 26/10: A ORDEM MANUAL é uma escolha a mais do "Ordenar por", como o
 * "Ordem manual" do ClickUp. Com ela a lista vem na ordem gravada (a do Trabalho)
 * e arrastar uma linha grava a sequência. Fica neste navegador: a vista salva tem
 * a forma estrita do servidor e não guarda essa chave.
 */
export const CHAVE_DA_ORDEM_MANUAL = 'caixa.tarefas.ordem-manual.v1';
const MANUAL = 'manual';
function lerOrdemManual(): boolean {
  try { return window.localStorage.getItem(CHAVE_DA_ORDEM_MANUAL) === '1'; } catch { return false; }
}

function configInicial(): VistaMinhasTarefas {
  return { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, colunas: [...lerColunas()] };
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

const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** O vencimento da vista, no dia de Brasília: vencidas, hoje, ou de hoje até o sétimo dia (hoje + 6). */
function cabeNoVencimento(t: TrabTarefaResumo, v: VistaMinhasTarefas['filtros']['vencimento']): boolean {
  if (!v) return true;
  if (v === 'vencidas') return atrasada(t);
  const dia = diaDoPrazo(t.dueDate);
  const hoje = hojeEmBrasilia();
  if (!dia) return false;
  return v === 'hoje' ? dia === hoje : dia >= hoje && dia <= somaDias(hoje, 6);
}

/*
 * Por que a tarefa pede atenção, na linha embaixo do nome (as mesmas regras de
 * Pendências): prazo vencido, sem movimento há mais de 7 dias, travada com um
 * agente há mais de 24h. Tudo sai do que a lista já trouxe, sem outra consulta.
 */
const SETE_DIAS = 7 * 86_400_000;
const UM_DIA = 86_400_000;
function motivosDaTarefa(t: TrabTarefaResumo, agora: number): string[] {
  if (t.statusType === 'closed') return [];
  const m: string[] = [];
  if (atrasada(t)) m.push('prazo vencido');
  if (t.updatedAt && agora - Date.parse(t.updatedAt) > SETE_DIAS) m.push('parada há mais de uma semana');
  if (t.agenteId && t.agenteEm && agora - Date.parse(t.agenteEm) > UM_DIA) m.push('travada com um agente');
  return m;
}

export function AbaMinhasTarefas({ token }: { token: string }) {
  // A tarefa abre num pop-up por cima da tabela (rodada do trabalho T2): ninguém sai de Pendências.
  const popup = useTarefaNaUrl();
  const { can, user } = useAuth();
  const editable = can('tarefas.editar');
  // Layout 26/10 (P-16): para escolher responsável, só a equipe (a regra da tela Equipe).
  const idsDaEquipe = useIdsDaEquipe(token);
  const [forma, setForma] = useState<Forma>('tabela');
  useEffect(() => { setForma(lerForma()); }, []);
  const escolherForma = (f: Forma) => {
    setForma(f);
    try { window.localStorage.setItem(CHAVE_DA_FORMA, f); } catch { /* sem armazenamento: vale nesta visita */ }
  };
  const [ordemManual, setOrdemManual] = useState(false);
  useEffect(() => { setOrdemManual(lerOrdemManual()); }, []);
  const escolherOrdemManual = (sim: boolean) => {
    setOrdemManual(sim);
    try { window.localStorage.setItem(CHAVE_DA_ORDEM_MANUAL, sim ? '1' : '0'); } catch { /* sem armazenamento: vale nesta visita */ }
  };
  const [config, setConfig] = useState<VistaMinhasTarefas>(VISTA_PADRAO_DE_MINHAS_TAREFAS);
  const [vistas, setVistas] = useState<VistaSalvaDto[]>([]);
  const [vistaId, setVistaId] = useState<string>('');
  const [avisoDaVista, setAvisoDaVista] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [tarefas, setTarefas] = useState<TrabTarefaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoDeEscrita, setAvisoDeEscrita] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [bump, setBump] = useState(0);
  // Layout 26/10: como no Trabalho (e no ClickUp), concluída some; só volta pelo botão.
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const pedido = useRef(0);
  const filtros = config.filtros;
  const refresh = useCallback(() => setBump((b) => b + 1), []);

  /*
   * Ao abrir: a vista padrão vale; sem nenhuma vista e com a preferência antiga
   * de colunas no navegador, ela vira a vista padrão (uma vez só).
   */
  useEffect(() => {
    let vivo = true;
    const inicial = configInicial();
    setConfig(inicial);
    apiGet<VistaSalvaDto[]>('/trabalho/vistas?tela=minhas-tarefas', token)
      .then(async (lidas) => {
        if (!vivo) return;
        const lista = Array.isArray(lidas) ? lidas : [];
        const padrao = lista.find((v) => v.padrao);
        if (padrao) {
          setVistas(lista); setVistaId(padrao.id); setConfig(padrao.config as VistaMinhasTarefas);
          return;
        }
        let migrar = false;
        try { migrar = lista.length === 0 && !!window.localStorage.getItem(CHAVE_DAS_COLUNAS) && !window.localStorage.getItem(CHAVE_DA_MIGRACAO); } catch { /* sem armazenamento */ }
        if (migrar) {
          const criada = await apiPost<VistaSalvaDto>('/trabalho/vistas', { tela: 'minhas-tarefas', nome: 'Minha vista', padrao: true, config: inicial }, token);
          try { window.localStorage.setItem(CHAVE_DA_MIGRACAO, '1'); } catch { /* sem armazenamento */ }
          if (vivo && criada?.id) { setVistas([criada]); setVistaId(criada.id); }
          return;
        }
        setVistas(lista);
      })
      .catch(() => { /* sem vistas do servidor: vale a preferência deste navegador */ });
    return () => { vivo = false; };
  }, [token]);

  // A árvore (listas, etapas, pessoas, agentes): o lote, as células e o filtro de pasta leem daqui.
  useEffect(() => {
    let vivo = true;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => { if (vivo) setEstrutura(e); })
      .catch(() => { /* sem a árvore: a lista aparece, sem o lote e sem editar na linha */ });
    return () => { vivo = false; };
  }, [token]);

  const mudar = (m: Partial<VistaMinhasTarefas>) => setConfig((c) => ({ ...c, ...m }));
  const mudarFiltro = (m: Partial<VistaMinhasTarefas['filtros']>) => { setSelecionadas(new Set()); setConfig((c) => ({ ...c, filtros: { ...c.filtros, ...m } })); };

  const escolherVista = (id: string) => {
    setVistaId(id);
    setAvisoDaVista(null);
    const v = vistas.find((x) => x.id === id);
    if (v) setConfig(v.config as VistaMinhasTarefas);
  };

  const salvarComo = async () => {
    const nome = window.prompt('Nome da vista (por exemplo, "Por cliente" ou "Atrasadas primeiro")')?.trim();
    if (!nome) return;
    try {
      const criada = await apiPost<VistaSalvaDto>('/trabalho/vistas', { tela: 'minhas-tarefas', nome, padrao: vistas.length === 0, config }, token);
      setVistas((l) => [...l.filter((x) => x.id !== criada.id), criada]);
      setVistaId(criada.id);
      setAvisoDaVista(`Vista "${criada.nome}" salva.`);
    } catch (e) { setAvisoDaVista((e as Error).message); }
  };

  const atualizarVista = async () => {
    if (!vistaId) return;
    try {
      const nova = await apiPatch<VistaSalvaDto>(`/trabalho/vistas/${vistaId}`, { config }, token);
      setVistas((l) => l.map((x) => (x.id === nova.id ? nova : x)));
      setAvisoDaVista(`Vista "${nova.nome}" atualizada.`);
    } catch (e) { setAvisoDaVista((e as Error).message); }
  };

  const marcarPadrao = async () => {
    if (!vistaId) return;
    try {
      const nova = await apiPatch<VistaSalvaDto>(`/trabalho/vistas/${vistaId}`, { padrao: true }, token);
      setVistas((l) => l.map((x) => (x.id === nova.id ? nova : { ...x, padrao: false })));
      setAvisoDaVista(`"${nova.nome}" é a sua vista padrão.`);
    } catch (e) { setAvisoDaVista((e as Error).message); }
  };

  const vistaAtual = vistas.find((v) => v.id === vistaId) ?? null;
  const modificada = !!vistaAtual && JSON.stringify(vistaAtual.config) !== JSON.stringify(config);

  /*
   * A CONSULTA é a do "todas as listas" da pessoa no Trabalho (`escopo=pessoal`):
   * as suas tarefas pela conta. "Qualquer pessoa" lê "Todas as tarefas" do Trabalho
   * (`todas=1`: sem card repetido e sem cadastro como tarefa). O resto filtra aqui.
   */
  const eu = user?.id ?? null;
  useEffect(() => {
    if (filtros.responsavel === 'eu' && !eu) return;
    const n = ++pedido.current;
    setCarregando(true);
    setErro(null);
    const p = new URLSearchParams(filtros.responsavel === 'qualquer' ? { todas: '1' } : { assigneeUserId: eu! });
    tarefasDeTrabalho(token, p, () => n === pedido.current)
      .then((r) => { if (n === pedido.current) { setTarefas(r); setSelecionadas(new Set()); } })
      .catch((e) => { if (n === pedido.current) setErro((e as Error).message); })
      .finally(() => { if (n === pedido.current) setCarregando(false); });
  }, [filtros.responsavel, eu, token, bump]);

  const escrita = useEscritaDasTarefas({
    itens: tarefas?.items, editable, token, onMudou: refresh, onErro: setAvisoDeEscrita,
    selecionadas, limparSelecao: () => setSelecionadas(new Set()),
  });

  const todasAsListas = useMemo(() => (estrutura ? [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas] : []), [estrutura]);
  const pastaDaLista = useMemo(() => {
    const m = new Map<string, { id: string; nome: string }>();
    for (const f of estrutura?.folders ?? []) for (const l of f.lists) m.set(l.id, { id: f.id, nome: f.name });
    return m;
  }, [estrutura]);

  // As listas e pastas do filtro: as que têm tarefa sua (como antes), com a pasta da árvore.
  const listasComTarefa = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tarefas?.items ?? []) if (!m.has(t.listId)) m.set(t.listId, t.listName ?? 'Lista');
    return [...m.entries()].map(([id, nome]) => ({ id, nome, pasta: pastaDaLista.get(id) ?? null }))
      .sort((a, b) => `${a.pasta?.nome ?? ''} / ${a.nome}`.localeCompare(`${b.pasta?.nome ?? ''} / ${b.nome}`, 'pt-BR'));
  }, [tarefas, pastaDaLista]);
  const pastas = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listasComTarefa) if (l.pasta) m.set(l.pasta.id, l.pasta.nome);
    return [...m.entries()];
  }, [listasComTarefa]);
  const statusNaLista = useMemo(
    () => [...new Set((tarefas?.items ?? []).map((t) => t.statusName))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [tarefas],
  );
  const clientesNaLista = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tarefas?.items ?? []) if (t.clienteId && t.clienteNome) m.set(t.clienteId, t.clienteNome);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [tarefas]);

  const ocultasPorConcluidas = useMemo(
    () => (!mostrarConcluidas && !filtros.status ? (tarefas?.items ?? []).filter((t) => t.statusType === 'closed').length : 0),
    [tarefas, mostrarConcluidas, filtros.status],
  );
  const visiveis = useMemo(() => {
    let itens = tarefas?.items ?? [];
    if (filtros.lista.startsWith('lista:')) itens = itens.filter((t) => t.listId === filtros.lista.slice(6));
    if (filtros.lista.startsWith('pasta:') && estrutura) {
      const dentro = pastaEDescendentes(estrutura.folders, filtros.lista.slice(6));
      itens = itens.filter((t) => dentro.has(pastaDaLista.get(t.listId)?.id ?? ''));
    }
    // Escolher um status mostra aquele status, concluído ou não; sem escolha, as concluídas seguem o botão.
    if (filtros.status) itens = itens.filter((t) => t.statusName === filtros.status);
    else if (!mostrarConcluidas) itens = itens.filter((t) => t.statusType !== 'closed');
    if (filtros.vencimento) itens = itens.filter((t) => cabeNoVencimento(t, filtros.vencimento));
    const c = filtros.cliente;
    if (c) itens = c === 'sem' ? itens.filter((t) => !t.clienteId) : itens.filter((t) => t.clienteId === c);
    if (ordemManual) return itens;
    const vista = itens.map((t) => ({
      t, titulo: t.title, status: t.statusName, statusTipo: t.statusType, lista: t.listName ?? '', pasta: pastaDaLista.get(t.listId)?.nome ?? null,
      cliente: t.clienteNome, prioridade: t.priority, prazo: t.dueDate, criadaEm: '',
    }));
    return ordenarTarefas(vista, config.ordenacao).map((x) => x.t);
  }, [tarefas, estrutura, pastaDaLista, filtros, mostrarConcluidas, ordemManual, config.ordenacao]);

  /** O cabeçalho ordena pela coluna; clicar de novo inverte. Ordenar sai da ordem manual. */
  const ordenarPor = (campo: CampoDeOrdem) => {
    escolherOrdemManual(false);
    mudar({ ordenacao: { campo, direcao: !ordemManual && config.ordenacao.campo === campo && config.ordenacao.direcao === 'asc' ? 'desc' : 'asc' } });
  };

  const agora = Date.now();
  const abaixoDoTitulo = (t: TrabTarefaResumo) => {
    const motivos = motivosDaTarefa(t, agora);
    if (!motivos.length && !t.comments) return null;
    return (
      <span className="mt-0.5 block text-[11px]" data-testid={`caixa-motivos-${t.id}`}>
        {motivos.length > 0 && <span className="text-warn">{motivos.join(' · ')}</span>}
        {motivos.length > 0 && t.comments > 0 && <span className="text-muted"> · </span>}
        {t.comments > 0 && <span className="text-muted">{t.comments} {t.comments === 1 ? 'comentário' : 'comentários'}</span>}
      </span>
    );
  };

  const algumFiltro = !!(filtros.lista || filtros.status || filtros.vencimento || filtros.cliente);

  return (
    <MenuDaTarefaProvider onMudou={refresh} onErro={setAvisoDeEscrita} onAbrir={(id) => popup.abrir(id)}>
    <div className="space-y-3">
      {/* -------------------------------------------------------- vista */}
      <div className="flex flex-wrap items-end gap-2" data-testid="caixa-vistas">
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Vista</span>
          <select data-testid="caixa-vista" value={vistaId} onChange={(e) => escolherVista(e.target.value)} className={SELECT}>
            <option value="">{vistas.length ? 'Sem vista salva' : 'Nenhuma vista salva'}</option>
            {vistas.map((v) => (
              <option key={v.id} value={v.id}>{v.nome}{v.padrao ? ' (padrão)' : ''}</option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="caixa-vista-salvar-como" onClick={() => void salvarComo()} className={BOTAO_PEQUENO}>Salvar como vista</button>
        {vistaAtual && modificada && (
          <button type="button" data-testid="caixa-vista-atualizar" onClick={() => void atualizarVista()} className={BOTAO_PEQUENO}>Atualizar "{vistaAtual.nome}"</button>
        )}
        {vistaAtual && !vistaAtual.padrao && (
          <button type="button" data-testid="caixa-vista-padrao" onClick={() => void marcarPadrao()} className={BOTAO_PEQUENO}>Marcar como padrão</button>
        )}
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Ordenar por</span>
          <span className="flex gap-1">
            <select
              data-testid="caixa-ordem-campo"
              value={ordemManual ? MANUAL : config.ordenacao.campo}
              onChange={(e) => {
                if (e.target.value === MANUAL) { escolherOrdemManual(true); return; }
                escolherOrdemManual(false);
                mudar({ ordenacao: { ...config.ordenacao, campo: e.target.value as CampoDeOrdem } });
              }}
              className={SELECT}
            >
              {CAMPOS_DE_ORDEM.map((c) => <option key={c} value={c}>{ROTULO_DO_CAMPO_DE_ORDEM[c]}</option>)}
              <option value={MANUAL}>Ordem manual (arrastar)</option>
            </select>
            {!ordemManual && (
              <button
                type="button"
                data-testid="caixa-ordem-direcao"
                aria-label={config.ordenacao.direcao === 'asc' ? 'Crescente; trocar para decrescente' : 'Decrescente; trocar para crescente'}
                onClick={() => mudar({ ordenacao: { ...config.ordenacao, direcao: config.ordenacao.direcao === 'asc' ? 'desc' : 'asc' } })}
                className={BOTAO_PEQUENO}
              >
                {config.ordenacao.direcao === 'asc' ? 'crescente' : 'decrescente'}
              </button>
            )}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Agrupar por</span>
          <select data-testid="caixa-agrupar" value={config.agrupamento} onChange={(e) => mudar({ agrupamento: e.target.value as Agrupamento })} className={SELECT}>
            {AGRUPAMENTOS.map((a) => <option key={a} value={a}>{ROTULO_DO_AGRUPAMENTO[a]}</option>)}
          </select>
        </label>
        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Forma de ver as tarefas">
          {(['tabela', 'calendario'] as const).map((f) => (
            <button
              key={f}
              type="button"
              data-testid={`caixa-forma-${f}`}
              aria-pressed={forma === f}
              onClick={() => escolherForma(f)}
              className={`px-3 py-1.5 text-[12.5px] max-md:min-h-[44px] ${forma === f ? 'bg-brand/15 text-text' : 'bg-surface text-muted hover:text-text'} ${FOCO}`}
            >
              {f === 'tabela' ? 'Tabela' : 'Calendário'}
            </button>
          ))}
        </div>
        {/* Layout 26/10: concluídas escondidas por padrão, como no Trabalho; este botão traz de volta. */}
        <button
          type="button"
          data-testid="caixa-concluidas"
          aria-pressed={mostrarConcluidas}
          onClick={() => { setSelecionadas(new Set()); setMostrarConcluidas((m) => !m); }}
          title={mostrarConcluidas ? 'Esconder de novo as tarefas concluídas' : 'Ver também as tarefas já concluídas'}
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] max-md:min-h-[44px] ${FOCO} ${mostrarConcluidas ? 'border-brand-dim bg-brand/15 text-text' : 'border-border bg-surface text-muted hover:text-text'}`}
        >
          {mostrarConcluidas ? 'Ocultar concluídas' : 'Mostrar concluídas'}
        </button>
        {avisoDaVista && <p role="status" className="text-[12px] text-muted">{avisoDaVista}</p>}
      </div>

      {/* -------------------------------------------------------- filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Lista ou pasta</span>
          <select data-testid="caixa-filtro-lista" value={filtros.lista} onChange={(e) => mudarFiltro({ lista: e.target.value })} className={SELECT}>
            <option value="">Todas</option>
            {pastas.length > 0 && (
              <optgroup label="Pastas">
                {pastas.map(([id, nome]) => <option key={id} value={`pasta:${id}`}>{nome}</option>)}
              </optgroup>
            )}
            <optgroup label="Listas">
              {listasComTarefa.map((l) => <option key={l.id} value={`lista:${l.id}`}>{l.pasta ? `${l.pasta.nome} / ${l.nome}` : l.nome}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Status</span>
          <select data-testid="caixa-filtro-status" value={filtros.status} onChange={(e) => mudarFiltro({ status: e.target.value })} className={SELECT}>
            <option value="">Todos</option>
            {statusNaLista.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Vencimento</span>
          <select
            data-testid="caixa-filtro-vencimento"
            value={filtros.vencimento}
            onChange={(e) => mudarFiltro({ vencimento: e.target.value as VistaMinhasTarefas['filtros']['vencimento'] })}
            className={SELECT}
          >
            <option value="">Qualquer</option>
            {(Object.keys(ROTULO_DO_VENCIMENTO) as (keyof typeof ROTULO_DO_VENCIMENTO)[]).map((v) => (
              <option key={v} value={v}>{ROTULO_DO_VENCIMENTO[v]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Responsável</span>
          <select
            data-testid="caixa-filtro-responsavel"
            value={filtros.responsavel}
            onChange={(e) => mudarFiltro({ responsavel: e.target.value as VistaMinhasTarefas['filtros']['responsavel'] })}
            className={SELECT}
          >
            <option value="eu">Eu</option>
            <option value="qualquer">Qualquer pessoa</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Cliente</span>
          <select data-testid="caixa-filtro-cliente" value={filtros.cliente} onChange={(e) => mudarFiltro({ cliente: e.target.value })} className={SELECT}>
            <option value="">Todos</option>
            <option value="sem">Sem cliente</option>
            {clientesNaLista.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </label>
      </div>

      {avisoDeEscrita && (
        <p role="alert" className="flex items-center justify-between gap-2 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          <span>{avisoDeEscrita}</span>
          <button type="button" onClick={() => { setAvisoDeEscrita(null); refresh(); }} className="underline">Recarregar lista</button>
        </p>
      )}

      {/* ---------------------------------------------------------- lista */}
      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={refresh} />
      ) : carregando && !tarefas ? (
        <Carregando texto="Lendo as suas tarefas..." />
      ) : !tarefas || visiveis.length === 0 ? (
        <Vazio>
          {algumFiltro
            ? 'Nenhuma tarefa com estes filtros.'
            : filtros.responsavel === 'qualquer' ? 'Nenhuma tarefa aberta.' : 'Nenhuma tarefa aberta com você como responsável.'}
        </Vazio>
      ) : forma === 'calendario' ? (
        <CalendarioDeTarefas
          itens={visiveis.map((t) => ({
            id: t.id, titulo: t.title, prazo: t.dueDate, concluida: t.statusType === 'closed',
            detalhe: [t.clienteNome, pastaDaLista.get(t.listId) ? `${pastaDaLista.get(t.listId)!.nome} / ${t.listName ?? ''}` : t.listName].filter(Boolean).join(' · '),
          }))}
          podeEditar={editable}
          onAbrir={(id) => popup.abrir(id)}
          onMudarPrazo={(id, dia) => escrita.editarNaLinha(id, { dueDate: prazoDoDia(dia) }, 'O prazo')}
          testid="caixa-calendario"
        />
      ) : (
        <>
          {escrita.avisoDoLote && <AvisoDoLote texto={escrita.avisoDoLote} onFechar={() => escrita.setAvisoDoLote(null)} testId="caixa-lote-aviso" />}
          {editable && selecionadas.size > 0 && estrutura && (
            <BarraDoLote
              quantas={selecionadas.size} pessoas={soDaEquipe(estrutura.pessoas ?? [], idsDaEquipe)} etapas={null}
              onLimpar={() => setSelecionadas(new Set())}
              {...escrita.acoesDoLote(todasAsListas)}
            />
          )}
          <Tabela
            tarefas={visiveis} campos={[]} trilhos={new Map()} onAbrir={(id, aba) => popup.abrir(id, aba)}
            mostrarLista pessoas={estrutura?.pessoas ?? []} agrupamento={config.agrupamento}
            selecao={editable ? { marcadas: selecionadas, mudar: setSelecionadas } : null}
            onReordenar={editable && ordemManual ? escrita.reordenar : null}
            edicao={editable && estrutura ? escrita.edicao(idsDaEquipe, estrutura.agentes ?? []) : null}
            ordenacao={{ campo: ordemManual ? null : config.ordenacao.campo, direcao: config.ordenacao.direcao, aoOrdenar: ordenarPor, testId: 'caixa-ordenar' }}
            abaixoDoTitulo={abaixoDoTitulo}
            testIdDaLinha={(id) => `caixa-tarefa-${id}`}
          />
          <p className="text-xs text-muted" data-testid="caixa-tarefas-rodape">
            {visiveis.length} {visiveis.length === 1 ? 'tarefa' : 'tarefas'}
            {ocultasPorConcluidas > 0 ? ` · ${ocultasPorConcluidas} ${ocultasPorConcluidas === 1 ? 'concluída escondida' : 'concluídas escondidas'}` : ''}
            {ordemManual && editable ? ' · ordem manual: arraste uma linha sobre outra para mudar a posição' : ''}
          </p>
        </>
      )}

      <TarefaFlutuante tarefa={popup} onMudou={refresh} />
    </div>
    </MenuDaTarefaProvider>
  );
}
