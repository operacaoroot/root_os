'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';

interface Sessao {
  id: string;
  agente: { slug: string; nome: string; iniciais: string };
  canal: string;
  solicitante: string;
  pedido: string;
  status: string;
  nivelMax: string | null;
  passos: number;
  custoUsd: number;
  custoEstimado: boolean;
  duracaoMs: number;
  semProcedencia: boolean;
  criadaEm: string;
}

interface Lista {
  items: Sessao[];
  total: number;
  kpis: { sessoes: number; custoUsd: number; custoParcial: boolean; semProcedencia: number };
}

const CANAIS = ['web', 'telegram', 'whatsapp', 'rotina', 'terminal', 'mcp'];

const CORES: Record<string, string> = {
  respondida: 'text-good',
  executada: 'text-good',
  retida: 'text-warn',
  recusada: 'text-bad',
  falhou: 'text-bad',
  rodando: 'text-muted',
};

export default function SessoesPage() {
  const { token, ready } = useAuth();
  const [data, setData] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [canal, setCanal] = useState<string>('');
  const [agente, setAgente] = useState<string>('');

  useEffect(() => {
    if (!ready || !token) return;
    const q = new URLSearchParams();
    if (canal) q.set('canal', canal);
    if (agente) q.set('agente', agente);
    apiGet<Lista>(`/sessions?${q}`, token).then(setData).catch((e) => setErro(e.message));
  }, [ready, token, canal, agente]);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Cada troca com a central vira uma sessão, com o traço do que entrou, do que foi chamado e do
        que a régua decidiu. Clique para abrir.
      </p>

      {erro && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiCard label="Sessões no filtro" value={data?.kpis.sessoes ?? '—'} icon="Bot" />
        <KpiCard
          label="Custo somado"
          value={
            !data
              ? '—'
              : data.kpis.custoUsd > 0
                ? `US$ ${data.kpis.custoUsd.toFixed(4)}`
                : 'não medido'
          }
          hint={data?.kpis.custoParcial ? 'parcial: há sessão com custo não medido' : undefined}
          icon="Coins"
        />
        <KpiCard
          label="Sem procedência"
          value={data?.kpis.semProcedencia ?? '—'}
          hint="resposta com número e sem fonte"
          tone={data && data.kpis.semProcedencia > 0 ? 'warn' : 'default'}
          icon="ShieldAlert"
        />
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          type="button"
          onClick={() => setCanal('')}
          className={`rounded-root border px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${canal === '' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}
        >
          todo canal
        </button>
        {CANAIS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCanal(c)}
            className={`rounded-root border px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${canal === c ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}
          >
            {c}
          </button>
        ))}
        {agente && (
          <button
            type="button"
            onClick={() => setAgente('')}
            className="rounded-root border border-brand bg-brand/10 px-[9px] py-[5px] font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand"
          >
            {agente} ✕
          </button>
        )}
      </div>

      <div className="rounded-root border border-border bg-surface">
        {!data && !erro && <p className="p-4 text-sm text-muted">Carregando…</p>}
        {data?.items.length === 0 && (
          <p className="p-4 text-sm text-muted">
            Nenhuma sessão ainda. Abra o balão no canto e pergunte alguma coisa.
          </p>
        )}
        {data?.items.map((s) => (
          <Link
            key={s.id}
            href={`/sessoes/${s.id}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border p-3 last:border-0 hover:bg-surface-2"
          >
            <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
              {new Date(s.criadaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">
              {s.canal}
            </span>
            <span className="text-[11px] text-muted">
              {s.solicitante} → {s.agente.nome}
            </span>
            <span className="min-w-0 flex-1 basis-full truncate text-[12.5px] text-text sm:basis-auto">
              {s.pedido}
            </span>
            <span className="font-os-mono text-[9.5px] text-dim">
              {s.passos} passo{s.passos === 1 ? '' : 's'} · {(s.duracaoMs / 1000).toFixed(1)}s ·{' '}
              {s.custoEstimado && s.custoUsd > 0 ? `US$ ${s.custoUsd.toFixed(4)}` : 'não medido'}
            </span>
            {s.nivelMax && (
              <span className="rounded-root bg-surface-3 px-[5px] py-px font-os-mono text-[9px] font-bold text-muted">
                {s.nivelMax}
              </span>
            )}
            <span className={`font-os-mono text-[9.5px] uppercase tracking-[0.1em] ${CORES[s.status] ?? 'text-muted'}`}>
              {s.status}
            </span>
            {s.semProcedencia && (
              <span className="font-os-mono text-[9px] uppercase tracking-[0.1em] text-warn">
                sem fonte
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
