'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ComercialExercicioResposta } from '@mktos/shared';
import { ComercialEntradaExercicioSchema } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pedidoDeExercicio } from './pedido-exercicio';
export function NovaOportunidadeExercicio() {
  const { token,user,can } = useAuth(), router = useRouter();
  const [aberto,setAberto] = useState(false), [nome,setNome] = useState(''), [erro,setErro] = useState<string | null>(null), [busy,setBusy] = useState(false);
  const [origemRef,setOrigemRef] = useState('');
  if (!can('leads.editar')) return null;
  const abrir = () => {
    const chave = `root_comercial_origem:${user?.id}`;
    let ref = localStorage.getItem(chave);
    if (!ref || !/^[a-f0-9-]{36}$/i.test(ref)) { ref = crypto.randomUUID(); localStorage.setItem(chave,ref); }
    setOrigemRef(ref); setAberto(true); setErro(null);
  };
  const criar = async () => {
    if (!token || !user || busy) return;
    setBusy(true); setErro(null);
    try {
      const payload = { origemRef, nome: nome.trim(), ownerId: user.id };
      const requestId = await pedidoDeExercicio(`root_comercial_entrada:${user.id}`,payload);
      const p = ComercialEntradaExercicioSchema.parse({ ...payload,requestId });
      const r = await apiPost<ComercialExercicioResposta>('/leads/exercicio/entrada',p,token);
      router.push(`/leads/${r.leadId}`);
    } catch (e) { setErro((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="rounded-xl border border-border p-4">
    <button type="button" className="text-sm text-brand underline" onClick={abrir}>Nova oportunidade (exercício)</button>
    {aberto && <div className="mt-3 space-y-3"><p className="text-sm text-muted">Exercício local de QA. Você será responsável pela oportunidade; nenhum cliente será contatado.</p>
      <label className="block text-sm">Nome da oportunidade de exercício<input aria-label="Nome da oportunidade de exercício" value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface-2 p-2" /></label>
      <p className="text-xs text-muted">Origem manual: {origemRef}. Repetir esta origem recupera a mesma oportunidade.</p>
      {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
      <div className="flex gap-3"><button type="button" disabled={busy || !nome.trim()} className="rounded-lg bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50" onClick={() => void criar()}>{busy ? 'Registrando…' : 'Registrar oportunidade de exercício'}</button>
      <button type="button" disabled={busy} className="text-sm underline" onClick={() => { const ref = crypto.randomUUID(); localStorage.setItem(`root_comercial_origem:${user?.id}`,ref); setOrigemRef(ref); setNome(''); setErro(null); }}>Começar outra origem de exercício</button></div>
    </div>}
  </div>;
}
