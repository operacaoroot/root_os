'use client';

import { useEffect, useState } from 'react';
import type { EquipeDaEmpresa, TrabTarefaResumo } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { PilhaDeAvatares, type PessoaNoAvatar } from '@/components/PilhaDeAvatares';

type Vinculo = Pick<TrabTarefaResumo, 'assigneeUserId' | 'assigneeUserName' | 'assigneeUserEmail' | 'assigneeUserIsActive'>;
type Pessoa = { id: string; name: string; email: string; isActive: boolean };

/** Layout 26/10 (P-16): só o nome; o e-mail fica no título (passar o mouse). */
export const rotuloDaPessoa = (pessoa: Pick<Pessoa, 'name' | 'email'>) => `${pessoa.name}`;

/*
 * QUEM PODE SER RESPONSÁVEL (layout 26/10, P-16): a mesma regra da tela Equipe
 * (`packages/shared/src/equipe-pessoas.ts`), servida em `/organograma/equipe`. Fora
 * ficam contas de sistema, de teste, a conta da empresa e a segunda conta da mesma
 * pessoa. Nada é apagado: quem já é responsável de uma tarefa continua aparecendo nela.
 * Sem a resposta (erro ou sem permissão), a lista volta a ser a de todas as contas.
 */
let equipeEmCache: Promise<Set<string> | null> | null = null;
export function useIdsDaEquipe(token: string | null): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!token) return;
    equipeEmCache ??= apiGet<EquipeDaEmpresa>('/organograma/equipe', token)
      .then((e) => (e.pessoas.length ? new Set(e.pessoas.map((p) => p.id)) : null))
      .catch(() => { equipeEmCache = null; return null; });
    let vivo = true;
    void equipeEmCache.then((s) => { if (vivo) setIds(s); });
    return () => { vivo = false; };
  }, [token]);
  return ids;
}
/** As pessoas que aparecem para escolher: as da equipe, mais quem já está na tarefa. */
/** Nome sozinho; com o e-mail só quando há outra pessoa com o mesmo nome na lista (homônimos, regra do Rodrigo). */
export function rotuloNaLista(pessoa: Pick<Pessoa, 'name' | 'email'>, lista: readonly Pick<Pessoa, 'name'>[]): string {
  const repetido = lista.filter((p) => p.name.trim().toLowerCase() === pessoa.name.trim().toLowerCase()).length > 1;
  return repetido ? `${pessoa.name} (${pessoa.email})` : pessoa.name;
}
export function soDaEquipe<P extends { id: string }>(pessoas: P[], equipe: Set<string> | null, manter: (string | null | undefined)[] = []): P[] {
  if (!equipe) return pessoas;
  return pessoas.filter((p) => equipe.has(p.id) || manter.includes(p.id));
}

export function ResponsavelDaTarefa({ tarefa }: { tarefa: Vinculo }) {
  if (!tarefa.assigneeUserId) return <span className="text-muted">Sem vínculo de pessoa</span>;
  if (!tarefa.assigneeUserName || !tarefa.assigneeUserEmail) return <span className="text-muted">Vínculo de pessoa indisponível</span>;
  return <span>{rotuloDaPessoa({ name: tarefa.assigneeUserName, email: tarefa.assigneeUserEmail })}{tarefa.assigneeUserIsActive === false ? ' (inativo)' : ''}</span>;
}

/*
 * O RESPONSÁVEL NO CARTÃO E NA LINHA (produção 22B, I6): só o avatar, com o
 * nome (e o e-mail, como no seletor) no balão. O principal vem primeiro; os
 * outros responsáveis se sobrepõem, com "+N" passando de três. As frases de
 * quando não há pessoa são as mesmas do texto de antes, agora no balão.
 */
export function AvataresDaTarefa({ tarefa, pessoas, testId }: {
  tarefa: Vinculo & Pick<TrabTarefaResumo, 'outrosResponsaveisIds'>; pessoas: Pessoa[]; testId?: string;
}) {
  const lista: PessoaNoAvatar[] = [];
  if (tarefa.assigneeUserId && tarefa.assigneeUserName) {
    const email = tarefa.assigneeUserEmail ? rotuloDaPessoa({ name: tarefa.assigneeUserName, email: tarefa.assigneeUserEmail }) : tarefa.assigneeUserName;
    lista.push({ id: tarefa.assigneeUserId, nome: tarefa.assigneeUserName, rotulo: `${email}${tarefa.assigneeUserIsActive === false ? ' (inativo)' : ''}` });
  }
  for (const id of tarefa.outrosResponsaveisIds ?? []) {
    if (id === tarefa.assigneeUserId) continue;
    const p = pessoas.find((x) => x.id === id);
    lista.push(p ? { id, nome: p.name, rotulo: `${rotuloDaPessoa(p)}${p.isActive ? '' : ' (inativo)'}` } : { id, nome: '?', rotulo: 'Pessoa indisponível' });
  }
  const vazio = tarefa.assigneeUserId && !tarefa.assigneeUserName ? 'Vínculo de pessoa indisponível' : 'Sem vínculo de pessoa';
  return <PilhaDeAvatares pessoas={lista} vazio={vazio} prefixo={lista.length ? 'Responsável' : undefined} testId={testId} />;
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
    {disponiveis.map((pessoa) => <option key={pessoa.id} value={pessoa.id} disabled={!pessoa.isActive}>{rotuloNaLista(pessoa, disponiveis)}{!pessoa.isActive ? ' (inativo)' : ''}</option>)}
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
        {candidatas.map((p) => <option key={p.id} value={p.id}>{rotuloNaLista(p, candidatas)}</option>)}
      </select>
    </div>
  );
}
