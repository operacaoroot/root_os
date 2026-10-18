'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
type Origem = { modo: 'exercicio'; leadId: string; leadNome: string; propostaVersao: number; aceiteId: string };
export function OrigemComercialDaTarefa({ taskId }: { taskId: string }) {
  const { token,can } = useAuth();
  const podeLer = can('leads.ver') && can('tarefas.ver');
  const [origem,setOrigem] = useState<Origem | null>(null);
  useEffect(() => {
    let atual = true; setOrigem(null);
    if (!token || !podeLer) return;
    apiGet<Origem | null>(`/leads/exercicio/entregas/${encodeURIComponent(taskId)}`,token)
      .then((r) => { if (atual) setOrigem(r); }).catch(() => { if (atual) setOrigem(null); });
    return () => { atual = false; };
  },[token,taskId,podeLer]);
  if (!origem) return null;
  return <div className="rounded-lg border border-border p-3 text-sm"><div className="text-xs text-muted">Origem Comercial (exercício)</div>
    <Link className="text-brand underline" href={`/leads/${origem.leadId}`}>{origem.leadNome} · proposta v{origem.propostaVersao}</Link>
    <p className="text-xs text-muted">Aceite de exercício, sem assinatura ou cobrança.</p></div>;
}
