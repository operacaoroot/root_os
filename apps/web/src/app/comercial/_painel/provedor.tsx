'use client';

/*
 * O PROVEDOR DO PAINEL DO LEAD (lane UX, 13/10/2026).
 *
 * Mora no layout de /comercial e vale para todas as telas de lá (fila, funil,
 * contratos, torre, relatório, simulador). Guarda qual lead está aberto e em
 * que aba, sincronizado com a query da URL; abre, troca de aba e fecha sem
 * navegar (a tela de trás não remonta, então filtro, rolagem e seleção ficam).
 *
 * O histórico: abrir por clique empilha UMA entrada (o "voltar" do navegador
 * fecha o painel); trocar de aba substitui; fechar volta (`history.back()`)
 * quando o painel veio de um clique, senão só limpa a query. O Next sincroniza
 * `useSearchParams` com `pushState`/`replaceState` nativos (desde a 14.1).
 */
import { createPortal } from 'react-dom';
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { FOCO } from '../_ui';
import { lerPainel, urlComPainel, urlSemPainel, type AbaDoPainel, type EstadoDoPainel } from './estado';
import { LeadPainel } from './LeadPainel';

export interface AvisoDoCanto {
  id: number;
  texto: string;
  tom: 'bom' | 'neutro' | 'ruim';
}

export interface Painel {
  estado: EstadoDoPainel | null;
  /** Abre o painel do lead. `origem` é quem recebe o foco de volta ao fechar. */
  abrir: (leadId: string, aba?: AbaDoPainel, origem?: Element | null) => void;
  trocarAba: (aba: AbaDoPainel) => void;
  fechar: () => void;
  /** O aviso curto no canto (toast), com o texto da API. */
  avisar: (texto: string, tom?: AvisoDoCanto['tom']) => void;
  /** Sobe a cada ação feita no painel: a tela de trás relê a lista. */
  versao: number;
  mudou: () => void;
  /** A URL desta tela com o painel do lead aberto (para o `href` dos links). */
  hrefDoLead: (leadId: string, aba?: AbaDoPainel) => string;
}

function hrefPadrao(leadId: string, aba: AbaDoPainel = 'fio') {
  return `/comercial/funil?lead=${encodeURIComponent(leadId)}&aba=${aba}`;
}

// Fora do provedor (um teste que monta só a página), os links continuam
// funcionando como links comuns para a tela com o painel.
const SEM_PROVEDOR: Painel = {
  estado: null,
  abrir: (leadId, aba) => {
    if (typeof window !== 'undefined') window.location.assign(hrefPadrao(leadId, aba));
  },
  trocarAba: () => {},
  fechar: () => {},
  avisar: () => {},
  versao: 0,
  mudou: () => {},
  hrefDoLead: hrefPadrao,
};

const Contexto = createContext<Painel>(SEM_PROVEDOR);

export function usePainel(): Painel {
  return useContext(Contexto);
}

/** A tela de trás relê a lista quando algo muda no painel (sem piscar: o `useCarregar` mantém o que já tem). */
export function useMudouNoPainel(recarregar: () => void | Promise<void>) {
  const { versao } = usePainel();
  const primeira = useRef(true);
  const fn = useRef(recarregar);
  fn.current = recarregar;
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    void fn.current();
  }, [versao]);
}

function buscaAtual(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function caminhoAtual(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

export function ProvedorDoPainel({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoDoPainel | null>(null);
  const [versao, setVersao] = useState(0);
  const [avisos, setAvisos] = useState<AvisoDoCanto[]>([]);
  // Quem abriu (para devolver o foco) e se a entrada do histórico é nossa.
  const origem = useRef<Element | null>(null);
  const porClique = useRef(false);
  const proximoAviso = useRef(1);

  const sincronizar = useCallback(() => {
    const lido = lerPainel(buscaAtual());
    setEstado((antes) => {
      if (!lido) return null;
      if (antes && antes.leadId === lido.leadId && antes.aba === lido.aba) return antes;
      return lido;
    });
    if (!lido) porClique.current = false;
  }, []);

  // O voltar e o avançar do navegador abrem e fecham o painel.
  useEffect(() => {
    sincronizar();
    window.addEventListener('popstate', sincronizar);
    return () => window.removeEventListener('popstate', sincronizar);
  }, [sincronizar]);

  const abrir = useCallback<Painel['abrir']>((leadId, aba = 'fio', de) => {
    origem.current = de ?? (typeof document !== 'undefined' ? document.activeElement : null);
    const jaAberto = !!lerPainel(buscaAtual());
    const url = urlComPainel(caminhoAtual(), buscaAtual(), leadId, aba);
    if (jaAberto) {
      window.history.replaceState(window.history.state, '', url);
    } else {
      window.history.pushState(window.history.state, '', url);
      porClique.current = true;
    }
    setEstado({ leadId, aba });
  }, []);

  const trocarAba = useCallback<Painel['trocarAba']>((aba) => {
    const atual = lerPainel(buscaAtual());
    if (!atual) return;
    window.history.replaceState(window.history.state, '', urlComPainel(caminhoAtual(), buscaAtual(), atual.leadId, aba));
    setEstado({ leadId: atual.leadId, aba });
  }, []);

  const fechar = useCallback(() => {
    if (porClique.current) {
      porClique.current = false;
      setEstado(null);
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, '', urlSemPainel(caminhoAtual(), buscaAtual()));
    setEstado(null);
  }, []);

  const avisar = useCallback<Painel['avisar']>((texto, tom = 'bom') => {
    const id = proximoAviso.current++;
    setAvisos((l) => [...l.slice(-2), { id, texto, tom }]);
    window.setTimeout(() => setAvisos((l) => l.filter((a) => a.id !== id)), 6000);
  }, []);

  const mudou = useCallback(() => setVersao((v) => v + 1), []);

  const hrefDoLead = useCallback((leadId: string, aba: AbaDoPainel = 'fio') => {
    if (typeof window === 'undefined') return hrefPadrao(leadId, aba);
    return urlComPainel(caminhoAtual(), buscaAtual(), leadId, aba);
  }, []);

  const valor = useMemo<Painel>(
    () => ({ estado, abrir, trocarAba, fechar, avisar, versao, mudou, hrefDoLead }),
    [estado, abrir, trocarAba, fechar, avisar, versao, mudou, hrefDoLead],
  );

  // Fechou: o foco volta a quem abriu (ou ao conteúdo da tela, se quem abriu sumiu).
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (estado) {
      estavaAberto.current = true;
      return;
    }
    if (!estavaAberto.current) return;
    estavaAberto.current = false;
    const alvo = origem.current;
    origem.current = null;
    if (alvo instanceof HTMLElement && alvo.isConnected) alvo.focus();
    else document.getElementById('root-os-main')?.focus();
  }, [estado]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Suspense fallback={null}>
        <SincronizadorDaUrl aoMudar={sincronizar} />
      </Suspense>
      {estado && <LeadPainel key={estado.leadId} estado={estado} />}
      <AvisosNoCanto avisos={avisos} aoFechar={(id) => setAvisos((l) => l.filter((a) => a.id !== id))} />
    </Contexto.Provider>
  );
}

/**
 * A navegação do próprio Next (um link para `/comercial?lead=...` vindo de
 * outra tela, o redirecionamento das rotas antigas) não dispara `popstate`:
 * quem avisa é a query que o Next acompanha.
 */
function SincronizadorDaUrl({ aoMudar }: { aoMudar: () => void }) {
  const busca = useSearchParams();
  const caminho = usePathname();
  const chave = `${caminho}?${busca?.toString() ?? ''}`;
  useEffect(() => {
    aoMudar();
  }, [chave, aoMudar]);
  return null;
}

/** O aviso curto no canto: some sozinho, e a leitura de tela ouve. */
function AvisosNoCanto({ avisos, aoFechar }: { avisos: AvisoDoCanto[]; aoFechar: (id: number) => void }) {
  // No <body>, fora da árvore que o painel deixa inerte: o aviso continua audível com o painel aberto.
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  useEffect(() => setAlvo(document.body), []);
  if (!alvo) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-avisos-do-canto
      data-os-app
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-end gap-2 md:inset-x-auto md:right-4 md:w-[360px]"
    >
      {avisos.map((a) => (
        <div
          key={a.id}
          className={`pointer-events-auto flex w-full items-start gap-2 rounded border bg-surface px-3 py-2 text-[13px] shadow-lg motion-safe:animate-[aviso-entra_160ms_ease-out] ${
            a.tom === 'ruim' ? 'border-bad/50' : a.tom === 'bom' ? 'border-good/50' : 'border-border'
          }`}
        >
          <span aria-hidden className={a.tom === 'ruim' ? 'text-bad' : a.tom === 'bom' ? 'text-good' : 'text-muted'}>●</span>
          <p className="min-w-0 flex-1 break-words">{a.texto}</p>
          <button type="button" aria-label="dispensar aviso" onClick={() => aoFechar(a.id)} className={`shrink-0 rounded px-1 text-muted hover:text-text ${FOCO}`}>
            ×
          </button>
        </div>
      ))}
    </div>,
    alvo,
  );
}

/**
 * O link para um lead: abre o painel na própria tela. O `href` é a URL com o
 * painel, então abrir em outra aba do navegador (ou com o botão do meio)
 * funciona como link de verdade.
 */
export function LinkDoLead({
  leadId,
  aba = 'fio',
  children,
  className,
  title,
  ...resto
}: {
  leadId: string;
  aba?: AbaDoPainel;
  children: React.ReactNode;
  className?: string;
  title?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  const p = usePainel();
  const [href, setHref] = useState(() => hrefPadrao(leadId, aba));
  // O href depende da tela de agora (a fila abre na fila, o funil no funil): só no navegador.
  useEffect(() => setHref(p.hrefDoLead(leadId, aba)), [p, leadId, aba]);
  return (
    <Link
      href={href}
      className={className}
      title={title}
      {...resto}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        p.abrir(leadId, aba, e.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}
