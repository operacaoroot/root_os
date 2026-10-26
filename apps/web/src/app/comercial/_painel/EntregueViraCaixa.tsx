'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * "ENTREGUE × VIROU CAIXA" NO PAINEL GERAL (layout 26/10/2026). O mesmo bloco da
 * Análise do Financeiro, lido dos mesmos acordos (`/finance/analise`): quanto foi
 * entregue por tipo (pagante, permuta, repasse, parceria) e quanto disso vira caixa.
 * Só para quem vê o Financeiro; aqui é leitura, a edição dos acordos fica na Análise.
 */

type Tipo = 'pagante' | 'permuta' | 'repasse' | 'parceria';
type Acordos = { porTipo: { tipo: Tipo; acordos: number; valor: number }[]; entregue: number; viraCaixa: number; semCaixaPct: number };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ROTULO: Record<Tipo, string> = { pagante: 'Pagante', permuta: 'Permuta', repasse: 'Repasse', parceria: 'Parceria' };
const COR: Record<Tipo, string> = { pagante: 'bg-good', permuta: 'bg-brand', repasse: 'bg-warn', parceria: 'bg-muted' };

export function EntregueViraCaixa() {
  const { token, can } = useAuth();
  const [a, setA] = useState<Acordos | null>(null);
  const pode = can('financeiro.ver');
  useEffect(() => {
    if (!pode || !token) return;
    apiGet<{ acordos: Acordos }>('/finance/analise', token).then((r) => setA(r.acordos)).catch(() => setA(null));
  }, [pode, token]);
  if (!pode || !a) return null;
  const tipos = a.porTipo.filter((t) => t.acordos > 0);
  const max = Math.max(1, ...tipos.map((t) => t.valor));
  return (
    <section data-testid="painel-entregue-vira-caixa" className="rounded-md border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="com-rotulo">Entregue × virou caixa</h2>
        <span className="text-sm text-muted">
          {brl(a.entregue)} entregues · {brl(a.viraCaixa)} em pagantes · <b className="text-text">{a.semCaixaPct.toFixed(0)}%</b> sem caixa para a ROOT
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {tipos.map((t) => (
          <div key={t.tipo} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
            <span>{ROTULO[t.tipo]} <span className="text-muted">({t.acordos})</span></span>
            <span className="h-2.5 overflow-hidden rounded bg-surface-2"><span className={`block h-full ${COR[t.tipo]}`} style={{ width: `${(t.valor / max) * 100}%` }} /></span>
            <span className="w-28 text-right tabular-nums">{brl(t.valor)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Os mesmos acordos do <Link href="/financeiro" className="underline hover:text-brand">Financeiro</Link> (aba Análise). No funil, o tipo do negócio aparece como selo e no filtro.
      </p>
    </section>
  );
}
