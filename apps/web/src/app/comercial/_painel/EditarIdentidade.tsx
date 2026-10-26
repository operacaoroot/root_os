'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT } from '../_ui';

/*
 * EDITAR NOME E EMPRESA DO LEAD (layout 26/10/2026), no topo do painel.
 * Empresa vira o título do card; o contato, a linha de baixo. A correção vai ao
 * fio como fato ("identidade.editada", com o antes e quem fez) e não dispara
 * automação nem mexe na etapa.
 */
export function EditarIdentidade({ leadId, nome, empresa, aoMudar }: { leadId: string; nome: string; empresa: string | null; aoMudar: () => Promise<void> | void }) {
  const { token, can } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [n, setN] = useState(nome);
  const [e, setE] = useState(empresa ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  if (!can('leads.editar')) return null;

  if (!aberto) {
    return (
      <button
        type="button"
        data-testid="lead-editar-identidade"
        onClick={() => { setN(nome); setE(empresa ?? ''); setErro(null); setAberto(true); }}
        className="text-[11.5px] text-muted underline-offset-2 hover:text-brand hover:underline"
      >
        editar nome e empresa
      </button>
    );
  }

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(`/comercial/lead/${encodeURIComponent(leadId)}/identidade`, { nome: n, empresa: e.trim() ? e : null }, token);
      setAberto(false);
      await aoMudar();
    } catch (x) {
      setErro(x);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form
      data-testid="lead-identidade-form"
      onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-[11px] text-muted">
        Empresa
        <input value={e} onChange={(ev) => setE(ev.target.value)} placeholder="ex.: Sr. aGranel" className={INPUT} autoFocus />
      </label>
      <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5 text-[11px] text-muted">
        Contato
        <input value={n} onChange={(ev) => setN(ev.target.value)} placeholder="nome de quem fala pela empresa" className={INPUT} required />
      </label>
      <button type="submit" disabled={ocupado || !n.trim()} className={BOTAO_PRIMARIO}>salvar</button>
      <button type="button" onClick={() => setAberto(false)} className={BOTAO}>cancelar</button>
      <div className="basis-full"><ErroDaAcao erro={erro} /></div>
    </form>
  );
}
