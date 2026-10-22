'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  CaixaFiltroDeVencimento,
  CaixaMinhaTarefa,
  CaixaMotivoDaParada,
  CaixaTarefasResposta,
  TrabComentarioDto,
  TrabTarefaDetalhe,
} from '@mktos/shared';

import {
  AGRUPAMENTOS, CAMPOS_DE_ORDEM, COLUNAS_DE_MINHAS_TAREFAS, ROTULO_DO_AGRUPAMENTO, ROTULO_DO_CAMPO_DE_ORDEM,
  VISTA_PADRAO_DE_MINHAS_TAREFAS, agruparTarefas, ordenarTarefas,
  type Agrupamento, type CampoDeOrdem, type ColunaDeMinhasTarefas, type VistaMinhasTarefas, type VistaSalvaDto,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { useAuth } from '@/lib/auth';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { BotaoDoMenuDaTarefa, alvoDoMenu, useMenuDaTarefaProprio } from '@/components/trabalho/MenuDaTarefa';
import { CalendarioDeTarefas, prazoDoDia } from '@/components/trabalho/CalendarioDeTarefas';
import {
  BOTAO_PEQUENO,
  CARTAO,
  Carregando,
  ErroComRetentativa,
  FOCO,
  ROTULO,
  SELECT,
  Vazio,
  dia,
  fraseDoQuadro,
  haQuanto,
} from './comum';

/*
 * A ABA MINHAS TAREFAS — a tabela das suas tarefas, com filtros e colunas.
 *
 * Só leitura: mexer na tarefa é no quadro (`/trabalho`), que tem a permissão e
 * as travas dele. Os comentários abrem num balão sem sair da tela, lidos da rota
 * dona (`GET /trabalho/tarefas/:id`). No celular a tabela vira lista de cartões.
 */

// Rodada do trabalho T3/T4: Cliente, Prioridade e Criada em entram; a ordem vem do shared.
export const COLUNAS = COLUNAS_DE_MINHAS_TAREFAS;
export type Coluna = ColunaDeMinhasTarefas;
const ROTULO_DA_COLUNA: Record<Coluna, string> = {
  cliente: 'Cliente',
  lista: 'Lista',
  status: 'Status',
  vencimento: 'Vencimento',
  prioridade: 'Prioridade',
  responsaveis: 'Responsáveis',
  criadaEm: 'Criada em',
  comentarios: 'Comentários',
};
export const CHAVE_DAS_COLUNAS = 'caixa.tarefas.colunas.v1';

const FRASE_DO_MOTIVO: Record<CaixaMotivoDaParada, string> = {
  prazo_vencido: 'prazo vencido',
  sem_movimento: 'parada há mais de uma semana',
  presa_com_agente: 'travada com um agente',
};

const ROTULO_DO_VENCIMENTO: Record<CaixaFiltroDeVencimento, string> = {
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

/** Os filtros que vão à API; o de cliente filtra aqui, sobre o que chegou. */
type Filtros = VistaMinhasTarefas['filtros'];

function caminho(f: Filtros): string {
  const q = new URLSearchParams();
  if (f.lista.startsWith('lista:')) q.set('listaId', f.lista.slice(6));
  if (f.lista.startsWith('pasta:')) q.set('pastaId', f.lista.slice(6));
  if (f.status) q.set('status', f.status);
  if (f.vencimento) q.set('vencimento', f.vencimento);
  if (f.responsavel !== 'eu') q.set('responsavel', f.responsavel);
  const s = q.toString();
  return `/caixa/tarefas${s ? `?${s}` : ''}`;
}

/* ------------------------------------------------------------------------ *
 * O balão de comentários
 * ------------------------------------------------------------------------ */

const ULTIMOS = 5;

/*
 * O balão é um diálogo leve (revisão do painel, P3 de 18/10/2026): Esc e o botão
 * "fechar" DEVOLVEM O FOCO ao botão que o abriu; o clique fora fecha e deixa o
 * foco onde a pessoa clicou. O clique no próprio botão de origem não conta como
 * "fora": é o botão que alterna, e antes o mousedown fechava e o click reabria.
 */
function BalaoDeComentarios({
  tarefa,
  token,
  ancora,
  origem,
  onFechar,
}: {
  tarefa: CaixaMinhaTarefa;
  token: string;
  ancora: DOMRect | null;
  origem: HTMLElement | null;
  onFechar: (devolverFoco: boolean) => void;
}) {
  const [comentarios, setComentarios] = useState<TrabComentarioDto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const buscar = useCallback(async () => {
    setErro(null);
    try {
      const d = await apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, token);
      setComentarios(d.comentarios.slice(0, ULTIMOS));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [tarefa.id, token]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  useEffect(() => {
    caixa.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar(true);
    };
    const clique = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (origem?.contains(alvo)) return;
      if (caixa.current && !caixa.current.contains(alvo)) onFechar(false);
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('mousedown', clique);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('mousedown', clique);
    };
  }, [onFechar, origem]);

  // Fixo na tela, perto do botão e dentro da janela: dentro da tabela, que rola
  // de lado, um balão absoluto seria cortado. No celular, ocupa a base da tela.
  const largura = 340;
  const estilo: React.CSSProperties | undefined =
    ancora && typeof window !== 'undefined' && window.innerWidth >= 768
      ? {
          top: Math.min(ancora.bottom + 6, window.innerHeight - 320),
          left: Math.max(8, Math.min(ancora.right - largura, window.innerWidth - largura - 8)),
          width: largura,
        }
      : undefined;
  const agora = new Date();

  return (
    <div
      ref={caixa}
      role="dialog"
      aria-label={`Comentários de ${tarefa.titulo}`}
      tabIndex={-1}
      data-testid={`caixa-balao-${tarefa.id}`}
      style={estilo}
      className={`fixed z-50 max-h-[320px] overflow-y-auto rounded border border-border bg-surface p-3 shadow-lg ${FOCO} ${
        estilo ? '' : 'inset-x-2 bottom-2'
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[12.5px] font-medium">{tarefa.titulo}</p>
        <button type="button" onClick={() => onFechar(true)} className={BOTAO_PEQUENO} aria-label="Fechar comentários">
          fechar
        </button>
      </div>
      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={() => void buscar()} />
      ) : !comentarios ? (
        <Carregando texto="Lendo os comentários..." />
      ) : comentarios.length === 0 ? (
        <p className="text-[12.5px] text-muted">Ninguém comentou nesta tarefa ainda.</p>
      ) : (
        <ol className="space-y-2">
          {comentarios.map((c) => (
            <li key={c.id} className="space-y-0.5">
              <p className="text-[11.5px] text-muted">
                <span className="text-text">{c.authorName}</span> ·{' '}
                <time dateTime={c.createdAt}>{haQuanto(c.createdAt, agora)}</time>
              </p>
              <p className="whitespace-pre-wrap break-words text-[12.5px]">{c.text}</p>
            </li>
          ))}
        </ol>
      )}
      {tarefa.comentarios > ULTIMOS && (
        <p className="mt-2 text-[11.5px] text-muted">
          Mostrando os {ULTIMOS} últimos de {tarefa.comentarios}.{' '}
          <Link
            href={`/trabalho?lista=${encodeURIComponent(tarefa.listaId)}&tarefa=${encodeURIComponent(tarefa.id)}`}
            className="text-brand hover:underline"
          >
            ver todos no quadro
          </Link>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * A aba
 * ------------------------------------------------------------------------ */

/*
 * AS VISTAS (rodada do trabalho T3, 19/10/2026). A pessoa escolhe ordenação
 * (qualquer coluna, crescente ou decrescente), agrupamento (vencimento no estilo
 * ClickUp, status, cliente, lista), colunas e filtros, e SALVA como vista com
 * nome, uma marcada como padrão, no servidor (`/trabalho/vistas`). A primeira
 * vez, a preferência de colunas do navegador vira a vista padrão.
 */
const CHAVE_DA_MIGRACAO = 'caixa.tarefas.vistas.migrado.v1';

/*
 * TABELA OU CALENDÁRIO (versão final, F4): o calendário do Lucas é uma das formas de
 * ver Minhas tarefas, o MESMO componente do Trabalho. Arrastar muda o prazo por um
 * PATCH com a versão lida (`atualizadaEm`); a preferência fica neste navegador.
 */
export const CHAVE_DA_FORMA = 'caixa.tarefas.forma.v1';
type Forma = 'tabela' | 'calendario';
function lerForma(): Forma {
  try { return window.localStorage.getItem(CHAVE_DA_FORMA) === 'calendario' ? 'calendario' : 'tabela'; } catch { return 'tabela'; }
}

function configInicial(): VistaMinhasTarefas {
  return { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, colunas: [...lerColunas()] };
}

export function AbaMinhasTarefas({ token }: { token: string }) {
  // A tarefa abre num pop-up por cima da tabela (rodada do trabalho T2): ninguém sai de Pendências.
  const popup = useTarefaNaUrl();
  const { can } = useAuth();
  const [forma, setForma] = useState<Forma>('tabela');
  const [avisoDoPrazo, setAvisoDoPrazo] = useState<string | null>(null);
  useEffect(() => { setForma(lerForma()); }, []);
  const escolherForma = (f: Forma) => {
    setForma(f);
    try { window.localStorage.setItem(CHAVE_DA_FORMA, f); } catch { /* sem armazenamento: vale nesta visita */ }
  };
  const abrirNoClique = (id: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    popup.abrir(id);
  };
  const [config, setConfig] = useState<VistaMinhasTarefas>(VISTA_PADRAO_DE_MINHAS_TAREFAS);
  const [vistas, setVistas] = useState<VistaSalvaDto[]>([]);
  const [vistaId, setVistaId] = useState<string>('');
  const [avisoDaVista, setAvisoDaVista] = useState<string | null>(null);
  const [resposta, setResposta] = useState<CaixaTarefasResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [balao, setBalao] = useState<{ tarefa: CaixaMinhaTarefa; ancora: DOMRect | null; origem: HTMLElement | null } | null>(null);
  const origemDoBalao = useRef<HTMLElement | null>(null);
  const pedido = useRef(0);
  const filtros = config.filtros;
  const colunas = useMemo(() => new Set<Coluna>(config.colunas), [config.colunas]);

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

  const mudar = (m: Partial<VistaMinhasTarefas>) => setConfig((c) => ({ ...c, ...m }));
  const mudarFiltro = (m: Partial<VistaMinhasTarefas['filtros']>) => setConfig((c) => ({ ...c, filtros: { ...c.filtros, ...m } }));

  function alternarColuna(c: Coluna) {
    setConfig((atual) => {
      const n = new Set(atual.colunas);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      const lista = COLUNAS.filter((x) => n.has(x));
      try {
        window.localStorage.setItem(CHAVE_DAS_COLUNAS, JSON.stringify(lista));
      } catch {
        /* sem localStorage (aba anônima com bloqueio): a escolha vale só nesta visita */
      }
      return { ...atual, colunas: lista };
    });
  }

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

  const buscar = useCallback(async () => {
    const n = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiGet<CaixaTarefasResposta>(caminho(filtros), token);
      if (n === pedido.current) setResposta(r);
    } catch (e) {
      if (n === pedido.current) setErro((e as Error).message);
    } finally {
      if (n === pedido.current) setCarregando(false);
    }
    // A consulta só muda com os filtros que vão à API (o cliente filtra aqui).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.lista, filtros.status, filtros.vencimento, filtros.responsavel, token]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  // O menu da tarefa (produção 3, I4): botão direito, Shift+F10, tecla Menu e o "⋯".
  const { menu, elemento: menuDaTarefa } = useMenuDaTarefaProprio({ onMudou: () => void buscar(), onErro: setErro, onAbrir: (id) => popup.abrir(id) });

  const pastas = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of resposta?.listas ?? []) if (l.pastaId && l.pasta) m.set(l.pastaId, l.pasta);
    return [...m.entries()];
  }, [resposta]);

  const clientesNaLista = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of resposta?.itens ?? []) if (t.clienteId && t.cliente) m.set(t.clienteId, t.cliente);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [resposta]);

  const agora = resposta ? new Date(resposta.agora) : new Date();
  const itensVisiveis = useMemo(() => {
    const todos = resposta?.itens ?? [];
    const f = filtros.cliente;
    const filtrados = !f ? todos : f === 'sem' ? todos.filter((t) => !t.clienteId) : todos.filter((t) => t.clienteId === f);
    return ordenarTarefas(filtrados, config.ordenacao);
  }, [resposta, filtros.cliente, config.ordenacao]);
  const grupos = useMemo(() => agruparTarefas(itensVisiveis, config.agrupamento, agora), [itensVisiveis, config.agrupamento, agora]);

  const fecharBalao = useCallback((devolverFoco: boolean) => {
    const origem = origemDoBalao.current;
    origemDoBalao.current = null;
    setBalao(null);
    if (devolverFoco) origem?.focus();
  }, []);
  const alternarBalao = (t: CaixaMinhaTarefa, botao: HTMLElement) => {
    if (balao?.tarefa.id === t.id) {
      fecharBalao(false);
      return;
    }
    origemDoBalao.current = botao;
    setBalao({ tarefa: t, ancora: botao.getBoundingClientRect(), origem: botao });
  };
  const fraseDeEstado = resposta ? fraseDoQuadro(resposta.estado) : null;

  /** O prazo pelo calendário: o mesmo PATCH do pop-up, com a versão lida da tarefa. */
  const mudarPrazo = async (id: string, novoDia: string) => {
    const t = resposta?.itens.find((x) => x.id === id);
    if (!t) return;
    setAvisoDoPrazo(null);
    try {
      await apiPatch(`/trabalho/tarefas/${encodeURIComponent(t.id)}`, { dueDate: prazoDoDia(novoDia), expectedUpdatedAt: t.atualizadaEm }, token);
      await buscar();
    } catch (e) {
      setAvisoDoPrazo((e as { status?: number }).status === 409
        ? `A tarefa "${t.titulo}" mudou desde a leitura. O prazo não foi gravado; atualize a lista e tente de novo.`
        : (e as Error).message);
    }
  };
  const ver = (c: Coluna) => colunas.has(c);

  /** O cabeçalho ordena pela coluna; clicar de novo inverte. */
  const ordenarPor = (campo: CampoDeOrdem) =>
    mudar({ ordenacao: { campo, direcao: config.ordenacao.campo === campo && config.ordenacao.direcao === 'asc' ? 'desc' : 'asc' } });
  const CAMPO_DA_COLUNA: Partial<Record<Coluna, CampoDeOrdem>> = {
    cliente: 'cliente', lista: 'lista', status: 'status', vencimento: 'vencimento', prioridade: 'prioridade', criadaEm: 'criadaEm',
  };
  const cabecalho = (rotulo: string, campo: CampoDeOrdem | undefined, chave: string) => {
    const ativo = campo && config.ordenacao.campo === campo;
    return (
      <th
        key={chave}
        scope="col"
        aria-sort={ativo ? (config.ordenacao.direcao === 'asc' ? 'ascending' : 'descending') : undefined}
        className={`${ROTULO} px-3 py-2 font-normal`}
      >
        {campo ? (
          <button type="button" onClick={() => ordenarPor(campo)} data-testid={`caixa-ordenar-${chave}`} className={`uppercase hover:text-text ${FOCO}`}>
            {rotulo}{ativo ? (config.ordenacao.direcao === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ) : rotulo}
      </th>
    );
  };

  // Os ids de teste são únicos na página: a tabela e os cartões estão os dois
  // no DOM (um deles escondido por CSS), e um seletor que casasse com dois
  // elementos quebraria o roteiro do Playwright.
  const botaoDeComentarios = (t: CaixaMinhaTarefa, noCartao = false) => (
    <button
      type="button"
      data-testid={noCartao ? `caixa-comentarios-cartao-${t.id}` : `caixa-comentarios-${t.id}`}
      onClick={(e) => alternarBalao(t, e.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={balao?.tarefa.id === t.id}
      aria-label={`${t.comentarios} comentário(s) em ${t.titulo}`}
      className={BOTAO_PEQUENO}
    >
      {t.comentarios} {t.comentarios === 1 ? 'comentário' : 'comentários'}
    </button>
  );

  const prazo = (t: CaixaMinhaTarefa) => (
    <span className={t.motivos.includes('prazo_vencido') ? 'text-bad' : ''}>{dia(t.prazo)}</span>
  );
  const nomeDoCliente = (t: CaixaMinhaTarefa) =>
    t.cliente ?? <span className="font-os-mono text-[10.5px] text-warn">sem cliente</span>;
  const colunasVisiveis = COLUNAS.filter(ver);

  const linhaDaTabela = (t: CaixaMinhaTarefa) => (
    <tr {...alvoDoMenu(menu, { id: t.id, title: t.titulo })} key={t.id} data-testid={`caixa-tarefa-${t.id}`} onClick={() => popup.abrir(t.id)} className="cursor-pointer align-top hover:bg-surface-2">
      <td className="max-w-[320px] px-3 py-2">
        <a
          href={`?aba=tarefas&tarefa=${encodeURIComponent(t.id)}`}
          onClick={(e) => { e.stopPropagation(); abrirNoClique(t.id)(e); }}
          className={`break-words font-medium text-text hover:text-brand hover:underline ${FOCO}`}
        >
          {t.titulo}
        </a>
        <BotaoDoMenuDaTarefa tarefa={{ id: t.id, title: t.titulo }} menu={menu} className="ml-1 inline-grid align-middle" />
        {t.motivos.length > 0 && (
          <span className="mt-0.5 block text-[11px] text-warn">
            {t.motivos.map((m) => FRASE_DO_MOTIVO[m]).join(' · ')}
          </span>
        )}
      </td>
      {ver('cliente') && <td className="px-3 py-2">{nomeDoCliente(t)}</td>}
      {ver('lista') && (
        <td className="px-3 py-2 text-muted">
          {t.pasta ? <span className="text-dim">{t.pasta} / </span> : null}
          {t.lista}
        </td>
      )}
      {ver('status') && (
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t.statusCor }} />
            {t.status}
          </span>
        </td>
      )}
      {ver('vencimento') && <td className="whitespace-nowrap px-3 py-2">{prazo(t)}</td>}
      {ver('prioridade') && <td className="px-3 py-2 capitalize text-muted">{t.prioridade}</td>}
      {ver('responsaveis') && <td className="px-3 py-2 text-muted">{t.responsavel ?? 'ninguém'}</td>}
      {ver('criadaEm') && <td className="whitespace-nowrap px-3 py-2 text-muted">{dia(t.criadaEm)}</td>}
      {ver('comentarios') && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{botaoDeComentarios(t)}</td>}
    </tr>
  );

  return (
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
              value={config.ordenacao.campo}
              onChange={(e) => mudar({ ordenacao: { ...config.ordenacao, campo: e.target.value as CampoDeOrdem } })}
              className={SELECT}
            >
              {CAMPOS_DE_ORDEM.map((c) => <option key={c} value={c}>{ROTULO_DO_CAMPO_DE_ORDEM[c]}</option>)}
            </select>
            <button
              type="button"
              data-testid="caixa-ordem-direcao"
              aria-label={config.ordenacao.direcao === 'asc' ? 'Crescente; trocar para decrescente' : 'Decrescente; trocar para crescente'}
              onClick={() => mudar({ ordenacao: { ...config.ordenacao, direcao: config.ordenacao.direcao === 'asc' ? 'desc' : 'asc' } })}
              className={BOTAO_PEQUENO}
            >
              {config.ordenacao.direcao === 'asc' ? 'crescente' : 'decrescente'}
            </button>
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
        {avisoDaVista && <p role="status" className="text-[12px] text-muted">{avisoDaVista}</p>}
      </div>

      {/* -------------------------------------------------------- filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Lista ou pasta</span>
          <select
            data-testid="caixa-filtro-lista"
            value={filtros.lista}
            onChange={(e) => mudarFiltro({ lista: e.target.value })}
            className={SELECT}
          >
            <option value="">Todas</option>
            {pastas.length > 0 && (
              <optgroup label="Pastas">
                {pastas.map(([id, nome]) => (
                  <option key={id} value={`pasta:${id}`}>
                    {nome}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Listas">
              {(resposta?.listas ?? []).map((l) => (
                <option key={l.id} value={`lista:${l.id}`}>
                  {l.pasta ? `${l.pasta} / ${l.nome}` : l.nome}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Status</span>
          <select
            data-testid="caixa-filtro-status"
            value={filtros.status}
            onChange={(e) => mudarFiltro({ status: e.target.value })}
            className={SELECT}
          >
            <option value="">Abertos</option>
            {(resposta?.status ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
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
            {(Object.keys(ROTULO_DO_VENCIMENTO) as CaixaFiltroDeVencimento[]).map((v) => (
              <option key={v} value={v}>
                {ROTULO_DO_VENCIMENTO[v]}
              </option>
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
        <details className="relative ml-auto">
          <summary className={`${BOTAO_PEQUENO} cursor-pointer list-none`} data-testid="caixa-colunas">
            Colunas
          </summary>
          <fieldset className={`${CARTAO} absolute right-0 z-20 mt-1 w-48 space-y-1 p-3`}>
            <legend className="sr-only">Colunas visíveis</legend>
            {COLUNAS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-[12.5px] max-md:min-h-[40px]">
                <input
                  type="checkbox"
                  data-testid={`caixa-coluna-${c}`}
                  checked={colunas.has(c)}
                  onChange={() => alternarColuna(c)}
                  className={FOCO}
                />
                {ROTULO_DA_COLUNA[c]}
              </label>
            ))}
          </fieldset>
        </details>
      </div>

      {/* ---------------------------------------------------------- lista */}
      {erro ? (
        <ErroComRetentativa mensagem={erro} onTentar={() => void buscar()} />
      ) : carregando && !resposta ? (
        <Carregando texto="Lendo as suas tarefas..." />
      ) : fraseDeEstado ? (
        <Vazio>{fraseDeEstado}</Vazio>
      ) : !resposta || itensVisiveis.length === 0 ? (
        <Vazio>
          {filtros.lista || filtros.status || filtros.vencimento || filtros.cliente
            ? 'Nenhuma tarefa com estes filtros.'
            : 'Nenhuma tarefa aberta com você como responsável.'}
        </Vazio>
      ) : forma === 'calendario' ? (
        <>
          {avisoDoPrazo && <p role="alert" className="text-[12px] text-bad">{avisoDoPrazo}</p>}
          <CalendarioDeTarefas
            itens={itensVisiveis.map((t) => ({
              id: t.id, titulo: t.titulo, prazo: t.prazo, concluida: t.statusTipo === 'closed',
              detalhe: [t.cliente, t.pasta ? `${t.pasta} / ${t.lista}` : t.lista].filter(Boolean).join(' · '),
            }))}
            podeEditar={can('tarefas.editar')}
            onAbrir={(id) => popup.abrir(id)}
            onMudarPrazo={mudarPrazo}
            testid="caixa-calendario"
          />
        </>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className={`${CARTAO} hidden overflow-x-auto md:block`}>
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border">
                  {cabecalho('Nome', 'titulo', 'titulo')}
                  {colunasVisiveis.map((c) => cabecalho(ROTULO_DA_COLUNA[c], CAMPO_DA_COLUNA[c], c))}
                </tr>
              </thead>
              {grupos.map((g) => (
                <tbody key={g.chave} className="divide-y divide-border" data-testid={`caixa-grupo-${g.chave}`}>
                  {config.agrupamento !== 'nenhum' && (
                    <tr className="bg-surface-2">
                      <th scope="rowgroup" colSpan={1 + colunasVisiveis.length} className="px-3 py-1.5 text-left font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                        {g.rotulo} <span className="tabular-nums">· {g.itens.length}</span>
                      </th>
                    </tr>
                  )}
                  {g.itens.map(linhaDaTabela)}
                </tbody>
              ))}
            </table>
          </div>

          {/* Celular: cartões */}
          <div className="space-y-3 md:hidden">
            {grupos.map((g) => (
              <section key={g.chave} aria-label={config.agrupamento !== 'nenhum' ? g.rotulo : undefined}>
                {config.agrupamento !== 'nenhum' && <p className={`${ROTULO} mb-1`}>{g.rotulo} · {g.itens.length}</p>}
                <ul className="space-y-2">
                  {g.itens.map((t) => (
                    <li {...alvoDoMenu(menu, { id: t.id, title: t.titulo })} key={t.id} data-testid={`caixa-tarefa-cartao-${t.id}`} className={`${CARTAO} relative space-y-1.5 p-3`}>
                      <span className="flex items-start justify-between gap-1">
                        <a
                          href={`?aba=tarefas&tarefa=${encodeURIComponent(t.id)}`}
                          onClick={abrirNoClique(t.id)}
                          className={`block break-words text-[13px] font-medium text-text after:absolute after:inset-0 after:content-[''] hover:text-brand ${FOCO}`}
                        >
                          {t.titulo}
                        </a>
                        <BotaoDoMenuDaTarefa tarefa={{ id: t.id, title: t.titulo }} menu={menu} />
                      </span>
                      {t.motivos.length > 0 && (
                        <p className="text-[11px] text-warn">{t.motivos.map((m) => FRASE_DO_MOTIVO[m]).join(' · ')}</p>
                      )}
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                        {ver('cliente') && (
                          <>
                            <dt className="text-muted">Cliente</dt>
                            <dd className="break-words">{nomeDoCliente(t)}</dd>
                          </>
                        )}
                        {ver('lista') && (
                          <>
                            <dt className="text-muted">Lista</dt>
                            <dd className="break-words">{t.pasta ? `${t.pasta} / ${t.lista}` : t.lista}</dd>
                          </>
                        )}
                        {ver('status') && (
                          <>
                            <dt className="text-muted">Status</dt>
                            <dd>{t.status}</dd>
                          </>
                        )}
                        {ver('vencimento') && (
                          <>
                            <dt className="text-muted">Vencimento</dt>
                            <dd>{prazo(t)}</dd>
                          </>
                        )}
                        {ver('responsaveis') && (
                          <>
                            <dt className="text-muted">Responsáveis</dt>
                            <dd className="break-words">{t.responsavel ?? 'ninguém'}</dd>
                          </>
                        )}
                      </dl>
                      {ver('comentarios') && <div className="relative z-10">{botaoDeComentarios(t, true)}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="text-xs text-muted">
            {itensVisiveis.length} tarefa(s)
            {resposta.truncado && `, mostrando as ${resposta.teto} primeiras pelo prazo. Use os filtros para achar o resto`}
            . Atualizado {haQuanto(resposta.agora, agora)}.
          </p>
        </>
      )}

      {balao && token && (
        <BalaoDeComentarios tarefa={balao.tarefa} token={token} ancora={balao.ancora} origem={balao.origem} onFechar={fecharBalao} />
      )}
      <TarefaFlutuante tarefa={popup} onMudou={() => void buscar()} />
      {menuDaTarefa}
    </div>
  );
}
