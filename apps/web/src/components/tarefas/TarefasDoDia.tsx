'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  TAREFA_IGUAL_JA_EXISTE, tituloNormalizado,
  type AreaDeTarefa, type EtapaDaTarefa, type PainelDeTarefas, type ResultadoDeCriar, type SituacaoDoPrazo, type TarefaDoDia,
} from '@mktos/shared';
import { Check } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { abrirFicha } from '@/lib/ficha';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { LARGURA_DA_COLUNA, type Densidade } from '@/lib/quadro-denso';
import { Numero, Quadro } from '@/components/painel';
import { Barras, type Fatia } from './graficos';
import { BotaoDoMenuDaTarefa, MenuDaTarefaProvider, alvoDoMenu, useMenuDaTarefa } from '@/components/trabalho/MenuDaTarefa';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { EscolhaNaCelula } from '@/components/trabalho/EscolhaNaCelula';
import { PrazoComRepeticao } from '@/components/trabalho/TabelaDeTarefas';
import { soDaEquipe, useIdsDaEquipe } from '@/components/trabalho/ResponsavelDaTarefa';
import { SeletorDeDensidade, useDensidade } from '@/components/SeletorDeDensidade';
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
import { PilhaDeAvatares, type PessoaNoAvatar } from '@/components/PilhaDeAvatares';

/*
 * DIA A DIA › TAREFAS: todas as tarefas de todas as áreas num lugar (19/10/2026).
 *
 * Uma lista só, vista de três jeitos (Quadro, Lista, Calendário) — as abas nunca
 * copiam a tarefa, só mudam o desenho. O resumo em gráfico mora em Visão geral da
 * empresa (`ResumoDeTarefas`, abaixo), e cada clique dele abre esta lista filtrada. Filtros na URL (?pessoa=…&area=…), para
 * o voltar do navegador desfazer o clique e o link poder ser mandado a alguém.
 * O detalhe abre por cima (?tarefa=id), com × e Esc, como a ficha do cliente.
 * Layout 26/10: o detalhe é o pop-up único da tarefa (`TarefaFlutuante`, o mesmo
 * do Trabalho e de Minhas tarefas), na mesma chave `?tarefa=` do endereço.
 *
 * CADA ÁREA TEM A SUA ABA (Comercial › Tarefas, Marketing › Tarefas, …): é este
 * mesmo componente com `area` fixa. Lê a mesma lista e só esconde as das outras
 * áreas; a tarefa criada ali já nasce com a área. Nada é copiado.
 */

type Ver = 'quadro' | 'lista' | 'calendario';
type Agrupar = 'pessoa' | 'area' | 'situacao';
/** As situações do prazo e mais 'emdia' (hoje + todo prazo futuro), a coluna "Em dia" da tabela de cada pessoa. */
type Recorte = SituacaoDoPrazo | 'emdia' | 'todas';
/**
 * Layout 26/10: `concluidas=mostrar` é o botão "Mostrar concluídas" (o padrão do Trabalho):
 * sem ele, a concluída some. `situacao=todas` (o link antigo) continua valendo como mostrar.
 */
interface Filtro { pessoa?: string; area?: string; cliente?: string; situacao?: Recorte; q?: string; concluidas?: string }
const CHAVES: (keyof Filtro)[] = ['pessoa', 'area', 'cliente', 'situacao', 'q', 'concluidas'];
const SEM = 'sem';

const NOME_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: 'Atrasadas', hoje: 'Hoje', proximos_7: 'Próximos 7 dias', mais_tarde: 'Mais tarde', sem_prazo: 'Sem prazo', feita: 'Concluídas',
};
const NOME_DO_RECORTE: Record<Recorte, string> = { ...NOME_DA_SITUACAO, emdia: 'Em dia', todas: 'Todas (abertas e concluídas)' };
/** Um acento só (lima cheio, médio, fraco); vermelho só para o problema (atrasada). */
const FORTE = 'rgb(var(--os-ac))';
const MEDIO = 'rgb(var(--os-ac) / 0.45)';
const FRACO = 'rgb(var(--os-tx2) / 0.3)';
const VERMELHO = 'rgb(var(--os-err))';
const COR_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: VERMELHO, hoje: FORTE, proximos_7: MEDIO, mais_tarde: MEDIO, sem_prazo: FRACO, feita: FORTE,
};
const ABERTAS: SituacaoDoPrazo[] = ['atrasada', 'hoje', 'proximos_7', 'sem_prazo'];
/**
 * As colunas do prazo. "Mais tarde" não é coluna fixa (o Lucas não quer "Mais
 * adiante"): só entra quando há tarefa nela, para nenhuma sumir do quadro.
 */
const colunasDoPrazo = (tarefas: TarefaDoDia[]): SituacaoDoPrazo[] =>
  tarefas.some((t) => t.situacao === 'mais_tarde') ? ['atrasada', 'hoje', 'proximos_7', 'mais_tarde', 'sem_prazo'] : ABERTAS;
/** O nome na tela; "mais tarde" leva a data em que começa (hoje + 8). */
const nomeDaSituacao = (s: Recorte, hoje: string) => (s === 'mais_tarde' ? `A partir de ${dd(somaDias(hoje, 8))}` : NOME_DO_RECORTE[s]);

const dd = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const primeiro = (nome: string) => nome.split(' ')[0];

function lerUrl() {
  const q = new URLSearchParams(window.location.search);
  const f: Filtro = {};
  for (const k of CHAVES) { const v = q.get(k); if (v) (f as Record<string, string>)[k] = v; }
  const v = q.get('ver');
  const a = q.get('agrupar');
  return {
    ver: (v === 'lista' || v === 'calendario' ? v : 'quadro') as Ver,
    agrupar: (a === 'area' || a === 'situacao' ? a : 'pessoa') as Agrupar,
    filtro: f,
  };
}
/** A tarefa aberta (`?tarefa=`) é do pop-up (`useTarefaNaUrl`): mudar filtro a mantém; trocar de visão, não. */
function escreverUrl(ver: Ver, agrupar: Agrupar, filtro: Filtro, manterTarefa: boolean, empilhar: boolean) {
  const q = new URLSearchParams();
  if (ver !== 'quadro') q.set('ver', ver);
  if (ver === 'quadro' && agrupar !== 'pessoa') q.set('agrupar', agrupar);
  for (const k of CHAVES) if (filtro[k]) q.set(k, filtro[k]!);
  const tarefa = manterTarefa ? new URLSearchParams(window.location.search).get('tarefa') : null;
  if (tarefa) q.set('tarefa', tarefa);
  const aba = manterTarefa ? new URLSearchParams(window.location.search).get('tarefaAba') : null;
  if (tarefa && aba) q.set('tarefaAba', aba);
  const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
  if (empilhar) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function passa(t: TarefaDoDia, f: Filtro) {
  if (f.pessoa && (f.pessoa === SEM ? !!t.pessoa : !t.pessoas.some((x) => x.id === f.pessoa))) return false;
  if (f.area && (f.area === SEM ? !!t.area : t.area?.id !== f.area)) return false;
  if (f.cliente && t.cliente?.id !== f.cliente) return false;
  if (f.situacao === 'todas') {
    // abertas e concluídas
  } else if (f.situacao) {
    if (f.situacao === 'emdia') { if (t.situacao !== 'hoje' && t.situacao !== 'proximos_7' && t.situacao !== 'mais_tarde') return false; }
    else if (t.situacao !== f.situacao) return false;
  } else if (t.situacao === 'feita' && f.concluidas !== 'mostrar') return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${t.titulo} ${t.cliente?.titulo ?? ''}`.toLowerCase().includes(q)) return false;
  }
  return true;
}
/** A posição manual (arrastar) vem primeiro; empate (nunca arrastada) vai pelo prazo e pelo título. */
const ordem = (a: TarefaDoDia, b: TarefaDoDia) =>
  (a.ordem - b.ordem) || (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') || a.titulo.localeCompare(b.titulo, 'pt');

function useAlturaAteOFim(ref: React.RefObject<HTMLElement | null>, folga = 16) {
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => { if (ref.current) setAltura(Math.max(340, window.innerHeight - ref.current.getBoundingClientRect().top - folga)); };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  });
  return altura;
}

/** `area`: nome da área (ex.: 'Comercial') quando a tela é a aba Tarefas de uma área. */
export function TarefasDoDia({ area: nomeDaArea }: { area?: string } = {}) {
  const { token, ready, can } = useAuth();
  const podeEditar = can('tarefas.editar');
  // Layout 26/10 (P-16): para escolher responsável, só a equipe (a regra da tela Equipe), com a foto de cada um.
  const idsDaEquipe = useIdsDaEquipe(token);
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ver, setVer] = useState<Ver>('quadro');
  const [agrupar, setAgrupar] = useState<Agrupar>('pessoa');
  const [filtro, setFiltro] = useState<Filtro>({});
  // Layout 26/10: o pop-up único da tarefa, com o estado na URL (`?tarefa=`), como no Trabalho.
  const popup = useTarefaNaUrl();
  const [nova, setNova] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<{ texto: string; desfazer?: () => void } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);
  const marcar = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Lista vazia limpa; senão soma as tarefas à seleção (selecionar coluna, selecionar todas). */
  const marcarVarias = (ids: string[]) => setSel((x) => (ids.length ? new Set([...x, ...ids]) : new Set()));

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then((x) => { setP(x); setErro(null); }).catch((e) => setErro(e.message));
  }, [token]);
  useEffect(() => { if (ready) carregar(); }, [ready, carregar]);
  useEffect(() => {
    const ler = () => { const u = lerUrl(); setVer(u.ver); setAgrupar(u.agrupar); setFiltro(u.filtro); };
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const ir = (v: Ver, f: Filtro = filtro, g: Agrupar = agrupar) => {
    setVer(v); setFiltro(f); setAgrupar(g); escreverUrl(v, g, f, false, true);
  };
  const mudarFiltro = (f: Filtro) => { setFiltro(f); escreverUrl(ver, agrupar, f, true, false); };
  const abrirTarefa = (id: string) => {
    popup.abrir(id);
    // Tarefa criada agora (ou por outra pessoa) ainda não está na tela: busca de novo.
    if (!p?.tarefas.some((t) => t.id === id)) carregar();
  };

  /** Troca a tarefa no estado sem recarregar tudo (concluir, arrastar, editar). */
  const trocar = (t: TarefaDoDia) => setP((x) => (x ? { ...x, tarefas: x.tarefas.map((o) => (o.id === t.id ? t : o)) } : x));
  const alternarFeita = async (t: TarefaDoDia) => {
    if (!token) return;
    try {
      const nova = await apiPost<TarefaDoDia & { proxima?: { id: string; prazo: string } }>(`/trabalho/todas/${t.id}/feita`, { expectedUpdatedAt: t.updatedAt }, token);
      trocar(nova);
      carregar();
      if (nova.situacao === 'feita') {
        const proxima = nova.proxima ? ` A próxima já está criada para ${dd(nova.proxima.prazo)}.` : ' Ela sai das abertas e fica em "Concluídas".';
        setAviso({ texto: `Concluída: ${t.titulo}.${proxima}`, desfazer: () => alternarFeita(nova) });
      }
    } catch (e) { setErro((e as Error).message); carregar(); }
  };
  /** Aplica a mesma mudança a todas as selecionadas (uma chamada por tarefa, cada uma com a sua versão). */
  const emLote = async (oQue: string, fazer: (t: TarefaDoDia) => Promise<unknown>) => {
    if (!token || !p) return;
    const alvo = p.tarefas.filter((t) => sel.has(t.id));
    setTrabalhando(true);
    let falhas = 0;
    for (const t of alvo) { try { await fazer(t); } catch { falhas++; } }
    setTrabalhando(false);
    setSel(new Set());
    carregar();
    setAviso({ texto: `${oQue}: ${alvo.length - falhas} de ${alvo.length} tarefas.${falhas ? ' As outras mudaram enquanto isso; confira e tente de novo.' : ''}` });
  };
  const loteEditar = (mudanca: Record<string, unknown>, oQue: string) =>
    emLote(oQue, (t) => apiPatch(`/trabalho/todas/${t.id}`, { expectedUpdatedAt: t.updatedAt, ...mudanca }, token));
  const loteFeita = (concluir: boolean) =>
    emLote(concluir ? 'Concluídas' : 'Reabertas', (t) =>
      (t.situacao === 'feita') === concluir ? Promise.resolve() : apiPost(`/trabalho/todas/${t.id}/feita`, { expectedUpdatedAt: t.updatedAt }, token));
  const editar = async (t: TarefaDoDia, mudanca: Record<string, unknown>) => {
    if (!token) return;
    try { trocar(await apiPatch<TarefaDoDia>(`/trabalho/todas/${t.id}`, { expectedUpdatedAt: t.updatedAt, ...mudanca }, token)); carregar(); }
    catch (e) { setErro((e as Error).message); carregar(); }
  };
  /** Nova sequência de um pedaço da tela (coluna, lista, dia): muda na hora e grava. */
  const reordenar = async (ids: string[]) => {
    if (!token || !ids.length) return;
    const pos = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
    setP((x) => (x ? { ...x, tarefas: x.tarefas.map((t) => (pos.has(t.id) ? { ...t, ordem: pos.get(t.id)! } : t)) } : x));
    try { await apiPost('/trabalho/todas/ordem', { ids }, token); } catch (e) { setErro((e as Error).message); carregar(); }
  };
  /** "+ cadastrar novo cliente…": acha ou cria o cliente no cadastro de clientes (o mesmo do Trabalho); nome igual liga ao que já existe. Lead mora no funil. */
  const criarCliente = async (): Promise<{ id: string; titulo: string } | null> => {
    const nome = window.prompt('Nome do cliente (empresa ou pessoa). Ele entra no cadastro de clientes; lead novo se cadastra no funil do Comercial:')?.trim();
    if (!nome || !token) return null;
    try {
      const c = await apiPost<{ id: string; titulo: string; jaExistia: boolean }>('/trabalho/todas/clientes', { nome }, token);
      setAviso({ texto: c.jaExistia ? `${c.titulo} já estava no cadastro de clientes: a tarefa foi ligada a ele.` : `${c.titulo} entrou no cadastro de clientes.` });
      carregar();
      return c;
    } catch (e) { setErro((e as Error).message); return null; }
  };
  const criarArea = async (): Promise<AreaDeTarefa | null> => {
    const nome = window.prompt('Nome da nova área:')?.trim();
    if (!nome || !token) return null;
    try { const a = await apiPost<AreaDeTarefa>('/trabalho/todas/areas', { nome }, token); carregar(); return a; }
    catch (e) { setErro((e as Error).message); return null; }
  };

  // A área fixa é achada pelo nome: o id muda de empresa para empresa.
  const areaFixa = nomeDaArea && p ? p.areas.find((a) => a.nome.toLowerCase() === nomeDaArea.toLowerCase()) ?? null : null;
  const faltaArea = !!nomeDaArea && !!p && !areaFixa;
  const filtroDaTela: Filtro = useMemo(() => (areaFixa ? { ...filtro, area: areaFixa.id } : filtro), [filtro, areaFixa]);
  const daTela = useMemo(
    () => (p ? (areaFixa ? p.tarefas.filter((t) => t.area?.id === areaFixa.id) : faltaArea ? [] : p.tarefas) : []),
    [p, areaFixa, faltaArea],
  );
  const lista = useMemo(() => daTela.filter((t) => passa(t, filtroDaTela)).sort(ordem), [daTela, filtroDaTela]);
  const agruparNaTela: Agrupar = areaFixa && agrupar === 'area' ? 'pessoa' : agrupar;
  const equipe = useMemo(() => (p ? soDaEquipe(p.pessoas, idsDaEquipe) : []), [p, idsDaEquipe]);

  return (
    <MenuDaTarefaProvider onMudou={carregar} onErro={setErro} onAbrir={abrirTarefa}>
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1">
          {(['quadro', 'lista', 'calendario'] as Ver[]).map((v) => (
            <button
              key={v}
              onClick={() => ir(v)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${ver === v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {v === 'quadro' ? 'Quadro' : v === 'lista' ? `Lista (${lista.length})` : 'Calendário'}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-5">
          {p && (
            <>
              {nomeDaArea && <Link href="/trabalho?pasta=todas&visao=lista" className="text-sm text-muted hover:text-brand">todas as áreas →</Link>}
              <span className="text-sm text-muted">Abertas: <b className="com-num text-text">{daTela.filter((t) => t.situacao !== 'feita').length}</b></span>
              <span className="text-sm text-muted">Atrasadas: <b className="com-num text-bad">{daTela.filter((t) => t.situacao === 'atrasada').length}</b></span>
            </>
          )}
          {podeEditar && !faltaArea && (
            <button onClick={() => setNova(true)} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
              + Nova tarefa
            </button>
          )}
        </div>
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {!p && !erro && <p className="text-muted">Carregando…</p>}

      {faltaArea && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">
          A área {nomeDaArea} ainda não existe nesta empresa. Crie numa tarefa em <Link href="/trabalho?pasta=todas&visao=lista" className="text-brand">Dia a dia › Tarefas</Link>.
        </p>
      )}
      {p && !faltaArea && <Filtros p={p} filtro={filtro} mudar={mudarFiltro} areaFixa={!!areaFixa} />}
      {p && !faltaArea && podeEditar && ver !== 'calendario' && (
        <BarraDeSelecao
          p={p} equipe={equipe} visiveis={lista} sel={sel} trabalhando={trabalhando} areaFixa={!!areaFixa}
          marcarVarias={marcarVarias} editar={loteEditar} concluir={loteFeita}
        />
      )}
      {p && !faltaArea && ver === 'quadro' && (
        <QuadroDeTarefas
          p={p} tarefas={lista} agrupar={agruparNaTela} podeEditar={podeEditar} areaFixa={areaFixa?.id}
          trocarAgrupar={(g) => ir('quadro', filtro, g)} abrir={abrirTarefa} alternar={alternarFeita} editar={editar}
          criado={carregar} token={token} sel={sel} marcar={marcar} marcarVarias={marcarVarias} reordenar={reordenar}
        />
      )}
      {p && !faltaArea && ver === 'lista' && <ListaDeTarefas p={p} equipe={equipe} tarefas={lista} abrir={abrirTarefa} podeEditar={podeEditar} mostrarArea={!areaFixa} sel={sel} marcar={marcar} marcarVarias={marcarVarias} editar={editar} reordenar={reordenar} />}
      {p && !faltaArea && ver === 'calendario' && (
        <CalendarioDeTarefas tarefas={lista} hoje={p.hoje} podeEditar={podeEditar} abrir={abrirTarefa} mudarPrazo={(t, prazo) => editar(t, { prazo })} reordenar={reordenar} />
      )}

      {/* Layout 26/10: o pop-up único da tarefa (o do Trabalho), no lugar da janela própria desta tela. */}
      <TarefaFlutuante tarefa={popup} onMudou={carregar} />
      {p && nova && (
        <NovaTarefa
          p={p} equipe={equipe} token={token} filtro={filtroDaTela} criarArea={criarArea} criarCliente={criarCliente}
          fechar={() => setNova(false)} criada={(id) => { setNova(false); carregar(); abrirTarefa(id); }} abrir={(id) => { setNova(false); abrirTarefa(id); }}
        />
      )}
      {aviso && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[80] flex max-w-[92vw] -translate-x-1/2 items-center gap-4 rounded-md bg-text px-4 py-2.5 text-sm text-bg shadow-lg">
          <span>{aviso.texto}</span>
          {aviso.desfazer && (
            <button onClick={() => { aviso.desfazer!(); setAviso(null); }} className="font-semibold text-brand-dim hover:underline">desfazer</button>
          )}
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-bg/70 hover:text-bg">×</button>
        </div>
      )}
    </div>
    </MenuDaTarefaProvider>
  );
}

// ---------------- Seleção em lote ----------------

/**
 * Sem nada selecionado: "Selecionar todas (N)" — as N que os filtros mostram.
 * Com seleção: o que dá para mudar em todas de uma vez (responsável, área,
 * prazo, concluir ou reabrir). Cada tarefa continua uma só; só muda o campo.
 */
function BarraDeSelecao({ p, equipe, visiveis, sel, trabalhando, areaFixa, marcarVarias, editar, concluir }: {
  p: PainelDeTarefas; equipe: PainelDeTarefas['pessoas']; visiveis: TarefaDoDia[]; sel: Set<string>; trabalhando: boolean; areaFixa: boolean;
  marcarVarias: (ids: string[]) => void; editar: (m: Record<string, unknown>, oQue: string) => void; concluir: (sim: boolean) => void;
}) {
  const n = sel.size;
  const selecionadas = p.tarefas.filter((t) => sel.has(t.id));
  const temFeita = selecionadas.some((t) => t.situacao === 'feita');
  const temAberta = selecionadas.some((t) => t.situacao !== 'feita');
  const campo = 'rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50';
  if (!n) {
    return visiveis.length ? (
      <div className="-mt-2 text-sm">
        <button onClick={() => marcarVarias(visiveis.map((t) => t.id))} className="text-muted hover:text-brand">
          Selecionar todas ({visiveis.length})
        </button>
      </div>
    ) : null;
  }
  return (
    <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-md border border-brand bg-surface px-3 py-2 shadow-sm">
      <b className="com-num text-sm">{n}</b>
      <span className="text-sm text-muted">{n === 1 ? 'selecionada' : 'selecionadas'}</span>
      {visiveis.some((t) => !sel.has(t.id)) && (
        <button onClick={() => marcarVarias(visiveis.map((t) => t.id))} className="text-sm text-muted hover:text-brand">todas ({visiveis.length})</button>
      )}
      <span className="mx-1 h-5 w-px bg-border" />
      <select disabled={trabalhando} value="" className={campo} onChange={(e) => e.target.value && editar({ pessoaId: e.target.value === SEM ? null : e.target.value }, 'Responsável trocado')}>
        <option value="">Responsável…</option>
        {equipe.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
        <option value={SEM}>— ninguém —</option>
      </select>
      {!areaFixa && (
        <select disabled={trabalhando} value="" className={campo} onChange={(e) => e.target.value && editar({ areaId: e.target.value }, 'Área trocada')}>
          <option value="">Área…</option>
          {p.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-sm text-muted">
        Prazo
        <input type="date" disabled={trabalhando} className={campo} onChange={(e) => e.target.value && editar({ prazo: e.target.value }, 'Prazo trocado')} />
      </label>
      {temAberta && (
        <button disabled={trabalhando} onClick={() => concluir(true)} className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50">
          ✓ Marcar como concluídas
        </button>
      )}
      {temFeita && (
        <button disabled={trabalhando} onClick={() => concluir(false)} className="rounded-md border border-border px-3 py-1 text-sm hover:border-brand disabled:opacity-50">
          Reabrir
        </button>
      )}
      <button onClick={() => marcarVarias([])} className="ml-auto text-sm text-muted hover:text-brand">{trabalhando ? 'aplicando…' : 'limpar seleção'}</button>
    </div>
  );
}

// ---------------- Resumo (Visão geral da empresa) ----------------

/** URL da lista de tarefas já filtrada: é para onde todo clique do resumo leva. */
function urlDaLista(f: Filtro) {
  const q = new URLSearchParams({ ver: 'lista' });
  for (const k of CHAVES) if (f[k]) q.set(k, f[k]!);
  return `/dia-a-dia?${q}`;
}

/**
 * O resumo das tarefas de todas as áreas, para Visão geral da empresa: números
 * grandes, carga por prazo, por responsável e por área, e a tabela de cada
 * pessoa. Todo número e toda coluna abrem Dia a dia › Tarefas já filtrada.
 */
export function ResumoDeTarefas() {
  const { token, ready } = useAuth();
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then(setP).catch((e) => setErro(e.message));
  }, [ready, token]);
  if (erro) return <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>;
  if (!p) return <p className="text-muted">Carregando…</p>;
  const abrirLista = (f: Filtro) => { window.location.href = urlDaLista(f); };

  const abertas = p.tarefas.filter((t) => t.situacao !== 'feita');
  const conta = (s: SituacaoDoPrazo) => abertas.filter((t) => t.situacao === s).length;
  const semDono = abertas.filter((t) => !t.pessoa).length;
  const seteDiasAtras = new Date(Date.now() - 7 * 86400e3).toISOString();
  const feitas = p.tarefas.filter((t) => t.situacao === 'feita' && t.updatedAt >= seteDiasAtras).length;

  const porSituacao: Fatia[] = colunasDoPrazo(abertas).map((s) => ({
    chave: s, rotulo: nomeDaSituacao(s, p.hoje), valor: conta(s), cor: COR_DA_SITUACAO[s], onClick: () => abrirLista({ situacao: s }),
  }));
  const atrasadasDe = (lista: TarefaDoDia[]) => `${lista.filter((t) => t.situacao === 'atrasada').length} atrasadas`;
  const porPessoa: Fatia[] = [
    ...p.pessoas.map((pe) => {
      const delas = abertas.filter((t) => t.pessoas.some((x) => x.id === pe.id));
      return { chave: pe.id, rotulo: primeiro(pe.nome), valor: delas.length, cor: FORTE, dica: atrasadasDe(delas), onClick: () => abrirLista({ pessoa: pe.id }) };
    }),
    ...(semDono ? [{ chave: SEM, rotulo: 'Sem responsável', valor: semDono, cor: FRACO, onClick: () => abrirLista({ pessoa: SEM }) }] : []),
  ];
  const semArea = abertas.filter((t) => !t.area).length;
  const porArea: Fatia[] = [
    ...p.areas.map((a) => {
      const delas = abertas.filter((t) => t.area?.id === a.id);
      return { chave: a.id, rotulo: a.nome, valor: delas.length, cor: FORTE, dica: atrasadasDe(delas), onClick: () => abrirLista({ area: a.id }) };
    }),
    ...(semArea ? [{ chave: SEM, rotulo: 'Sem área', valor: semArea, cor: FRACO, onClick: () => abrirLista({ area: SEM }) }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { r: 'Tarefas abertas', v: abertas.length, n: 'todas as áreas', f: {} as Filtro },
          { r: 'Atrasadas', v: conta('atrasada'), n: 'prazo já passou', f: { situacao: 'atrasada' } as Filtro },
          { r: 'Não atribuídas', v: semDono, n: 'sem responsável', f: { pessoa: SEM } as Filtro },
          { r: 'Feitas na semana', v: feitas, n: 'últimos 7 dias', f: { situacao: 'feita' } as Filtro },
        ].map((c) => (
          <div key={c.r} className="rounded-md border border-border bg-surface px-4 py-3">
            <Numero rotulo={c.r} valor={String(c.v)} nota={c.n} onClick={() => abrirLista(c.f)} />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quadro titulo="Carga por prazo" nota="tarefas abertas · clique numa coluna">
          <Barras itens={porSituacao} />
        </Quadro>
        <Quadro titulo="Tarefas por responsável" nota="abertas · clique numa pessoa">
          <Barras itens={porPessoa} />
        </Quadro>
      </div>

      <Quadro titulo="Tarefas por área" nota="abertas em cada área · clique numa coluna">
        <Barras itens={porArea} />
      </Quadro>

      <Quadro titulo="Cada pessoa" nota="o que está atrasado, em dia e sem prazo · clique num número">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="com-rotulo pb-2 font-normal">Pessoa</th>
                {(['Atrasadas', 'Em dia', 'Sem prazo', 'Feitas na semana'] as const).map((h) => (
                  <th key={h} className="com-rotulo pb-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.resumo.map((r) => {
                const id = r.pessoa?.id ?? SEM;
                const celula = (v: number, s: Recorte, mal = false) => (
                  <td className="py-2 text-right">
                    <button
                      disabled={!v}
                      onClick={() => abrirLista({ pessoa: id, situacao: s })}
                      className={`com-num rounded px-2 py-0.5 hover:bg-surface-2 disabled:text-muted/60 disabled:hover:bg-transparent ${mal && v ? 'font-bold text-bad' : ''}`}
                    >
                      {v}
                    </button>
                  </td>
                );
                return (
                  <tr key={id}>
                    <td className="py-2">{r.pessoa ? <AvatarDaPessoa nome={r.pessoa.nome} pessoaId={r.pessoa.id} tamanho="p" mostrarNome /> : 'Sem responsável'}</td>
                    {celula(r.atrasadas, 'atrasada', true)}
                    {celula(r.emDia, 'emdia')}
                    {celula(r.semPrazo, 'sem_prazo')}
                    {celula(r.feitasNaSemana, 'feita')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Quadro>
    </div>
  );
}

// ---------------- Filtros ----------------

function Filtros({ p, filtro, mudar, areaFixa }: { p: PainelDeTarefas; filtro: Filtro; mudar: (f: Filtro) => void; areaFixa: boolean }) {
  const set = (k: keyof Filtro, v: string) => { const f = { ...filtro }; if (v) (f as Record<string, string>)[k] = v; else delete f[k]; mudar(f); };
  const sel = 'rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-brand';
  const ativos = CHAVES.filter((k) => filtro[k] && !(areaFixa && k === 'area')).length;
  // O "Todas" antigo (`situacao=todas`) é o mesmo que mostrar as concluídas.
  const mostrarConcluidas = filtro.concluidas === 'mostrar' || filtro.situacao === 'todas';
  const alternarConcluidas = () => {
    const f = { ...filtro };
    if (mostrarConcluidas) { delete f.concluidas; if (f.situacao === 'todas') delete f.situacao; } else f.concluidas = 'mostrar';
    mudar(f);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={filtro.q ?? ''}
        onChange={(e) => set('q', e.target.value)}
        placeholder="Buscar tarefa ou cliente"
        className={`${sel} w-56`}
      />
      <select value={filtro.pessoa ?? ''} onChange={(e) => set('pessoa', e.target.value)} className={sel}>
        <option value="">Todas as pessoas</option>
        {p.pessoas.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
        <option value={SEM}>Sem responsável</option>
      </select>
      {!areaFixa && (
        <select value={filtro.area ?? ''} onChange={(e) => set('area', e.target.value)} className={sel}>
          <option value="">Todas as áreas</option>
          {p.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          <option value={SEM}>Sem área</option>
        </select>
      )}
      {/*
        Layout 26/10: o prazo fica no select; abertas e concluídas, no botão "Mostrar concluídas" (o padrão do
        Trabalho). "Só concluídas" segue para o link "Feitas na semana" do resumo; "Em dia", "A partir de" e o
        "Todas" antigo só aparecem quando vêm de um link.
      */}
      <select aria-label="Prazo" value={filtro.situacao ?? ''} onChange={(e) => set('situacao', e.target.value)} className={sel}>
        <option value="">Qualquer prazo</option>
        {([...ABERTAS, 'feita', ...(filtro.situacao === 'mais_tarde' || filtro.situacao === 'emdia' || filtro.situacao === 'todas' ? [filtro.situacao] : [])] as Recorte[])
          .map((s) => <option key={s} value={s}>{s === 'feita' ? 'Só concluídas' : nomeDaSituacao(s, p.hoje)}</option>)}
      </select>
      {p.clientes.length > 0 && (
        <select value={filtro.cliente ?? ''} onChange={(e) => set('cliente', e.target.value)} className={sel}>
          <option value="">Todos os clientes e leads</option>
          <OpcoesDeCliente clientes={p.clientes} />
        </select>
      )}
      {/* Layout 26/10: concluídas escondidas por padrão, como no Trabalho; este botão traz de volta. */}
      <button
        type="button"
        data-testid="dia-concluidas"
        aria-pressed={mostrarConcluidas}
        onClick={alternarConcluidas}
        title={mostrarConcluidas ? 'Esconder de novo as tarefas concluídas' : 'Ver também as tarefas já concluídas'}
        className={`rounded-md border px-2.5 py-1.5 text-sm ${mostrarConcluidas ? 'border-brand bg-brand/15 text-text' : 'border-border bg-surface-2 text-muted hover:text-text'}`}
      >
        {mostrarConcluidas ? 'Ocultar concluídas' : 'Mostrar concluídas'}
      </button>
      {ativos > 0 && <button onClick={() => mudar({})} className="text-sm text-muted hover:text-brand">limpar filtros</button>}
    </div>
  );
}

// ---------------- Cartão ----------------

/**
 * A caixinha da esquerda SELECIONA a tarefa (uma ou várias, para mudar em lote).
 * Concluir é na barra de seleção ou dentro da tarefa — nunca um clique perdido.
 */
function Selecao({ id, titulo, sel, marcar }: { id: string; titulo: string; sel: Set<string>; marcar: (id: string) => void }) {
  const marcada = sel.has(id);
  return (
    <input
      type="checkbox"
      checked={marcada}
      aria-label={`Selecionar: ${titulo}`}
      onClick={(e) => e.stopPropagation()}
      onChange={() => marcar(id)}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-[rgb(var(--os-ac))]"
    />
  );
}

/*
 * Os responsáveis da tarefa como avatares (produção 22B, I6): a conta com o id
 * (a foto vem da lista da empresa); o texto antigo sem conta vira as iniciais,
 * com "(sem conta)" no balão, como dizia o texto de antes.
 */
function avataresDaTarefa(t: Pick<TarefaDoDia, 'pessoas' | 'responsavelTexto'>): PessoaNoAvatar[] {
  if (t.pessoas.length) return t.pessoas.map((x) => ({ id: x.id, nome: x.nome }));
  return t.responsavelTexto ? [{ nome: t.responsavelTexto, rotulo: `${t.responsavelTexto} (sem conta)` }] : [];
}

const nomesDosResponsaveis = (t: Pick<TarefaDoDia, 'pessoas' | 'responsavelTexto'>) =>
  avataresDaTarefa(t).map((x) => x.rotulo ?? x.nome).join(', ') || 'ninguém';

/**
 * Layout 26/10: a DENSIDADE do cartão, a mesma de todo quadro do OS (`SeletorDeDensidade`).
 * Compacto: prazo, responsáveis e repetição; médio: + área e cliente; cheio: + a lista.
 */
function Meta({ t, mostrarArea, mostrarPessoa, densidade = 'medio' }: { t: TarefaDoDia; mostrarArea: boolean; mostrarPessoa: boolean; densidade?: Densidade }) {
  const compacto = densidade === 'compacto';
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
      {mostrarArea && !compacto && <span>{t.area?.nome ?? 'sem área'}</span>}
      {densidade === 'cheio' && <span>{t.lista.nome}</span>}
      {t.cliente && !compacto && (
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); abrirFicha(t.cliente!.id); }}
          className="cursor-pointer rounded-full border border-border px-2 py-0.5 hover:border-brand hover:text-brand"
        >
          {t.cliente.titulo}
        </span>
      )}
      {mostrarPessoa && <PilhaDeAvatares pessoas={avataresDaTarefa(t)} prefixo="Responsável" vazio="sem responsável" testId={`dia-responsaveis-${t.id}`} />}
      {!mostrarPessoa && t.pessoas.length > 1 && (
        <PilhaDeAvatares pessoas={t.pessoas.slice(1).map((x) => ({ id: x.id, nome: x.nome }))} prefixo="Também responsável" testId={`dia-tambem-${t.id}`} />
      )}
      {/* Layout 26/10: sem prazo é diferente de repetir; a tarefa que repete diz a regra (ou a data e o ↻). */}
      {(t.prazo || t.recorrencia) && (
        <span className={`com-num ${t.situacao === 'atrasada' ? 'font-semibold text-bad' : ''}`}>
          <PrazoComRepeticao texto={t.prazo ? dd(t.prazo) : null} recorrencia={t.recorrencia} semPrazo={null} testId={`dia-prazo-${t.id}`} />
        </span>
      )}
    </div>
  );
}

/** O status com cara própria: a fazer (contorno), em andamento (lima claro), concluída (lima cheio). */
const ESTILO_DA_ETAPA: Record<EtapaDaTarefa, string> = {
  aberta: 'border border-border-strong text-muted',
  andamento: 'bg-brand/20 text-text',
  concluida: 'bg-brand text-ink',
};
const NOME_DA_ETAPA: Record<EtapaDaTarefa, string> = { aberta: 'A fazer', andamento: 'Em andamento', concluida: '✓ Concluída' };
function SeloDoStatus({ t }: { t: TarefaDoDia }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_DA_ETAPA[t.status.tipo]}`}>{NOME_DA_ETAPA[t.status.tipo]}</span>;
}

// ---------------- Quadro ----------------

interface Coluna { chave: string; nome: string; itens: TarefaDoDia[] }

function QuadroDeTarefas(props: {
  p: PainelDeTarefas; tarefas: TarefaDoDia[]; agrupar: Agrupar; podeEditar: boolean;
  trocarAgrupar: (g: Agrupar) => void; abrir: (id: string) => void; alternar: (t: TarefaDoDia) => void;
  editar: (t: TarefaDoDia, m: Record<string, unknown>) => void; criado: () => void; token: string | null;
  /** Id da área quando o quadro é a aba de uma área: some a coluna por área e a tarefa nova nasce nela. */
  areaFixa?: string;
  sel: Set<string>; marcar: (id: string) => void; marcarVarias: (ids: string[]) => void;
  reordenar: (ids: string[]) => void;
}) {
  const { p, tarefas, agrupar, areaFixa } = props;
  const menu = useMenuDaTarefa();
  const [antesDe, setAntesDe] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const altura = useAlturaAteOFim(ref);
  // Layout 26/10: a densidade dos cards, a mesma preferência de todo quadro do OS.
  const [densidade, escolherDensidade] = useDensidade();
  const [arrastando, setArrastando] = useState<TarefaDoDia | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);

  const colunas: Coluna[] = agrupar === 'pessoa'
    ? [
      ...p.pessoas.map((pe) => ({ chave: pe.id, nome: pe.nome, itens: tarefas.filter((t) => t.pessoa?.id === pe.id) })),
      { chave: SEM, nome: 'Sem responsável', itens: tarefas.filter((t) => !t.pessoa) },
    ]
    : agrupar === 'area'
      ? [
        ...p.areas.map((a) => ({ chave: a.id, nome: a.nome, itens: tarefas.filter((t) => t.area?.id === a.id) })),
        { chave: SEM, nome: 'Sem área', itens: tarefas.filter((t) => !t.area) },
      ]
      : colunasDoPrazo(tarefas).map((s) => ({ chave: s, nome: nomeDaSituacao(s, p.hoje), itens: tarefas.filter((t) => t.situacao === s) }));
  const visiveis = colunas.filter((c) => c.chave !== SEM || c.itens.length > 0);

  /** Muda a coluna (pessoa ou área) quando a tarefa foi parar em outra. */
  const mudarColuna = (t: TarefaDoDia, chave: string) => {
    if (agrupar === 'pessoa' && (t.pessoa?.id ?? SEM) !== chave) {
      props.editar(t, { pessoasIds: chave === SEM ? [] : [chave, ...t.pessoas.map((x) => x.id).filter((x) => x !== chave && x !== t.pessoa?.id)] });
    }
    if (agrupar === 'area' && (t.area?.id ?? SEM) !== chave && chave !== SEM) props.editar(t, { areaId: chave });
  };
  /** Soltar sobre um card: a tarefa entra antes dele (e muda de coluna, se for o caso). */
  const soltarAntes = (chave: string, alvoId: string) => {
    const t = arrastando;
    setArrastando(null); setSobre(null); setAntesDe(null);
    if (!t || t.id === alvoId) return;
    const coluna = visiveis.find((c) => c.chave === chave);
    if (!coluna) return;
    if (agrupar === 'situacao' && t.situacao !== chave) return; // o prazo não muda arrastando entre colunas de prazo
    const seq = coluna.itens.filter((x) => x.id !== t.id).map((x) => x.id);
    seq.splice(Math.max(0, seq.indexOf(alvoId)), 0, t.id);
    props.reordenar(seq);
    mudarColuna(t, chave);
  };
  const soltar = (chave: string) => {
    const t = arrastando;
    setArrastando(null); setSobre(null); setAntesDe(null);
    if (!t) return;
    // Soltar no fim da coluna: vai para o fim dela.
    const coluna = visiveis.find((c) => c.chave === chave);
    if (coluna && (agrupar !== 'situacao' || t.situacao === chave)) props.reordenar([...coluna.itens.filter((x) => x.id !== t.id).map((x) => x.id), t.id]);
    if (agrupar === 'situacao') return;
    if (agrupar === 'pessoa' && (t.pessoa?.id ?? SEM) !== chave) {
      props.editar(t, { pessoasIds: chave === SEM ? [] : [chave, ...t.pessoas.map((x) => x.id).filter((x) => x !== chave && x !== t.pessoa?.id)] });
    }
    if (agrupar === 'area' && (t.area?.id ?? SEM) !== chave && chave !== SEM) props.editar(t, { areaId: chave });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Colunas por</span>
        {(['pessoa', 'area', 'situacao'] as Agrupar[]).filter((g) => !areaFixa || g !== 'area').map((g) => (
          <button
            key={g}
            onClick={() => props.trocarAgrupar(g)}
            className={`rounded-full border px-3 py-1 ${agrupar === g ? 'border-brand text-text' : 'border-border text-muted hover:text-text'}`}
          >
            {g === 'pessoa' ? 'Pessoa' : g === 'area' ? 'Área' : 'Prazo'}
          </button>
        ))}
        <span className="ml-auto"><SeletorDeDensidade densidade={densidade} aoEscolher={escolherDensidade} testId="dia-densidade" /></span>
      </div>
      {/* Layout 26/10 (P-32): as colunas crescem com os cards e a página rola até o fim; o quadro tem no mínimo a altura da janela. */}
      <div ref={ref} data-testid="dia-quadro" className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: altura ?? undefined }}>
        {visiveis.map((c) => {
          const atrasadas = c.itens.filter((t) => t.situacao === 'atrasada').length;
          return (
            <section
              key={c.chave}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(c.chave); } }}
              onDragLeave={() => setSobre((s) => (s === c.chave ? null : s))}
              onDrop={() => soltar(c.chave)}
              data-coluna={c.chave}
              style={{ width: LARGURA_DA_COLUNA[densidade] }}
              className={`flex shrink-0 flex-col rounded-md border bg-surface max-md:max-h-[72dvh] ${sobre === c.chave ? 'border-brand' : 'border-border'}`}
            >
              <div className={`shrink-0 border-b border-t-[3px] border-b-border px-3 py-2.5 ${c.chave === 'atrasada' ? 'border-t-bad' : 'border-t-brand'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  {agrupar === 'pessoa' && c.chave !== SEM
                    ? <AvatarDaPessoa nome={c.nome} pessoaId={c.chave} tamanho="p" mostrarNome className="font-medium" />
                    : <span className="font-medium">{c.nome}</span>}
                  <span className="flex items-center gap-2">
                    {c.itens.length > 0 && (
                      <button onClick={() => props.marcarVarias(c.itens.map((t) => t.id))} className="text-xs text-muted hover:text-brand" title="Selecionar as tarefas desta coluna">
                        selecionar
                      </button>
                    )}
                    <span className="com-num text-sm text-muted">{c.itens.length}</span>
                  </span>
                </div>
                <div className="text-xs text-muted">{atrasadas ? <span className="font-semibold text-bad">{atrasadas} atrasadas</span> : 'nada atrasado'}</div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2 max-md:min-h-0 max-md:overflow-y-auto" data-rolagem-da-coluna>
                {props.podeEditar && agrupar !== 'situacao' && (novoEm === c.chave ? (
                  <CriarRapido
                    p={p} token={props.token}
                    base={agrupar === 'pessoa' ? { pessoaId: c.chave === SEM ? null : c.chave, areaId: areaFixa } : { areaId: c.chave === SEM ? undefined : c.chave }}
                    fechar={() => setNovoEm(null)} criado={() => { setNovoEm(null); props.criado(); }} abrir={props.abrir}
                  />
                ) : (
                  <button onClick={() => setNovoEm(c.chave)} className="rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-brand">
                    + Adicionar tarefa
                  </button>
                ))}
                {c.itens.map((t) => (
                  <div
                    {...alvoDoMenu(menu, { id: t.id, title: t.titulo })}
                    key={t.id}
                    draggable={props.podeEditar}
                    onDragStart={() => setArrastando(t)}
                    onDragEnd={() => { setArrastando(null); setSobre(null); setAntesDe(null); }}
                    onDragOver={(e) => { if (arrastando) { e.preventDefault(); e.stopPropagation(); setSobre(c.chave); setAntesDe(t.id); } }}
                    onDrop={(e) => { e.stopPropagation(); soltarAntes(c.chave, t.id); }}
                    onClick={() => props.abrir(t.id)}
                    style={antesDe === t.id && arrastando?.id !== t.id ? { boxShadow: 'inset 0 3px 0 rgb(var(--os-ac))' } : undefined}
                    className={`flex shrink-0 cursor-pointer gap-2 rounded-md border bg-surface-2 px-3 py-2 hover:border-brand/60 ${props.sel.has(t.id) ? 'border-brand' : 'border-border'} ${arrastando?.id === t.id ? 'opacity-40' : ''}`}
                  >
                    {props.podeEditar && <Selecao id={t.id} titulo={t.titulo} sel={props.sel} marcar={props.marcar} />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium leading-snug ${t.situacao === 'feita' ? 'text-muted line-through' : ''}`}>{t.titulo}</div>
                      <Meta t={t} mostrarArea={agrupar !== 'area' && !areaFixa} mostrarPessoa={agrupar !== 'pessoa'} densidade={densidade} />
                      {(t.status.tipo !== 'aberta' || densidade === 'cheio') && <div className="mt-1.5"><SeloDoStatus t={t} /></div>}
                      {densidade === 'cheio' && t.descricao && <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted">{t.descricao}</p>}
                    </div>
                    <BotaoDoMenuDaTarefa tarefa={{ id: t.id, title: t.titulo }} className="self-start" />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Lista ----------------

type Coluninha = 'ordem' | 'titulo' | 'area' | 'cliente' | 'pessoa' | 'prazo';
function ListaDeTarefas({ p, equipe, tarefas, abrir, podeEditar, mostrarArea = true, sel, marcar, marcarVarias, editar, reordenar }: {
  p: PainelDeTarefas; equipe: PainelDeTarefas['pessoas']; tarefas: TarefaDoDia[]; abrir: (id: string) => void; podeEditar: boolean; mostrarArea?: boolean;
  sel: Set<string>; marcar: (id: string) => void; marcarVarias: (ids: string[]) => void;
  editar: (t: TarefaDoDia, m: Record<string, unknown>) => void;
  reordenar: (ids: string[]) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [antesDe, setAntesDe] = useState<string | null>(null);
  const menu = useMenuDaTarefa();
  /*
   * Cada célula se edita sozinha (prazo, responsável, cliente, área, status),
   * sem abrir a tarefa: o clique na célula não abre a janela; o no título abre.
   */
  const celula = 'w-full cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted outline-none hover:border-border focus:border-brand disabled:cursor-default disabled:hover:border-transparent';
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();
  // Ordem manual por padrão: é a que o arrastar muda. Clicar num título ordena por aquela coluna.
  const [por, setPor] = useState<Coluninha>('ordem');
  const chave: Record<Coluninha, (t: TarefaDoDia) => string> = {
    ordem: () => '',
    titulo: (t) => t.titulo, area: (t) => t.area?.nome ?? '~', cliente: (t) => t.cliente?.titulo ?? '~',
    pessoa: (t) => t.pessoa?.nome ?? '~', prazo: (t) => t.prazo ?? '9999',
  };
  const linhas = [...tarefas].sort((a, b) => (por === 'ordem' ? 0 : chave[por](a).localeCompare(chave[por](b), 'pt')) || ordem(a, b));
  const manual = por === 'ordem' && podeEditar;
  const soltarAntes = (alvoId: string) => {
    const id = arrastando;
    setArrastando(null); setAntesDe(null);
    if (!id || id === alvoId) return;
    const seq = linhas.map((t) => t.id).filter((x) => x !== id);
    seq.splice(Math.max(0, seq.indexOf(alvoId)), 0, id);
    reordenar(seq);
  };
  const th = (k: Coluninha, n: string) => (
    <th className="com-rotulo pb-2 pr-3 font-normal">
      <button onClick={() => setPor(k)} className={`hover:text-text ${por === k ? 'text-text' : ''}`}>{n}{por === k ? ' ↓' : ''}</button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface px-4 py-3">
      <div className="mb-2 flex items-center gap-3 text-xs text-muted">
        {por === 'ordem'
          ? <span>{podeEditar ? 'Ordem manual: arraste pela alça ⠿ para mudar a posição.' : 'Ordem manual.'}</span>
          : <button onClick={() => setPor('ordem')} className="hover:text-brand">voltar para a ordem manual</button>}
      </div>
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-left">
            <th className="w-6 pb-2">
              {podeEditar && linhas.length > 0 && (
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as tarefas da lista"
                  checked={linhas.every((t) => sel.has(t.id))}
                  onChange={() => marcarVarias(linhas.every((t) => sel.has(t.id)) ? [] : linhas.map((t) => t.id))}
                  className="h-4 w-4 cursor-pointer accent-[rgb(var(--os-ac))]"
                />
              )}
            </th>
            {th('titulo', 'Tarefa')}{mostrarArea && th('area', 'Área')}{th('cliente', 'Cliente')}{th('pessoa', 'Responsável')}{th('prazo', 'Prazo')}
            <th className="com-rotulo pb-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((t) => (
            <tr
              {...alvoDoMenu(menu, { id: t.id, title: t.titulo })}
              key={t.id}
              onClick={() => abrir(t.id)}
              draggable={manual}
              onDragStart={() => setArrastando(t.id)}
              onDragEnd={() => { setArrastando(null); setAntesDe(null); }}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setAntesDe(t.id); } }}
              onDrop={() => soltarAntes(t.id)}
              style={antesDe === t.id && arrastando !== t.id ? { boxShadow: 'inset 0 3px 0 rgb(var(--os-ac))' } : undefined}
              className={`cursor-pointer hover:bg-surface-2 ${sel.has(t.id) ? 'bg-brand/10' : ''} ${arrastando === t.id ? 'opacity-40' : ''}`}
            >
              <td className="py-2 pr-2">
                <span className="flex items-center gap-1.5">
                  {manual && <span className="cursor-grab select-none text-muted/70" title="Arraste para mudar a posição" aria-hidden>⠿</span>}
                  {podeEditar && <Selecao id={t.id} titulo={t.titulo} sel={sel} marcar={marcar} />}
                </span>
              </td>
              <td className={`py-2 pr-3 font-medium hover:text-brand ${t.situacao === 'feita' ? 'text-muted line-through' : ''}`}>
                <span className="flex items-center justify-between gap-1">{t.titulo}<BotaoDoMenuDaTarefa tarefa={{ id: t.id, title: t.titulo }} /></span>
              </td>
              {mostrarArea && (
                <td className="py-1.5 pr-2" onClick={parar}>
                  <select disabled={!podeEditar} value={t.area?.id ?? ''} onChange={(e) => e.target.value && editar(t, { areaId: e.target.value })} className={celula} aria-label="Área">
                    {!t.area && <option value="">sem área</option>}
                    {p.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                  </select>
                </td>
              )}
              <td className="py-1.5 pr-2" onClick={parar}>
                <select disabled={!podeEditar} value={t.cliente?.id ?? ''} onChange={(e) => editar(t, { clienteId: e.target.value || null })} className={celula} aria-label="Cliente">
                  <option value="">—</option>
                  <OpcoesDeCliente clientes={p.clientes} />
                </select>
              </td>
              <td className="py-1.5 pr-2" onClick={parar}>
                <ResponsaveisNaCelula t={t} equipe={equipe} podeEditar={podeEditar} editar={(m) => editar(t, m)} />
              </td>
              <td className="py-1.5 pr-2" onClick={parar}>
                <input
                  type="date" disabled={!podeEditar} value={t.prazo ?? ''} aria-label="Prazo"
                  onChange={(e) => editar(t, { prazo: e.target.value || null })}
                  className={`${celula} com-num ${t.situacao === 'atrasada' ? 'font-semibold text-bad' : ''}`}
                />
                {/* Layout 26/10: sem prazo é diferente de repetir; a regra (ou o ↻ ao lado da data) aparece aqui. */}
                {t.recorrencia && (
                  <span className="block px-1 text-xs text-muted">
                    <PrazoComRepeticao texto={t.prazo ? dd(t.prazo) : null} recorrencia={t.recorrencia} semPrazo={null} testId={`dia-lista-prazo-${t.id}`} />
                  </span>
                )}
              </td>
              <td className="py-1.5" onClick={parar}>
                {podeEditar ? (
                  <select
                    value={t.status.tipo} aria-label="Status"
                    onChange={(e) => editar(t, { etapa: e.target.value })}
                    className={`cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium outline-none ${ESTILO_DA_ETAPA[t.status.tipo]}`}
                  >
                    <option value="aberta">A fazer</option>
                    <option value="andamento">Em andamento</option>
                    <option value="concluida">✓ Concluída</option>
                  </select>
                ) : <SeloDoStatus t={t} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="py-3 text-muted">Nada com esses filtros.</p>}
    </div>
  );
}

// ---------------- Calendário ----------------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** Soma dias a um AAAA-MM-DD sem passar pelo fuso local (o dia não escorrega). */
const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * As tarefas no dia do prazo, mês a mês (o mesmo molde do calendário do Funil).
 * Arrastar para outro dia muda o prazo; as sem prazo ficam numa faixa embaixo e
 * também podem ser arrastadas para um dia. A tarefa continua uma só.
 */
function CalendarioDeTarefas({ tarefas, hoje, podeEditar, abrir, mudarPrazo, reordenar }: {
  tarefas: TarefaDoDia[]; hoje: string; podeEditar: boolean;
  abrir: (id: string) => void; mudarPrazo: (t: TarefaDoDia, prazo: string) => void; reordenar: (ids: string[]) => void;
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [arrastando, setArrastando] = useState<TarefaDoDia | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [ano, m] = mes.split('-').map(Number);
  const primeiroDia = `${mes}-01`;
  const diaDaSemana = new Date(`${primeiroDia}T12:00:00Z`).getUTCDay();
  const inicio = somaDias(primeiroDia, -((diaDaSemana + 6) % 7)); // a grade começa na segunda
  const dias = Array.from({ length: 42 }, (_, i) => somaDias(inicio, i));
  const porDia = new Map<string, TarefaDoDia[]>();
  for (const t of tarefas) if (t.prazo) porDia.set(t.prazo, [...(porDia.get(t.prazo) ?? []), t]);
  // Layout 26/10: sem prazo é diferente de repetir; a que repete sem data tem a faixa dela.
  const semPrazo = tarefas.filter((t) => !t.prazo && !t.recorrencia);
  const repetemSemData = tarefas.filter((t) => !t.prazo && t.recorrencia);
  const irMes = (n: number) => {
    const d = new Date(Date.UTC(ano, m - 1 + n, 1));
    setMes(d.toISOString().slice(0, 7));
  };
  const soltar = (dia: string) => {
    const t = arrastando;
    setArrastando(null);
    setSobre(null);
    if (t && t.prazo !== dia) mudarPrazo(t, dia);
  };
  const botao = 'rounded-md border border-border px-2.5 py-1 text-sm hover:border-brand';
  const arrastavel = (t: TarefaDoDia) => ({
    draggable: podeEditar,
    onDragStart: () => setArrastando(t),
    onDragEnd: () => { setArrastando(null); setSobre(null); },
    onClick: () => abrir(t.id),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => irMes(-1)} className={botao} aria-label="Mês anterior">‹</button>
          <button onClick={() => setMes(hoje.slice(0, 7))} className={botao}>hoje</button>
          <button onClick={() => irMes(1)} className={botao} aria-label="Próximo mês">›</button>
        </div>
        <span className="text-[1.05rem] font-semibold">{MESES[m - 1]} {ano}</span>
        {podeEditar && <span className="ml-auto text-sm text-muted">arraste uma tarefa para mudar o prazo</span>}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border bg-surface">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
          <div key={d} className="com-rotulo border-b border-border px-2 py-1.5">{d}</div>
        ))}
        {dias.map((dia) => {
          const doDia = porDia.get(dia) ?? [];
          const foraDoMes = dia.slice(0, 7) !== mes;
          return (
            <div
              key={dia}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(dia); } }}
              onDragLeave={() => setSobre((x) => (x === dia ? null : x))}
              onDrop={() => soltar(dia)}
              className={`min-h-[6.5rem] border-b border-r border-border p-1.5 ${foraDoMes ? 'bg-surface-2/40' : ''} ${sobre === dia ? 'bg-brand/10' : ''}`}
            >
              <span className={`com-num text-xs ${dia === hoje ? 'rounded-full bg-brand px-1.5 text-ink' : foraDoMes ? 'text-muted/60' : 'text-muted'}`}>
                {Number(dia.slice(8))}
              </span>
              <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                {doDia.map((t) => (
                  <div
                    key={t.id}
                    {...arrastavel(t)}
                    onDragOver={(e) => { if (arrastando) { e.preventDefault(); e.stopPropagation(); setSobre(dia); } }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      const a = arrastando;
                      setArrastando(null); setSobre(null);
                      if (!a || a.id === t.id) return;
                      const seq = doDia.map((x) => x.id).filter((x) => x !== a.id);
                      seq.splice(Math.max(0, seq.indexOf(t.id)), 0, a.id);
                      if (a.prazo !== dia) mudarPrazo(a, dia);
                      reordenar(seq);
                    }}
                    title={[t.titulo, t.pessoa ? primeiro(t.pessoa.nome) : null, t.area?.nome].filter(Boolean).join(' · ')}
                    className={`cursor-pointer truncate rounded border-l-2 bg-surface-2 px-1.5 py-0.5 text-xs hover:bg-brand/15 ${t.situacao === 'atrasada' ? 'border-bad text-bad' : t.situacao === 'feita' ? 'border-border text-muted line-through' : 'border-brand'}`}
                  >
                    {t.titulo}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {semPrazo.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          <div className="com-rotulo mb-2">Sem prazo · {semPrazo.length}{podeEditar ? ' · arraste para um dia' : ''}</div>
          <div className="flex flex-wrap gap-2">
            {semPrazo.map((t) => (
              <div key={t.id} {...arrastavel(t)} className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1 text-sm hover:border-brand/60">
                {t.titulo}
              </div>
            ))}
          </div>
        </div>
      )}
      {repetemSemData.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-3" data-testid="dia-calendario-repetem">
          <div className="com-rotulo mb-2">Repetem, sem data marcada · {repetemSemData.length}{podeEditar ? ' · arraste para um dia' : ''}</div>
          <div className="flex flex-wrap gap-2">
            {repetemSemData.map((t) => (
              <div key={t.id} {...arrastavel(t)} className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1 text-sm hover:border-brand/60">
                {t.titulo} <span className="text-xs text-muted"><PrazoComRepeticao texto={null} recorrencia={t.recorrencia} semPrazo={null} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Criar (no quadro e na janela) ----------------

type Aviso = Extract<ResultadoDeCriar, { criada: false }>['aviso'];

function AvisoDeCriar({ aviso, criarAssim, abrir, cancelar }: { aviso: Aviso; criarAssim: () => void; abrir: (id: string) => void; cancelar: () => void }) {
  const botao = 'rounded-md border border-border bg-surface px-2.5 py-1 text-xs hover:border-brand';
  return (
    <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      {aviso.tipo === 'nao_parece_tarefa' ? (
        <>
          <b className="block">Isso não parece tarefa.</b>
          <span className="text-muted">{aviso.motivo} Casa dele: {aviso.casa}.</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className={botao} onClick={criarAssim}>É tarefa, criar</button>
            <button className={botao} onClick={cancelar}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <b className="block">{aviso.tipo === 'igual' ? TAREFA_IGUAL_JA_EXISTE : 'Já existe uma parecida.'}</b>
          <span className="text-muted">“{aviso.tarefa.titulo}”{aviso.tarefa.area ? ` · ${aviso.tarefa.area.nome}` : ''}{aviso.tarefa.pessoa ? ` · ${primeiro(aviso.tarefa.pessoa.nome)}` : ''}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className="rounded-md border border-brand bg-brand px-2.5 py-1 text-xs font-medium text-ink hover:opacity-90" onClick={() => abrir(aviso.tarefa.id)}>Abrir essa</button>
            {aviso.tipo === 'parecida' && <button className={botao} onClick={criarAssim}>É outra, criar</button>}
            <button className={botao} onClick={cancelar}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

async function pedirCriacao(token: string | null, corpo: Record<string, unknown>) {
  return apiPost<ResultadoDeCriar>('/trabalho/todas', corpo, token);
}

function CriarRapido({ p, token, base, fechar, criado, abrir }: {
  p: PainelDeTarefas; token: string | null; base: { pessoaId?: string | null; areaId?: string };
  fechar: () => void; criado: () => void; abrir: (id: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const areaId = base.areaId ?? p.areas[0]?.id;
  const enviar = async (confirmar = false) => {
    if (!texto.trim() || !areaId) return;
    setErro(null);
    try {
      const r = await pedirCriacao(token, { titulo: texto.trim(), areaId, pessoaId: base.pessoaId ?? null, confirmar });
      if (r.criada) { setTexto(''); criado(); } else setAviso(r.aviso);
    } catch (e) { setErro((e as Error).message); }
  };
  return (
    <div className="space-y-1.5">
      <input
        autoFocus
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAviso(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); if (e.key === 'Escape') fechar(); }}
        placeholder="O que precisa ser feito? Enter cria"
        className="w-full rounded-md border border-brand bg-surface-2 px-2.5 py-1.5 text-sm outline-none"
      />
      {!base.areaId && <p className="text-[0.7rem] text-muted">entra em {p.areas[0]?.nome}; troque na tarefa</p>}
      {aviso && <AvisoDeCriar aviso={aviso} criarAssim={() => enviar(true)} abrir={abrir} cancelar={() => { setAviso(null); fechar(); }} />}
      {erro && <p className="text-xs text-bad">{erro}</p>}
    </div>
  );
}

// ---------------- Janelas ----------------

function Janela({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = antes; window.removeEventListener('keydown', esc); };
  }, [fechar]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 min-[820px]:p-8" onClick={fechar}>
      <div
        role="dialog" aria-modal="true" aria-label={titulo}
        className="relative max-h-full w-full max-w-[720px] overflow-y-auto rounded-lg border border-border bg-bg p-5 shadow-2xl min-[820px]:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={fechar} aria-label="Fechar" className="absolute right-3 top-3 rounded-md px-2 py-0.5 text-xl leading-none text-muted hover:bg-surface-2 hover:text-text">×</button>
        {children}
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="com-rotulo mb-1 block">{rotulo}</span>
      {children}
    </label>
  );
}

/*
 * Layout 26/10 (P-16 e P-29): OS RESPONSÁVEIS NA CÉLULA DA LISTA, no padrão do Trabalho.
 * Só a equipe (a regra da tela Equipe) mais quem já está na tarefa, com a foto de cada
 * um; a caixa abre num portal (`EscolhaNaCelula`), então a tabela que rola de lado não a
 * corta. Continua como antes: clicar liga ou desliga a pessoa, e o primeiro marcado é o
 * principal (a coluna dele no quadro por pessoa). A caixa fica aberta para marcar várias.
 */
function ResponsaveisNaCelula({ t, equipe, podeEditar, editar }: {
  t: TarefaDoDia; equipe: PainelDeTarefas['pessoas']; podeEditar: boolean; editar: (m: Record<string, unknown>) => void;
}) {
  const [busca, setBusca] = useState('');
  const ids = t.pessoas.map((x) => x.id);
  const rotulo = `Responsáveis: ${nomesDosResponsaveis(t)}`;
  const pilha = avataresDaTarefa(t).length ? <PilhaDeAvatares pessoas={avataresDaTarefa(t)} /> : <span className="text-muted">—</span>;
  if (!podeEditar) return <span aria-label={rotulo} title={rotulo} className="inline-flex">{pilha}</span>;
  // Quem já está na tarefa fica na lista mesmo fora da equipe, para poder ser tirado.
  const disponiveis = [...equipe, ...t.pessoas.filter((x) => !equipe.some((e) => e.id === x.id))];
  const termo = tituloNormalizado(busca);
  const achadas = termo ? disponiveis.filter((pe) => tituloNormalizado(pe.nome).includes(termo)) : disponiveis;
  const alternar = (id: string) => editar({ pessoasIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2';
  return (
    <EscolhaNaCelula rotulo={rotulo} testId={`dia-celula-responsaveis-${t.id}`} gatilho={pilha}>
      {() => (
        <div className="space-y-0.5">
          {disponiveis.length > 6 && (
            <input autoFocus aria-label="Buscar pessoa" placeholder="Buscar pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand" />
          )}
          {achadas.map((pe) => {
            const on = ids.includes(pe.id);
            return (
              <button key={pe.id} type="button" aria-pressed={on} onClick={() => alternar(pe.id)} className={item}>
                <AvatarDaPessoa nome={pe.nome} pessoaId={pe.id} tamanho="p" decorativo />
                <span className="min-w-0 flex-1 truncate">{pe.nome}{ids[0] === pe.id && ids.length > 1 ? ' (principal)' : ''}</span>
                {on && <Check size={13} className="shrink-0 text-brand" />}
              </button>
            );
          })}
          {termo && achadas.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted">Ninguém com esse nome.</p>}
          {!ids.length && t.responsavelTexto && <p className="px-2 pt-1 text-[11px] text-muted">{t.responsavelTexto} (sem conta)</p>}
        </div>
      )}
    </EscolhaNaCelula>
  );
}

/** Os cards do CRM em dois grupos, para não confundir quem já é cliente com quem ainda é lead. */
function OpcoesDeCliente({ clientes }: { clientes: { id: string; titulo: string; fase?: 'lead' | 'cliente' }[] }) {
  const ativos = clientes.filter((c) => c.fase !== 'lead');
  const leads = clientes.filter((c) => c.fase === 'lead');
  return (
    <>
      {ativos.length > 0 && <optgroup label="Clientes ativos">{ativos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}</optgroup>}
      {leads.length > 0 && <optgroup label="Leads (em negociação)">{leads.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}</optgroup>}
    </>
  );
}

const ENTRADA = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-60';

function NovaTarefa({ p, equipe, token, filtro, criarArea, criarCliente, fechar, criada, abrir }: {
  criarCliente: () => Promise<{ id: string; titulo: string } | null>;
  p: PainelDeTarefas; equipe: PainelDeTarefas['pessoas']; token: string | null; filtro: Filtro; criarArea: () => Promise<AreaDeTarefa | null>;
  fechar: () => void; criada: (id: string) => void; abrir: (id: string) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [areaId, setAreaId] = useState(filtro.area && filtro.area !== SEM ? filtro.area : '');
  const [pessoaId, setPessoaId] = useState(filtro.pessoa && filtro.pessoa !== SEM ? filtro.pessoa : '');
  const [prazo, setPrazo] = useState('');
  const [clienteId, setClienteId] = useState(filtro.cliente ?? '');
  const [clientesNovos, setClientesNovos] = useState<{ id: string; titulo: string }[]>([]);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [areas, setAreas] = useState(p.areas);

  const enviar = async (confirmar = false) => {
    if (!titulo.trim()) return setErro('Escreva o que precisa ser feito.');
    if (!areaId) return setErro('Escolha a área.');
    try {
      const r = await pedirCriacao(token, {
        titulo: titulo.trim(), areaId, pessoaId: pessoaId || null, prazo: prazo || null, clienteId: clienteId || null, confirmar,
      });
      if (r.criada) criada(r.tarefa.id); else setAviso(r.aviso);
    } catch (e) { setErro((e as Error).message); }
  };

  return (
    <Janela titulo="Nova tarefa" fechar={fechar}>
      <div className="com-rotulo">Nova tarefa</div>
      <input
        autoFocus value={titulo}
        onChange={(e) => { setTitulo(e.target.value); setAviso(null); setErro(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
        placeholder="O que precisa ser feito?"
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-[1.15rem] font-medium outline-none focus:border-brand"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Área">
          <select
            value={areaId} className={ENTRADA}
            onChange={async (e) => {
              if (e.target.value === '__nova') { const a = await criarArea(); if (a) { setAreas((x) => [...x, a]); setAreaId(a.id); } return; }
              setAreaId(e.target.value);
            }}
          >
            <option value="">— escolha —</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            <option value="__nova">+ adicionar nova área…</option>
          </select>
        </Campo>
        <Campo rotulo="Responsável">
          <select value={pessoaId} className={ENTRADA} onChange={(e) => setPessoaId(e.target.value)}>
            <option value="">— ninguém —</option>
            {equipe.map((pe) => <option key={pe.id} value={pe.id}>{pe.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Prazo"><input type="date" value={prazo} className={ENTRADA} onChange={(e) => setPrazo(e.target.value)} /></Campo>
        <Campo rotulo="Cliente ou lead">
          <select
            value={clienteId} className={ENTRADA}
            onChange={async (e) => {
              if (e.target.value === '__novo') { const c = await criarCliente(); if (c) { setClientesNovos((x) => [...x, c]); setClienteId(c.id); } return; }
              setClienteId(e.target.value);
            }}
          >
            <option value="">— nenhum —</option>
            <OpcoesDeCliente clientes={[...p.clientes, ...clientesNovos.filter((c) => !p.clientes.some((x) => x.id === c.id)).map((c) => ({ ...c, fase: 'cliente' as const }))]} />
            <option value="__novo">+ cadastrar novo cliente…</option>
          </select>
        </Campo>
      </div>
      {aviso && <div className="mt-4"><AvisoDeCriar aviso={aviso} criarAssim={() => enviar(true)} abrir={abrir} cancelar={() => setAviso(null)} /></div>}
      {erro && <p className="mt-3 text-sm text-bad">{erro}</p>}
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <button onClick={fechar} className="rounded-md border border-border px-4 py-2 text-sm hover:border-brand">Cancelar</button>
        <button onClick={() => enviar()} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">Criar tarefa</button>
      </div>
    </Janela>
  );
}
