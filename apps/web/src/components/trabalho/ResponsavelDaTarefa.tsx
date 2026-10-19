'use client';

import { useState } from 'react';
import type { TrabTarefaResumo } from '@mktos/shared';

type Vinculo = Pick<TrabTarefaResumo, 'assigneeUserId' | 'assigneeUserName' | 'assigneeUserEmail' | 'assigneeUserIsActive'>;
type Pessoa = { id: string; name: string; email: string; isActive: boolean };

export const rotuloDaPessoa = (pessoa: Pick<Pessoa, 'name' | 'email'>) => `${pessoa.name} (${pessoa.email})`;

export function ResponsavelDaTarefa({ tarefa }: { tarefa: Vinculo }) {
  if (!tarefa.assigneeUserId) return <span className="text-muted">Sem vínculo de pessoa</span>;
  if (!tarefa.assigneeUserName || !tarefa.assigneeUserEmail) return <span className="text-muted">Vínculo de pessoa indisponível</span>;
  return <span>{rotuloDaPessoa({ name: tarefa.assigneeUserName, email: tarefa.assigneeUserEmail })}{tarefa.assigneeUserIsActive === false ? ' (inativo)' : ''}</span>;
}

export function SeletorResponsavel({ tarefa, pessoas, disabled, onChange }: {
  tarefa: Vinculo; pessoas: Pessoa[]; disabled: boolean; onChange: (id: string | null) => Promise<unknown>;
}) {
  const [salvando, setSalvando] = useState(false);
  const atual = tarefa.assigneeUserId ?? '';
  const disponiveis = pessoas.filter((pessoa) => pessoa.isActive || pessoa.id === atual);
  const atualAusente = !!atual && !disponiveis.some((pessoa) => pessoa.id === atual);
  const mudar = async (id: string) => {
    if (id === atual) return;
    setSalvando(true);
    try { await onChange(id || null); } finally { setSalvando(false); }
  };
  return <select aria-label="Responsável (pessoa)" disabled={disabled || salvando} value={atual} onChange={(e) => { void mudar(e.target.value); }} className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60">
    <option value="">Sem vínculo de pessoa</option>
    {atualAusente && <option value={atual} disabled>Vínculo de pessoa indisponível</option>}
    {disponiveis.map((pessoa) => <option key={pessoa.id} value={pessoa.id} disabled={!pessoa.isActive}>{rotuloDaPessoa(pessoa)}{!pessoa.isActive ? ' (inativo)' : ''}</option>)}
  </select>;
}
