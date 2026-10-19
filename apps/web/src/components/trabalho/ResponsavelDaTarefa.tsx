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

/*
 * VÁRIOS RESPONSÁVEIS (versão final, F4, trazido do Lucas): o principal é o vínculo
 * acima (`assigneeUserId`); os demais moram em `outrosResponsaveisIds`. A identidade
 * é sempre a CONTA: o nome sai da lista de pessoas da estrutura, nunca de texto.
 */
export function OutrosResponsaveis({ ids, pessoas }: { ids: string[]; pessoas: Pessoa[] }) {
  if (!ids.length) return null;
  const nomes = ids.map((id) => pessoas.find((p) => p.id === id)?.name ?? 'pessoa indisponível');
  return <span title={`Também: ${nomes.join(', ')}`} data-testid="outros-responsaveis" className="text-muted">+ {nomes.length === 1 ? nomes[0] : `${nomes.length} pessoas`}</span>;
}

export function SeletorOutrosResponsaveis({ principal, ids, pessoas, disabled, onChange }: {
  principal: string | null; ids: string[]; pessoas: Pessoa[]; disabled: boolean;
  onChange: (ids: string[]) => Promise<unknown>;
}) {
  const [salvando, setSalvando] = useState(false);
  const mudar = async (novos: string[]) => {
    setSalvando(true);
    try { await onChange(novos); } finally { setSalvando(false); }
  };
  const candidatas = pessoas.filter((p) => p.isActive && p.id !== principal && !ids.includes(p.id));
  return (
    <div className="space-y-1" data-testid="tarefa-outros-responsaveis">
      {ids.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {ids.map((id) => {
            const pessoa = pessoas.find((p) => p.id === id);
            const rotulo = pessoa ? `${pessoa.name}${pessoa.isActive ? '' : ' (inativo)'}` : 'Pessoa indisponível';
            return (
              <li key={id} className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">
                <span title={pessoa?.email}>{rotulo}</span>
                {!disabled && (
                  <button type="button" disabled={salvando} aria-label={`Tirar ${rotulo} dos responsáveis`} onClick={() => void mudar(ids.filter((x) => x !== id))} className="text-muted hover:text-bad">×</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <select
        aria-label="Adicionar responsável"
        disabled={disabled || salvando || candidatas.length === 0}
        value=""
        onChange={(e) => { if (e.target.value) void mudar([...ids, e.target.value]); }}
        className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60"
      >
        <option value="">{candidatas.length ? 'Adicionar pessoa…' : ids.length ? 'Todas as pessoas ativas já estão' : 'Nenhuma outra pessoa ativa'}</option>
        {candidatas.map((p) => <option key={p.id} value={p.id}>{rotuloDaPessoa(p)}</option>)}
      </select>
    </div>
  );
}
