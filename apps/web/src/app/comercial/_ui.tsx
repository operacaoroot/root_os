'use client';

/*
 * As peças comuns das telas internas do cockpit (lane C, 13/10/2026).
 *
 * Tudo no tema do OS (tokens `bg`, `surface`, `border`, `brand`...), que já
 * troca entre escuro e claro pelo `data-os-theme` do <html>. Nada repinta o app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faixaDaSaude } from '@/lib/cockpit';

export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
export const BOTAO = `rounded border border-border px-3 py-1.5 text-[12.5px] transition hover:border-brand disabled:opacity-50 ${FOCO}`;
export const BOTAO_PRIMARIO = `rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-50 ${FOCO}`;
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

  const recarregar = useCallback(async () => {
    if (!token || !caminho) return;
    try {
      const r = await apiGet<T>(caminho, token);
      if (!vivo.current) return;
      setDados(r);
      setErro(null);
    } catch (e) {
      if (vivo.current) setErro(e);
    } finally {
      if (vivo.current) setCarregando(false);
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

export function Rotulo({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`${ROTULO} ${className}`}>{children}</h2>;
}

export function Carregando() {
  return <p className="text-[13px] text-muted" role="status">carregando…</p>;
}

export function Erro({ erro }: { erro: unknown }) {
  if (!erro) return null;
  return (
    <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
      {erro instanceof Error ? erro.message : String(erro)}
    </p>
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
      <p className={`font-os-mono text-[26px] leading-none ${tom === 'brand' ? 'text-brand' : tom === 'ruim' ? 'text-bad' : ''}`}>{valor}</p>
      <p className="mt-1.5 text-[12px] text-muted">{legenda}</p>
    </div>
  );
}

/** Navegação curta entre as telas de um lead. */
export function AbasDoLead({ leadId, atual }: { leadId: string; atual: 'fio' | 'sessao' | 'fechamento' | 'contrato' }) {
  const abas = [
    { chave: 'fio', rotulo: 'fio e ficha', href: `/comercial/lead/${leadId}` },
    { chave: 'sessao', rotulo: 'depois da sessão', href: `/comercial/lead/${leadId}/sessao` },
    { chave: 'fechamento', rotulo: 'fechamento', href: `/comercial/lead/${leadId}/fechamento` },
    { chave: 'contrato', rotulo: 'contrato vivo', href: `/comercial/contratos/${leadId}` },
  ] as const;
  return (
    <nav aria-label="telas do lead" className="flex flex-wrap gap-1.5">
      {abas.map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          aria-current={a.chave === atual ? 'page' : undefined}
          className={`rounded border px-2.5 py-1 text-[12px] ${a.chave === atual ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'} ${FOCO}`}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
