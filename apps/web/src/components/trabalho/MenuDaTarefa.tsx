'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import {
  ACOES_DO_MENU_DA_TAREFA, ROTULO_DA_ACAO_DA_TAREFA, TRAB_DIAS_NA_LIXEIRA, ehAListaDoComercial, linkDaTarefa, listaDaImplantacao, pastasComAsDoComercial, razaoParaNaoFazer,
  type AcaoDoMenuDaTarefa, type EstadoParaOMenu, type TrabEstrutura, type TrabListaDto, type TrabTarefaDetalhe,
  type TrabTarefaLista, type TrabTarefaMesclada, type TrabTarefaDuplicada,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { HistoricoDaEntidade } from '@/components/historico/HistoricoDaEntidade';

/*
 * O MENU DA TAREFA (rodada de produção 3, I4, 22/10/2026).
 *
 * Um componente só, em toda tarefa do OS: botão direito no cartão ou na linha, o
 * "⋯" do cartão (toque e teclado) e Shift+F10 ou a tecla Menu com o foco na
 * tarefa. Ações: Renomear, Copiar ID, Mover para, Mesclar com outra, Duplicar,
 * Arquivar, Excluir (vai para a Lixeira), Compartilhar (copia o link `?tarefa=`) e,
 * desde a leva 5 (L2, 27/10/2026), Histórico: as entradas do AuditLog da tarefa
 * (quem, quando, antes e depois), em `HistoricoDaEntidade`. O histórico abre numa
 * janela própria e o menu fecha: quem guarda o estado é o dono do portal
 * (`useMenuDaTarefaProprio`), porque o painel do menu morre no clique fora.
 * O que a pessoa não pode fazer aparece desabilitado com a razão
 * (`razaoParaNaoFazer`, no shared). O menu abre por portal, sempre dentro da janela.
 *
 * Uso: a superfície envolve a sua lista com `MenuDaTarefaProvider` (que sabe
 * recarregar a tela), espalha `alvoDoMenu(menu, tarefa)` no cartão ou na linha e
 * põe `<BotaoDoMenuDaTarefa tarefa={…} />` onde o "⋯" cabe. Sem provedor, nada
 * aparece e nada quebra.
 */

export interface TarefaParaOMenu {
  id: string;
  title: string;
  listId?: string | null;
}

interface MenuAberto {
  tarefa: TarefaParaOMenu;
  x: number;
  y: number;
  /** Quem abriu: o foco volta para ele ao fechar. */
  origem: HTMLElement | null;
}

export interface ContextoDoMenu {
  abrir: (tarefa: TarefaParaOMenu, ponto: { x: number; y: number }, origem: HTMLElement | null) => void;
}

const Contexto = createContext<ContextoDoMenu | null>(null);

/** O menu desta superfície, ou nulo fora de um provedor. */
export function useMenuDaTarefa(): ContextoDoMenu | null {
  return useContext(Contexto);
}

/** Os manipuladores do cartão ou da linha: botão direito, tecla Menu e Shift+F10. */
export function alvoDoMenu(menu: ContextoDoMenu | null, tarefa: TarefaParaOMenu): {
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  if (!menu) return {};
  const pelaTecla = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    menu.abrir(tarefa, { x: r.left + 8, y: r.top + Math.min(r.height, 24) }, el);
  };
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Teclado (tecla Menu) dispara `contextmenu` sem coordenada: abre junto do elemento.
      if (e.clientX === 0 && e.clientY === 0) pelaTecla(e.currentTarget);
      else menu.abrir(tarefa, { x: e.clientX, y: e.clientY }, e.currentTarget);
    },
    onKeyDown: (e) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        e.stopPropagation();
        pelaTecla(e.target instanceof HTMLElement ? e.target : e.currentTarget);
      }
    },
  };
}

/** O "⋯" da tarefa (toque e teclado). */
export function BotaoDoMenuDaTarefa({ tarefa, className = '', menu: doDono }: {
  tarefa: TarefaParaOMenu; className?: string;
  /** O menu de quem não está dentro de um provedor (`useMenuDaTarefaProprio`). */
  menu?: ContextoDoMenu | null;
}) {
  const doContexto = useMenuDaTarefa();
  const menu = doDono ?? doContexto;
  if (!menu) return null;
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={`Ações da tarefa ${tarefa.title}`}
      title="Ações da tarefa"
      data-testid={`menu-da-tarefa-botao-${tarefa.id}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        menu.abrir(tarefa, { x: r.left, y: r.bottom + 2 }, e.currentTarget);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`relative z-10 grid shrink-0 place-items-center rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand max-md:min-h-[32px] max-md:min-w-[32px] ${className}`}
    >
      <MoreHorizontal size={14} />
    </button>
  );
}

/**
 * Onde o menu cabe: abre à direita e para baixo do ponto; sem espaço, vira para a
 * esquerda ou para cima; nunca sai da janela (margem de 8 px).
 */
export function posicaoDentroDaJanela(
  ponto: { x: number; y: number }, tamanho: { largura: number; altura: number }, janela: { largura: number; altura: number }, margem = 8,
): { left: number; top: number } {
  let left = ponto.x;
  let top = ponto.y;
  if (left + tamanho.largura + margem > janela.largura) left = ponto.x - tamanho.largura;
  if (top + tamanho.altura + margem > janela.altura) top = ponto.y - tamanho.altura;
  left = Math.max(margem, Math.min(left, janela.largura - tamanho.largura - margem));
  top = Math.max(margem, Math.min(top, janela.altura - tamanho.altura - margem));
  return { left, top };
}

const PAPEIS_DE_MAQUINA = ['ia_servico', 'ia_acao'];

interface OpcoesDoMenu {
  /** Recarrega a tela depois de uma ação que mudou a tarefa (ou criou outra). */
  onMudou: () => void;
  onErro?: (m: string) => void;
  /** Abre uma tarefa (a cópia, a destino da mesclagem). */
  onAbrir?: (id: string) => void;
}

/**
 * O menu de uma superfície SEM provedor acima (quem já é o componente da tela): devolve o
 * `menu` para `alvoDoMenu` e `<MenuDaTarefaProvider valor={menu}>` e o `elemento` (o portal).
 */
export function useMenuDaTarefaProprio({ onMudou, onErro, onAbrir }: OpcoesDoMenu): { menu: ContextoDoMenu; elemento: React.ReactNode } {
  const [aberto, setAberto] = useState<MenuAberto | null>(null);
  // L2: a tarefa cujo histórico está aberto. Vive aqui, e não no painel, para sobreviver ao menu fechar.
  const [historico, setHistorico] = useState<TarefaParaOMenu | null>(null);
  const abrir = useCallback<ContextoDoMenu['abrir']>((tarefa, ponto, origem) => setAberto({ tarefa, ...ponto, origem }), []);
  const menu = useMemo(() => ({ abrir }), [abrir]);
  const fechar = useCallback(() => {
    setAberto((a) => {
      const origem = a?.origem;
      if (origem?.isConnected) setTimeout(() => origem.focus(), 0);
      return null;
    });
  }, []);
  const fecharHistorico = useCallback(() => setHistorico(null), []);
  const elemento = typeof document !== 'undefined'
    ? (
      <>
        {aberto && createPortal(
          <PainelDoMenu key={`${aberto.tarefa.id}:${aberto.x}:${aberto.y}`} aberto={aberto} onFechar={fechar} onMudou={onMudou} onErro={onErro} onAbrir={onAbrir} onHistorico={setHistorico} />,
          document.body,
        )}
        {historico && (
          <HistoricoDaEntidade entityId={historico.id} entityType="work_task" titulo={historico.title} aberto onFechar={fecharHistorico} />
        )}
      </>
    )
    : null;
  return { menu, elemento };
}

/** Dá o menu a tudo o que está dentro (o "⋯" e `useMenuDaTarefa`). */
export function MenuDaTarefaProvider({ children, ...opcoes }: OpcoesDoMenu & { children: React.ReactNode }) {
  const { menu, elemento } = useMenuDaTarefaProprio(opcoes);
  return (
    <Contexto.Provider value={menu}>
      {children}
      {elemento}
    </Contexto.Provider>
  );
}

type Modo = 'menu' | 'renomear' | 'mover' | 'mesclar' | 'excluir';

function listasDaEstrutura(e: TrabEstrutura | null): { lista: TrabListaDto; rotulo: string }[] {
  if (!e) return [];
  return [
    ...e.folders.flatMap((f) => f.lists.map((l) => ({ lista: l, rotulo: `${f.name} / ${l.name}` }))),
    ...e.listasSoltas.map((l) => ({ lista: l, rotulo: l.name })),
  ];
}

function PainelDoMenu({ aberto, onFechar, onMudou, onErro, onAbrir, onHistorico }: {
  aberto: MenuAberto; onFechar: () => void; onMudou: () => void; onErro?: (m: string) => void; onAbrir?: (id: string) => void;
  /** L2: abre o histórico da tarefa (a janela é do dono do portal; o menu fecha). */
  onHistorico?: (tarefa: TarefaParaOMenu) => void;
}) {
  const { token, can, user } = useAuth();
  const { tarefa } = aberto;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: aberto.x, top: aberto.y });
  const [modo, setModo] = useState<Modo>('menu');
  const [detalhe, setDetalhe] = useState<TrabTarefaDetalhe | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [comTrilho, setComTrilho] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  // O estado de agora: a versão (para escrever condicionado), arquivada, na Lixeira, com agente.
  useEffect(() => {
    let vivo = true;
    apiGet<TrabTarefaDetalhe>(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, token)
      .then((d) => { if (vivo) setDetalhe(d); })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      .then((e) => { if (vivo) setEstrutura(e); })
      .catch(() => undefined);
    apiGet<{ cardId: string | null }[]>(`/tenants/onboarding/trilhos?cardId=${encodeURIComponent(tarefa.id)}`, token)
      .then((l) => { if (vivo) setComTrilho(Array.isArray(l) && l.length > 0); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [tarefa.id, token]);

  // Sempre dentro da janela, medido depois de desenhar (e de novo quando o conteúdo muda de tamanho).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(posicaoDentroDaJanela({ x: aberto.x, y: aberto.y }, { largura: r.width, altura: r.height }, { largura: window.innerWidth, altura: window.innerHeight }));
  }, [aberto.x, aberto.y, modo, detalhe, erro, feito]);

  // Fecha no clique fora, no Esc e quando a janela rola ou muda de tamanho.
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onFechar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar(); } };
    const redimensionou = () => onFechar();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('resize', redimensionou);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('resize', redimensionou);
    };
  }, [onFechar]);

  // O foco entra no primeiro item.
  useEffect(() => {
    if (modo !== 'menu') return;
    const primeiro = ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    primeiro?.focus();
  }, [modo, detalhe]);

  const listaId = detalhe?.listId ?? tarefa.listId ?? null;
  const daImplantacao = estrutura ? listaDaImplantacao(pastasComAsDoComercial(estrutura))?.listaId ?? null : null;
  const estado: EstadoParaOMenu = {
    podeEditar: can('tarefas.editar'),
    ehGente: !(user?.roles ?? []).some((r) => PAPEIS_DE_MAQUINA.includes(r)),
    arquivada: !!detalhe?.archived,
    excluida: !!detalhe?.excluidaEm,
    cardDaImplantacao: comTrilho || (!!daImplantacao && listaId === daImplantacao && !detalhe?.parentId),
    comAgente: !!detalhe?.agenteId,
  };
  const precisaDeVersao = (a: AcaoDoMenuDaTarefa) => !['copiar-id', 'compartilhar', 'historico'].includes(a);

  const concluir = (mensagem: string, abrirId?: string) => {
    setFeito(mensagem);
    onMudou();
    if (abrirId) onAbrir?.(abrirId);
    setTimeout(onFechar, 900);
  };
  const falhar = (e: unknown) => { const m = (e as Error).message; setErro(m); onErro?.(m); };
  const executar = async (fn: () => Promise<void>) => {
    setOcupado(true); setErro(null);
    try { await fn(); } catch (e) { falhar(e); } finally { setOcupado(false); }
  };

  const copiar = async (texto: string, mensagem: string) => {
    try { await navigator.clipboard.writeText(texto); setFeito(mensagem); setTimeout(onFechar, 900); }
    catch { setErro('Não foi possível copiar. Copie à mão: ' + texto); }
  };

  const escolher = (acao: AcaoDoMenuDaTarefa) => {
    if (razaoParaNaoFazer(acao, estado) || ocupado) return;
    if (precisaDeVersao(acao) && !detalhe) return;
    switch (acao) {
      case 'copiar-id': void copiar(tarefa.id, 'ID copiado.'); return;
      case 'compartilhar': void copiar(linkDaTarefa(window.location.origin, { id: tarefa.id, listId: listaId }), 'Link copiado.'); return;
      // L2: o histórico abre na janela própria; o menu sai do caminho.
      case 'historico': onHistorico?.({ id: tarefa.id, title: detalhe?.title ?? tarefa.title, listId: listaId }); onFechar(); return;
      case 'renomear': case 'mover': case 'mesclar': case 'excluir': setModo(acao); return;
      case 'duplicar':
        void executar(async () => {
          const r = await apiPost<TrabTarefaDuplicada>(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}/duplicar`, {}, token);
          concluir(`Cópia criada: ${r.title}.`);
        });
        return;
      case 'arquivar':
        void executar(async () => {
          await apiDelete(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, token, { expectedUpdatedAt: detalhe!.updatedAt });
          concluir('Tarefa arquivada. Ela volta pela Lixeira.');
        });
    }
  };

  const teclasDoMenu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (modo !== 'menu') return;
    const itens = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const ir = (n: number) => { e.preventDefault(); itens[(n + itens.length) % itens.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(itens.length - 1);
    else if (e.key === 'Tab') onFechar();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Ações da tarefa ${tarefa.title}`}
      data-testid="menu-da-tarefa"
      onKeyDown={teclasDoMenu}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 16px)' }}
      className="com-tema z-[70] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-border bg-surface p-1 text-[13px] text-text shadow-2xl"
    >
      {modo === 'menu' && (
        <>
          <p className="truncate px-2 py-1 text-[11px] text-muted" title={tarefa.title}>{tarefa.title}</p>
          {ACOES_DO_MENU_DA_TAREFA.map((acao) => {
            const razao = razaoParaNaoFazer(acao, estado) ?? (precisaDeVersao(acao) && !detalhe ? (erro ? 'A tarefa não pôde ser lida agora.' : 'Lendo a tarefa…') : null);
            return (
              <div
                key={acao}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={razao ? true : undefined}
                data-testid={`menu-da-tarefa-${acao}`}
                onClick={() => escolher(acao)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(acao); } }}
                className={`cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-surface-2 ${razao ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-2'} ${acao === 'excluir' && !razao ? 'text-bad' : ''}`}
              >
                <span className="block">{ROTULO_DA_ACAO_DA_TAREFA[acao]}</span>
                {razao && <span className="block break-words text-[11px] text-muted" data-testid={`menu-da-tarefa-${acao}-razao`}>{razao}</span>}
              </div>
            );
          })}
        </>
      )}
      {modo === 'renomear' && detalhe && (
        <Renomear detalhe={detalhe} ocupado={ocupado} onCancelar={() => setModo('menu')} onSalvar={(titulo) => executar(async () => {
          await apiPatch(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, { title: titulo, expectedUpdatedAt: detalhe.updatedAt }, token);
          concluir('Tarefa renomeada.');
        })} />
      )}
      {modo === 'mover' && detalhe && (
        <MoverPara
          detalhe={detalhe} estrutura={estrutura} daImplantacao={daImplantacao} ocupado={ocupado} onCancelar={() => setModo('menu')}
          onMover={(listId, statusId) => executar(async () => {
            await apiPost(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}/mover`, { listId, statusId, expectedUpdatedAt: detalhe.updatedAt }, token);
            concluir('Tarefa movida.');
          })}
        />
      )}
      {modo === 'mesclar' && detalhe && (
        <MesclarCom
          detalhe={detalhe} token={token} ocupado={ocupado} onCancelar={() => setModo('menu')}
          onMesclar={(destino) => executar(async () => {
            const r = await apiPost<TrabTarefaMesclada>(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}/mesclar`, { destinoId: destino.id, expectedUpdatedAt: detalhe.updatedAt }, token);
            concluir(`Mesclada em ${destino.title}: ${r.comentarios} comentário(s), ${r.anexos} anexo(s) e ${r.subtarefas} subtarefa(s) foram junto. A original ficou arquivada.`);
          })}
        />
      )}
      {modo === 'excluir' && detalhe && (
        <div className="space-y-2 p-2" data-testid="menu-da-tarefa-confirmar-excluir">
          <p>Mandar <strong className="break-words">{detalhe.title}</strong> para a Lixeira?</p>
          <p className="text-[12px] text-muted">Ela some do Trabalho e fica na Lixeira por {TRAB_DIAS_NA_LIXEIRA} dias. Dá para restaurar.</p>
          <div className="flex gap-2">
            <button type="button" autoFocus disabled={ocupado} data-testid="menu-da-tarefa-excluir-confirmar"
              onClick={() => executar(async () => {
                await apiPost(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}/excluir`, { expectedUpdatedAt: detalhe.updatedAt }, token);
                concluir('Tarefa enviada para a Lixeira.');
              })}
              className="rounded bg-bad/15 px-2.5 py-1 text-bad hover:bg-bad/25 disabled:opacity-50">Excluir</button>
            <button type="button" onClick={() => setModo('menu')} className="rounded border border-border px-2.5 py-1 text-muted hover:text-text">Cancelar</button>
          </div>
        </div>
      )}
      {feito && <p role="status" data-testid="menu-da-tarefa-feito" className="px-2 py-1 text-[12px] text-brand">{feito}</p>}
      {erro && <p role="alert" data-testid="menu-da-tarefa-erro" className="break-words px-2 py-1 text-[12px] text-bad">{erro}</p>}
    </div>
  );
}

function Renomear({ detalhe, ocupado, onCancelar, onSalvar }: { detalhe: TrabTarefaDetalhe; ocupado: boolean; onCancelar: () => void; onSalvar: (t: string) => void }) {
  const [titulo, setTitulo] = useState(detalhe.title);
  const salvar = () => { const t = titulo.trim(); if (t && t !== detalhe.title) onSalvar(t); else onCancelar(); };
  return (
    <form className="space-y-2 p-2" onSubmit={(e) => { e.preventDefault(); salvar(); }} data-testid="menu-da-tarefa-renomear-form">
      <label className="block text-[11px] text-muted" htmlFor="menu-da-tarefa-titulo">Novo nome</label>
      <input id="menu-da-tarefa-titulo" autoFocus value={titulo} maxLength={300} onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancelar(); } }}
        className="w-full rounded border border-border bg-surface-2 px-2 py-1 outline-none focus:border-brand-dim" />
      <div className="flex gap-2">
        <button type="submit" disabled={ocupado || !titulo.trim()} className="rounded bg-brand/15 px-2.5 py-1 text-brand hover:bg-brand/25 disabled:opacity-50">Salvar</button>
        <button type="button" onClick={onCancelar} className="rounded border border-border px-2.5 py-1 text-muted hover:text-text">Cancelar</button>
      </div>
    </form>
  );
}

function MoverPara({ detalhe, estrutura, daImplantacao, ocupado, onCancelar, onMover }: {
  detalhe: TrabTarefaDetalhe; estrutura: TrabEstrutura | null; daImplantacao: string | null; ocupado: boolean;
  onCancelar: () => void; onMover: (listId: string, statusId: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [escolhida, setEscolhida] = useState<string | null>(null);
  // As listas que recebem: de tarefas, fora da implantação (porta única), além da atual.
  // Layout 26/10: a lista do comercial (agora na árvore) só recebe tarefa criada nela.
  const opcoes = listasDaEstrutura(estrutura).filter(({ lista }) =>
    lista.id === detalhe.listId || (lista.natureza !== 'cadastro' && !ehAListaDoComercial(lista) && (lista.id !== daImplantacao || !!detalhe.parentId)));
  const visiveis = opcoes.filter((o) => !busca.trim() || o.rotulo.toLowerCase().includes(busca.trim().toLowerCase()));
  const lista = opcoes.find((o) => o.lista.id === escolhida)?.lista ?? null;
  if (!estrutura) return <p className="p-2 text-muted">Carregando as listas…</p>;
  return (
    <div className="space-y-1.5 p-1.5" data-testid="menu-da-tarefa-mover-form">
      {!lista ? (
        <>
          <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lista…" aria-label="Buscar lista"
            className="w-full rounded border border-border bg-surface-2 px-2 py-1 outline-none focus:border-brand-dim" />
          <ul className="max-h-60 overflow-y-auto">
            {visiveis.map(({ lista: l, rotulo }) => (
              <li key={l.id}>
                <button type="button" onClick={() => setEscolhida(l.id)} data-testid={`menu-da-tarefa-mover-lista-${l.id}`}
                  className="w-full break-words rounded px-2 py-1 text-left hover:bg-surface-2">
                  {rotulo}{l.id === detalhe.listId ? ' (atual)' : ''}
                </button>
              </li>
            ))}
            {visiveis.length === 0 && <li className="px-2 py-1 text-muted">Nenhuma lista com esse nome.</li>}
          </ul>
        </>
      ) : (
        <>
          <p className="px-1 text-[11px] text-muted">Etapa em {lista.name}</p>
          <ul className="max-h-60 overflow-y-auto">
            {lista.statuses.map((s) => (
              <li key={s.id}>
                <button type="button" disabled={ocupado || (lista.id === detalhe.listId && s.id === detalhe.statusId)} onClick={() => onMover(lista.id, s.id)}
                  data-testid={`menu-da-tarefa-mover-etapa-${s.id}`}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface-2 disabled:opacity-50">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />{s.name}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setEscolhida(null)} className="px-2 text-[12px] text-muted underline">outra lista</button>
        </>
      )}
      <button type="button" onClick={onCancelar} className="px-2 text-[12px] text-muted underline">voltar</button>
    </div>
  );
}

function MesclarCom({ detalhe, token, ocupado, onCancelar, onMesclar }: {
  detalhe: TrabTarefaDetalhe; token: string | null; ocupado: boolean;
  onCancelar: () => void; onMesclar: (destino: { id: string; title: string }) => void;
}) {
  const [busca, setBusca] = useState('');
  const [achadas, setAchadas] = useState<{ id: string; title: string; listName?: string }[] | null>(null);
  const [destino, setDestino] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) { setAchadas(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      apiGet<TrabTarefaLista>(`/trabalho/tarefas?q=${encodeURIComponent(q)}&limit=20`, token)
        .then((r) => { if (vivo) setAchadas((r.items ?? []).filter((x) => x.id !== detalhe.id).map((x) => ({ id: x.id, title: x.title, listName: x.listName }))); })
        .catch(() => { if (vivo) setAchadas([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, token, detalhe.id]);
  return (
    <div className="space-y-1.5 p-1.5" data-testid="menu-da-tarefa-mesclar-form">
      {!destino ? (
        <>
          <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar a tarefa que recebe…" aria-label="Buscar a tarefa que recebe"
            className="w-full rounded border border-border bg-surface-2 px-2 py-1 outline-none focus:border-brand-dim" />
          <ul className="max-h-60 overflow-y-auto">
            {(achadas ?? []).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setDestino(a)} data-testid={`menu-da-tarefa-mesclar-com-${a.id}`} className="w-full break-words rounded px-2 py-1 text-left hover:bg-surface-2">
                  {a.title}{a.listName ? <span className="text-[11px] text-muted"> · {a.listName}</span> : null}
                </button>
              </li>
            ))}
            {achadas && achadas.length === 0 && <li className="px-2 py-1 text-muted">Nenhuma tarefa com esse nome.</li>}
            {!achadas && <li className="px-2 py-1 text-[12px] text-muted">Escreva ao menos duas letras.</li>}
          </ul>
        </>
      ) : (
        <div className="space-y-2 p-1">
          <p>Mesclar <strong className="break-words">{detalhe.title}</strong> em <strong className="break-words">{destino.title}</strong>?</p>
          <p className="text-[12px] text-muted">Comentários, anexos, subtarefas, etiquetas e campos vão para a outra. Esta fica arquivada, com o link. Nada é apagado.</p>
          <div className="flex gap-2">
            <button type="button" autoFocus disabled={ocupado} onClick={() => onMesclar(destino)} data-testid="menu-da-tarefa-mesclar-confirmar"
              className="rounded bg-brand/15 px-2.5 py-1 text-brand hover:bg-brand/25 disabled:opacity-50">Mesclar</button>
            <button type="button" onClick={() => setDestino(null)} className="rounded border border-border px-2.5 py-1 text-muted hover:text-text">Outra tarefa</button>
          </div>
        </div>
      )}
      <button type="button" onClick={onCancelar} className="px-2 text-[12px] text-muted underline">voltar</button>
    </div>
  );
}
