'use client';

/*
 * O MENU DO LEAD (leva 5, L2, 27/10/2026): o botão direito no card do lead.
 *
 * Um componente só para o funil (quadro e lista), a lista de leads e as
 * propostas: botão direito no cartão ou na linha, o "⋯" (toque e teclado) e
 * Shift+F10 ou a tecla Menu com o foco no lead. Ações: abrir (o painel na
 * Geral), mover de etapa (todas as etapas; a saída pede o motivo; E8 e E9 pedem
 * a confirmação com o aviso da regra), copiar link da sala (só gente, pela rota
 * que já existe: o link sai só na resposta e vai à área de transferência, com o
 * campo para copiar à mão quando o navegador não deixa), vincular WhatsApp (o
 * painel na Geral, no campo WhatsApp), editar valor negociado (idem, no campo) e
 * ver histórico (o AuditLog do lead, `HistoricoDaEntidade`).
 *
 * Mesmo padrão do `MenuDaTarefa`: portal fixo na janela, sempre dentro dela;
 * fecha no clique fora, no Esc, ao redimensionar e, na rolagem, SÓ se quem o
 * abriu mudou de lugar (a rolagem que trouxe o botão chega depois do clique).
 * As ações passam pelas mesmas rotas e proteções de sempre; nada novo na API.
 *
 * Uso: a superfície envolve a lista com `MenuDoLeadProvider` (que sabe o que
 * fazer quando um lead foi movido e quando a tela precisa reler), espalha
 * `alvoDoMenuDoLead(menu, lead)` no cartão ou na linha e põe
 * `<BotaoDoMenuDoLead lead={…} />` onde o "⋯" cabe. Quem já é o componente da
 * tela usa `useMenuDoLeadProprio`. Sem provedor, nada aparece e nada quebra.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  destinoDoMover,
  type ComercialDestinoDoMover,
  type ComercialEtapa,
  type ComercialEtapaAtiva,
  type ComercialMoverInput,
  type ComercialResultadoDoMover,
  type LinkDaSalaCopiado,
} from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { posicaoDentroDaJanela } from '@/components/trabalho/MenuDaTarefa';

import { HistoricoDaEntidade, TIPO_DA_ENTIDADE_DO_LEAD } from '../_painel/historico';
import { usePainel } from '../_painel/provedor';
import { avisoDaConfirmacao, fraseDoErro, moverCartao, precisaDeConfirmacao } from './mover';

export interface LeadParaOMenu {
  id: string;
  nome: string;
  empresa?: string | null;
  /** A etapa de agora, quando a superfície a sabe (o menu "mover" tira a atual da lista). */
  etapa?: ComercialEtapa | null;
  voltaPara?: ComercialEtapaAtiva | null;
}

export const ACOES_DO_MENU_DO_LEAD = ['abrir', 'mover', 'copiar-link-da-sala', 'vincular-whatsapp', 'editar-valor', 'historico'] as const;
export type AcaoDoMenuDoLead = (typeof ACOES_DO_MENU_DO_LEAD)[number];

export const ROTULO_DA_ACAO_DO_LEAD: Record<AcaoDoMenuDoLead, string> = {
  abrir: 'Abrir',
  mover: 'Mover de etapa',
  'copiar-link-da-sala': 'Copiar link da sala',
  'vincular-whatsapp': 'Vincular WhatsApp',
  'editar-valor': 'Editar valor negociado',
  historico: 'Histórico',
};

const PAPEIS_DE_MAQUINA = ['ia_servico', 'ia_acao'];

/** Por que a pessoa não pode fazer a ação agora (nulo = pode). Puro, para a suíte. */
export function razaoParaNaoFazerNoLead(acao: AcaoDoMenuDoLead, estado: { podeEditar: boolean; ehGente: boolean }): string | null {
  if (acao === 'abrir' || acao === 'historico') return null;
  if (!estado.ehGente) return 'Conta de serviço (IA) não faz isto: é de gente.';
  if (!estado.podeEditar) return 'Pede a permissão leads.editar.';
  return null;
}

/** O "mover" do menu: todas as etapas e saídas, menos a de agora (quando se sabe qual é). */
export function destinosDoMenuDoLead(lead: Pick<LeadParaOMenu, 'etapa' | 'voltaPara'>): ComercialDestinoDoMover[] {
  const de = lead.etapa ?? null;
  return [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS]
    .filter((e) => e !== de)
    .map((e) => (de ? destinoDoMover(de, e, lead.voltaPara ?? null) : { para: e, permitido: true, caminho: (COMERCIAL_SAIDAS as readonly string[]).includes(e) ? 'saida' : 'mover', motivo: null, pendencias: [], dica: null }));
}

interface MenuAberto {
  lead: LeadParaOMenu;
  x: number;
  y: number;
  /** Quem abriu: o foco volta para ele ao fechar; a rolagem só fecha se ele mudou de lugar. */
  origem: HTMLElement | null;
}

export interface ContextoDoMenuDoLead {
  abrir: (lead: LeadParaOMenu, ponto: { x: number; y: number }, origem: HTMLElement | null) => void;
}

const Contexto = createContext<ContextoDoMenuDoLead | null>(null);

/** O menu desta superfície, ou nulo fora de um provedor. */
export function useMenuDoLead(): ContextoDoMenuDoLead | null {
  return useContext(Contexto);
}

/** Os manipuladores do cartão ou da linha: botão direito, tecla Menu e Shift+F10. */
export function alvoDoMenuDoLead(menu: ContextoDoMenuDoLead | null, lead: LeadParaOMenu): {
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  if (!menu) return {};
  const pelaTecla = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    menu.abrir(lead, { x: r.left + 8, y: r.top + Math.min(r.height, 24) }, el);
  };
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Teclado (tecla Menu) dispara `contextmenu` sem coordenada: abre junto do elemento.
      if (e.clientX === 0 && e.clientY === 0) pelaTecla(e.currentTarget);
      else menu.abrir(lead, { x: e.clientX, y: e.clientY }, e.currentTarget);
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

/** O "⋯" do lead (toque e teclado). */
export function BotaoDoMenuDoLead({ lead, className = '', menu: doDono }: { lead: LeadParaOMenu; className?: string; menu?: ContextoDoMenuDoLead | null }) {
  const doContexto = useMenuDoLead();
  const menu = doDono ?? doContexto;
  if (!menu) return null;
  const nome = lead.empresa || lead.nome;
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={`Ações do lead ${nome}`}
      title="Ações do lead"
      data-testid={`menu-do-lead-botao-${lead.id}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        menu.abrir(lead, { x: r.left, y: r.bottom + 2 }, e.currentTarget);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`relative z-10 grid shrink-0 place-items-center rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand max-md:min-h-[32px] max-md:min-w-[32px] ${className}`}
    >
      <MoreHorizontal size={14} />
    </button>
  );
}

interface OpcoesDoMenu {
  /** O lead mudou de etapa pelo menu: a superfície atualiza o cartão na hora (L5) ou relê. */
  onMovido?: (leadId: string, resultado: ComercialResultadoDoMover) => void;
  /** Recarrega a tela depois de uma ação que mudou o lead. */
  onMudou?: () => void;
  onErro?: (m: string) => void;
}

/**
 * O menu de uma superfície SEM provedor acima (quem já é o componente da tela): devolve o
 * `menu` para `alvoDoMenuDoLead` e `<MenuDoLeadProvider valor={menu}>` e o `elemento` (o portal,
 * com o Histórico quando aberto).
 */
export function useMenuDoLeadProprio(opcoes: OpcoesDoMenu): { menu: ContextoDoMenuDoLead; elemento: React.ReactNode } {
  const [aberto, setAberto] = useState<MenuAberto | null>(null);
  // O Histórico abre numa janela própria e o menu fecha: quem guarda o estado é o dono do portal.
  const [historico, setHistorico] = useState<LeadParaOMenu | null>(null);
  const abrir = useCallback<ContextoDoMenuDoLead['abrir']>((lead, ponto, origem) => setAberto({ lead, ...ponto, origem }), []);
  const menu = useMemo(() => ({ abrir }), [abrir]);
  const fechar = useCallback(() => {
    setAberto((a) => {
      const origem = a?.origem;
      if (origem?.isConnected) setTimeout(() => origem.focus(), 0);
      return null;
    });
  }, []);
  const elemento =
    typeof document !== 'undefined' ? (
      <>
        {aberto && createPortal(<PainelDoMenu key={`${aberto.lead.id}:${aberto.x}:${aberto.y}`} aberto={aberto} onFechar={fechar} onHistorico={(l) => setHistorico(l)} {...opcoes} />, document.body)}
        {historico && (
          <HistoricoDaEntidade entityId={historico.id} entityType={TIPO_DA_ENTIDADE_DO_LEAD} titulo={`Histórico de ${historico.empresa || historico.nome}`} aberto onFechar={() => setHistorico(null)} />
        )}
      </>
    ) : null;
  return { menu, elemento };
}

/** Dá o menu a tudo o que está dentro (o "⋯" e `useMenuDoLead`). */
export function MenuDoLeadProvider({ children, ...opcoes }: OpcoesDoMenu & { children: React.ReactNode }) {
  const { menu, elemento } = useMenuDoLeadProprio(opcoes);
  return (
    <Contexto.Provider value={menu}>
      {children}
      {elemento}
    </Contexto.Provider>
  );
}

type Modo = 'menu' | 'mover' | 'saida' | 'confirmar';

function PainelDoMenu({ aberto, onFechar, onHistorico, onMovido, onMudou, onErro }: { aberto: MenuAberto; onFechar: () => void; onHistorico: (lead: LeadParaOMenu) => void } & OpcoesDoMenu) {
  const { token, can, user } = useAuth();
  const painel = usePainel();
  const { lead } = aberto;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: aberto.x, top: aberto.y });
  const [modo, setModo] = useState<Modo>('menu');
  const [destino, setDestino] = useState<ComercialDestinoDoMover | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const nome = lead.empresa || lead.nome;

  // Sempre dentro da janela, medido depois de desenhar (e de novo quando o conteúdo muda de tamanho).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(posicaoDentroDaJanela({ x: aberto.x, y: aberto.y }, { largura: r.width, altura: r.height }, { largura: window.innerWidth, altura: window.innerHeight }));
  }, [aberto.x, aberto.y, modo, erro, feito, manual]);

  // Fecha no clique fora, no Esc, ao redimensionar e, na rolagem, só se quem abriu mudou de lugar.
  useEffect(() => {
    const ondeEstava = aberto.origem?.getBoundingClientRect();
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onFechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onFechar();
      }
    };
    const redimensionou = () => onFechar();
    const rolou = () => {
      if (!aberto.origem || !ondeEstava) return;
      const agora = aberto.origem.getBoundingClientRect();
      if (Math.abs(agora.top - ondeEstava.top) > 2 || Math.abs(agora.left - ondeEstava.left) > 2) onFechar();
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla, true);
    window.addEventListener('resize', redimensionou);
    window.addEventListener('scroll', rolou, true);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla, true);
      window.removeEventListener('resize', redimensionou);
      window.removeEventListener('scroll', rolou, true);
    };
  }, [onFechar, aberto.origem]);

  // O foco entra no primeiro item.
  useEffect(() => {
    if (modo !== 'menu' && modo !== 'mover') return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [modo]);

  const estado = { podeEditar: can('leads.editar'), ehGente: !(user?.roles ?? []).some((r) => PAPEIS_DE_MAQUINA.includes(r)) };

  const concluir = (mensagem: string) => {
    setFeito(mensagem);
    setTimeout(onFechar, 900);
  };
  const falhar = (e: unknown) => {
    const m = fraseDoErro(e);
    setErro(m);
    onErro?.(m);
  };

  async function mover(d: ComercialDestinoDoMover, motivoDaSaida?: string) {
    setOcupado(true);
    setErro(null);
    try {
      const corpo: ComercialMoverInput = { para: d.para, ...(motivoDaSaida ? { motivo: motivoDaSaida } : {}) };
      const r = await moverCartao(lead.id, corpo, token);
      onMovido?.(lead.id, r);
      onMudou?.();
      concluir(r.mensagem || `Movido para ${COMERCIAL_ROTULO_DA_ETAPA[r.para]}.`);
    } catch (e) {
      falhar(e);
    } finally {
      setOcupado(false);
    }
  }

  function escolherDestino(d: ComercialDestinoDoMover) {
    if (!d.permitido || ocupado) return;
    setDestino(d);
    if (d.caminho === 'saida') setModo('saida');
    else if (precisaDeConfirmacao(d)) setModo('confirmar');
    else void mover(d);
  }

  async function copiarLinkDaSala() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await apiPost<LinkDaSalaCopiado>(`/comercial/lead/${encodeURIComponent(lead.id)}/sala/link`, {}, token);
      try {
        await navigator.clipboard.writeText(r.link);
        concluir('Link da sala copiado.');
      } catch {
        // Sem área de transferência (navegador sem permissão): o link aparece para copiar à mão.
        setManual(r.link);
      }
    } catch (e) {
      falhar(e);
    } finally {
      setOcupado(false);
    }
  }

  const escolher = (acao: AcaoDoMenuDoLead) => {
    if (razaoParaNaoFazerNoLead(acao, estado) || ocupado) return;
    switch (acao) {
      case 'abrir':
        onFechar();
        painel.abrir(lead.id, 'geral', aberto.origem);
        return;
      case 'mover':
        setModo('mover');
        return;
      case 'copiar-link-da-sala':
        void copiarLinkDaSala();
        return;
      case 'vincular-whatsapp':
        onFechar();
        painel.abrir(lead.id, 'geral', aberto.origem, 'whatsapp');
        return;
      case 'editar-valor':
        onFechar();
        painel.abrir(lead.id, 'geral', aberto.origem, 'valorNegociado');
        return;
      case 'historico':
        onFechar();
        onHistorico(lead);
    }
  };

  const teclasDoMenu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (modo !== 'menu' && modo !== 'mover') return;
    const itens = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const ir = (n: number) => {
      e.preventDefault();
      itens[(n + itens.length) % itens.length]?.focus();
    };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(itens.length - 1);
    else if (e.key === 'Tab') onFechar();
  };

  const item = (chave: string, rotulo: React.ReactNode, aoClicar: () => void, razao: string | null = null, extra = '') => (
    <div
      key={chave}
      role="menuitem"
      tabIndex={-1}
      aria-disabled={razao ? true : undefined}
      data-testid={`menu-do-lead-${chave}`}
      onClick={aoClicar}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoClicar();
        }
      }}
      className={`cursor-pointer rounded px-2 py-1.5 outline-none focus:bg-surface-2 ${razao ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-2'} ${extra}`}
    >
      <span className="block">{rotulo}</span>
      {razao && <span className="block break-words text-[11px] text-muted" data-testid={`menu-do-lead-${chave}-razao`}>{razao}</span>}
    </div>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Ações do lead ${nome}`}
      data-testid="menu-do-lead"
      onKeyDown={teclasDoMenu}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 16px)' }}
      className="com-tema z-[70] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-border bg-surface p-1 text-[13px] text-text shadow-2xl"
    >
      {modo === 'menu' && (
        <>
          <p className="truncate px-2 py-1 text-[11px] text-muted" title={nome}>{nome}</p>
          {ACOES_DO_MENU_DO_LEAD.map((acao) => item(acao, ROTULO_DA_ACAO_DO_LEAD[acao], () => escolher(acao), razaoParaNaoFazerNoLead(acao, estado)))}
        </>
      )}
      {modo === 'mover' && (
        <>
          <p className="px-2 py-1 font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">mover para</p>
          {destinosDoMenuDoLead(lead).map((d) =>
            item(
              `mover-para-${d.para}`,
              <>
                {COMERCIAL_ROTULO_DA_ETAPA[d.para]}
                {d.caminho === 'saida' && <span className="text-dim"> · pede motivo</span>}
                {d.dica && <span className="mt-0.5 block text-[11px] leading-snug text-dim">{d.dica}</span>}
              </>,
              () => escolherDestino(d),
              d.permitido ? null : d.motivo,
            ),
          )}
          <button type="button" onClick={() => setModo('menu')} className="px-2 py-1 text-[12px] text-muted underline">voltar</button>
        </>
      )}
      {modo === 'saida' && destino && (
        <form
          className="space-y-2 p-2"
          data-testid="menu-do-lead-saida-form"
          onSubmit={(e) => {
            e.preventDefault();
            void mover(destino, motivo.trim() || undefined);
          }}
        >
          <p>Mover <strong className="break-words">{nome}</strong> para {COMERCIAL_ROTULO_DA_ETAPA[destino.para]}?</p>
          <label className="block text-[11px] text-muted">
            motivo
            <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={400} placeholder="escreva o motivo" data-testid="menu-do-lead-saida-motivo"
              className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1 text-[13px] text-text outline-none focus:border-brand-dim" />
          </label>
          <p className="text-[11px] text-dim">Sem motivo escrito, fica &quot;sem motivo informado&quot; e o cartão ganha o aviso.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={ocupado} className="rounded bg-brand/15 px-2.5 py-1 text-brand hover:bg-brand/25 disabled:opacity-50">mover para a saída</button>
            <button type="button" onClick={() => setModo('mover')} className="rounded border border-border px-2.5 py-1 text-muted hover:text-text">voltar</button>
          </div>
        </form>
      )}
      {modo === 'confirmar' && destino && (
        <div className="space-y-2 p-2" data-testid="menu-do-lead-confirmar">
          <p>Mover <strong className="break-words">{nome}</strong> para {COMERCIAL_ROTULO_DA_ETAPA[destino.para]}?</p>
          <p className="text-[12px] text-warn">{avisoDaConfirmacao(destino)}</p>
          <div className="flex gap-2">
            <button type="button" autoFocus disabled={ocupado} data-testid="menu-do-lead-confirmar-mover" onClick={() => void mover(destino)} className="rounded bg-brand/15 px-2.5 py-1 text-brand hover:bg-brand/25 disabled:opacity-50">
              mover mesmo assim
            </button>
            <button type="button" onClick={() => setModo('mover')} className="rounded border border-border px-2.5 py-1 text-muted hover:text-text">voltar</button>
          </div>
        </div>
      )}
      {manual && (
        <label className="block px-2 py-1 text-[11px] text-muted">
          Copie o link à mão:
          <input className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1 text-[12px] text-text" readOnly value={manual} onFocus={(e) => e.currentTarget.select()} data-testid="menu-do-lead-link-manual" />
        </label>
      )}
      {feito && <p role="status" data-testid="menu-do-lead-feito" className="px-2 py-1 text-[12px] text-brand">{feito}</p>}
      {erro && <p role="alert" data-testid="menu-do-lead-erro" className="break-words px-2 py-1 text-[12px] text-bad">{erro}</p>}
    </div>
  );
}
