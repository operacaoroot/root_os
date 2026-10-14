'use client';

/*
 * As peças comuns das telas internas do cockpit (lane C, 13/10/2026).
 *
 * Tudo no tema do OS (tokens `bg`, `surface`, `border`, `brand`...), que já
 * troca entre escuro e claro pelo `data-os-theme` do <html>. Nada repinta o app.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { ErroDaApi, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faixaDaSaude } from '@/lib/cockpit';

export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
// No celular o botão tem 44 px de altura (o alvo do polegar); no desktop, a altura do texto.
export const BOTAO = `inline-flex items-center justify-center rounded border border-border px-3 py-1.5 text-[12.5px] transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[44px] ${FOCO}`;
export const BOTAO_PRIMARIO = `inline-flex items-center justify-center rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-ink transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[44px] ${FOCO}`;
export const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';
export const CARTAO = 'rounded border border-border bg-surface p-4';
export const INPUT = `w-full rounded border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-brand ${FOCO}`;

/** Carrega uma rota da API com o token; recarrega sob demanda e, se pedido, a cada N ms. */
export function useCarregar<T>(caminho: string | null, intervaloMs?: number) {
  const { token, ready } = useAuth();
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(true);
  const vivo = useRef(true);
  // C-10: o caminho de agora. Mudou (outro filtro, outro lead), o que estava na
  // tela sai e a resposta do caminho anterior que chegar atrasada é descartada.
  const atual = useRef(caminho);
  // Lane UX: só o pedido mais recente escreve. O tique periódico que saiu antes
  // de uma ação e voltou depois da releitura não põe o estado velho de volta.
  const ultimoPedido = useRef(0);

  useEffect(() => {
    if (atual.current === caminho) return;
    atual.current = caminho;
    setDados(null);
    setErro(null);
    setCarregando(true);
  }, [caminho]);

  const recarregar = useCallback(async () => {
    if (!token || !caminho) return;
    const pedido = ++ultimoPedido.current;
    const doCaminho = () => vivo.current && atual.current === caminho && pedido === ultimoPedido.current;
    try {
      const r = await apiGet<T>(caminho, token);
      if (!doCaminho()) return;
      setDados(r);
      setErro(null);
    } catch (e) {
      if (doCaminho()) setErro(e);
    } finally {
      if (doCaminho()) setCarregando(false);
    }
  }, [token, caminho]);

  useEffect(() => {
    vivo.current = true;
    if (!ready || !token) return;
    void recarregar();
    if (!intervaloMs) return () => { vivo.current = false; };
    const t = setInterval(() => void recarregar(), intervaloMs);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
  }, [ready, token, recarregar, intervaloMs]);

  return { dados, erro, carregando, recarregar, token };
}

/**
 * O nível do rótulo de seção: h2 nas telas; dentro do painel do lead, onde o
 * h2 é o nome do lead, as seções descem para h3 (lane UX).
 */
export const NivelDoRotulo = createContext<'h2' | 'h3'>('h2');

export function Rotulo({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const Nivel = useContext(NivelDoRotulo);
  return <Nivel className={`${ROTULO} ${className}`}>{children}</Nivel>;
}

/**
 * Carregando: um esqueleto do tamanho do que vai chegar (sem salto quando o
 * dado chega), com o texto para leitor de tela.
 */
export function Carregando({ linhas = 3, altura = 'h-16' }: { linhas?: number; altura?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} aria-hidden className={`${altura} animate-pulse rounded border border-border bg-surface-2 motion-reduce:animate-none`} />
      ))}
    </div>
  );
}

/** O código que acompanha a frase do erro: o da API quando ela deu, senão o status HTTP. */
export function codigoDoErro(erro: unknown): string | null {
  if (!(erro instanceof ErroDaApi)) return null;
  if (erro.codigo) return `${erro.codigo} · ${erro.status}`;
  return erro.status ? String(erro.status) : null;
}

/** Erro de carregar: a frase, o código e, quando dá, o botão de tentar de novo. */
export function Erro({ erro, aoTentar }: { erro: unknown; aoTentar?: () => void }) {
  if (!erro) return null;
  const codigo = codigoDoErro(erro);
  return (
    <div role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
      <p>
        {erro instanceof Error ? erro.message : String(erro)}
        {codigo && <span className="ml-1.5 font-os-mono text-[11px] tabular-nums opacity-80">código {codigo}</span>}
      </p>
      {erro instanceof ErroDaApi && erro.detalhes.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {erro.detalhes.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
      {aoTentar && (
        <button type="button" onClick={aoTentar} className={`mt-2 ${BOTAO} text-text`}>
          tentar de novo
        </button>
      )}
    </div>
  );
}

/**
 * O erro de uma AÇÃO, ao lado do botão que a disparou: a frase e o código da
 * API, sem caixa vermelha genérica (lane UX, §2).
 */
export function ErroDaAcao({ erro }: { erro: unknown }) {
  if (!erro) return null;
  const codigo = codigoDoErro(erro);
  return (
    <div role="alert" className="text-[12.5px] text-bad">
      <p>
        {erro instanceof Error ? erro.message : String(erro)}
        {codigo && <span className="ml-1.5 font-os-mono text-[11px] tabular-nums opacity-80">código {codigo}</span>}
      </p>
      {erro instanceof ErroDaApi && erro.detalhes.length > 0 && (
        <ul className="mt-0.5 list-disc pl-5">
          {erro.detalhes.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}

export function Aviso({ children, tom = 'neutro' }: { children: React.ReactNode; tom?: 'neutro' | 'bom' | 'ruim' }) {
  const cor = tom === 'bom' ? 'border-good/40 bg-good/10' : tom === 'ruim' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-border bg-surface-2';
  return (
    <p role="status" className={`rounded border px-3 py-2 text-[13px] ${cor}`}>
      {children}
    </p>
  );
}

/** A ação foi à porta e ficou retida: diz isso e leva à fila de aprovação. */
export function AguardandoAprovacao({ approvalId, oQue }: { approvalId?: string | null; oQue: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded border border-warn/50 bg-warn/10 px-3 py-2 text-[13px]">
      <span className="font-os-mono text-[10px] uppercase tracking-[0.14em] text-warn">aguardando aprovação</span>
      <span>{oQue} Outra pessoa com alçada confirma na fila.</span>
      <Link href="/atendimento" className={`ml-auto underline decoration-brand underline-offset-2 ${FOCO}`}>
        abrir /atendimento{approvalId ? ` · ${approvalId.slice(0, 8)}` : ''}
      </Link>
    </div>
  );
}

export function Chip({ children, tom = 'neutro', title }: { children: React.ReactNode; tom?: 'neutro' | 'brand' | 'bom' | 'alerta' | 'ruim' | 'info'; title?: string }) {
  const cor = {
    neutro: 'border-border text-muted',
    brand: 'border-brand/50 text-brand',
    bom: 'border-good/50 text-good',
    alerta: 'border-warn/50 text-warn',
    ruim: 'border-bad/50 text-bad',
    info: 'border-info/50 text-info',
  }[tom];
  return (
    <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 font-os-mono text-[10px] uppercase tracking-[0.1em] ${cor}`}>
      {children}
    </span>
  );
}

/** A barra da saúde. Sem número, a barra fica vazia e diz "saúde ausente". */
export function BarraDaSaude({ saude }: { saude: number | null }) {
  const faixa = faixaDaSaude(saude);
  const cor = faixa === 'alta' ? 'bg-good' : faixa === 'media' ? 'bg-warn' : faixa === 'baixa' ? 'bg-bad' : '';
  return (
    <div className="mt-1.5" title={saude == null ? 'saúde ausente' : `saúde ${saude}`}>
      <div className="h-1 w-full overflow-hidden rounded bg-surface-3">
        {saude != null && <div className={`h-full ${cor}`} style={{ width: `${Math.max(0, Math.min(100, saude))}%` }} />}
      </div>
      <span className="sr-only">{saude == null ? 'saúde ausente' : `saúde ${saude}`}</span>
    </div>
  );
}

/** Um número grande com legenda (as contagens do topo das telas 03, 11, 13). */
export function Numero({ valor, legenda, tom }: { valor: string; legenda: string; tom?: 'brand' | 'ruim' }) {
  return (
    <div className={`${CARTAO} min-w-0`}>
      <p className={`font-os-mono text-[21px] leading-none md:text-[26px] ${tom === 'brand' ? 'text-brand' : tom === 'ruim' ? 'text-bad' : ''}`}>{valor}</p>
      <p className="mt-1.5 text-[12px] text-muted">{legenda}</p>
    </div>
  );
}
