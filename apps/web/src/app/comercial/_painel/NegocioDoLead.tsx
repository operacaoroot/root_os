'use client';

import { useState } from 'react';
import { COMERCIAL_CANAIS_DE_ENTRADA, ROTULO_DO_CANAL_DE_ENTRADA } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAvatares } from '@/lib/avatares';
import { soDaEquipe, useIdsDaEquipe } from '@/components/trabalho/ResponsavelDaTarefa';
import { ErroDaAcao } from '../_ui';

/*
 * O NEGÓCIO DO LEAD (layout 26/10/2026), no topo do painel: valor negociado, vendedor e
 * canal de aquisição. Vendedor é quem VENDEU, diferente do dono (quem cuida agora) e do
 * canal (de onde o lead veio). Cada troca vai ao fio como fato ("negocio.ajustado") e não
 * dispara automação, proposta nem etapa.
 */
export function NegocioDoLead({ leadId, valorNegociadoCentavos, vendedorId, canal, aoMudar }: {
  leadId: string; valorNegociadoCentavos: number | null; vendedorId: string | null; canal: string | null; aoMudar: () => Promise<void> | void;
}) {
  const { token, can } = useAuth();
  const pessoas = useAvatares(token);
  const equipe = useIdsDaEquipe(token);
  const [valor, setValor] = useState(valorNegociadoCentavos != null ? String(valorNegociadoCentavos / 100) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const pode = can('leads.editar');

  async function gravar(corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(`/comercial/lead/${encodeURIComponent(leadId)}/negocio`, corpo, token);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  const salvarValor = () => {
    const limpo = valor.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const novo = limpo === '' ? null : Number(limpo);
    const antes = valorNegociadoCentavos != null ? valorNegociadoCentavos / 100 : null;
    if (novo === antes || (novo !== null && !Number.isFinite(novo))) return;
    void gravar({ valorNegociado: novo });
  };

  const campo = 'rounded border border-border bg-bg px-1.5 py-0.5 text-[11.5px] text-text disabled:opacity-60';
  const lista = soDaEquipe(pessoas ?? [], equipe, [vendedorId]);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted" data-testid="lead-negocio">
      <label className="inline-flex items-center gap-1.5">valor negociado:
        <input
          value={valor} disabled={!pode || ocupado} inputMode="decimal" placeholder="R$"
          onChange={(e) => setValor(e.target.value)} onBlur={salvarValor}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={`${campo} w-24`} data-testid="lead-valor-negociado"
        />
      </label>
      <label className="inline-flex items-center gap-1.5">vendedor:
        <select value={vendedorId ?? ''} disabled={!pode || ocupado} onChange={(e) => void gravar({ vendedorId: e.target.value || null })} className={campo} data-testid="lead-vendedor">
          <option value="">sem vendedor</option>
          {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5">canal:
        <select value={canal ?? ''} disabled={!pode || ocupado} onChange={(e) => void gravar({ canal: e.target.value || null })} className={campo} data-testid="lead-canal">
          <option value="">sem informação</option>
          {COMERCIAL_CANAIS_DE_ENTRADA.map((c) => <option key={c} value={c}>{ROTULO_DO_CANAL_DE_ENTRADA[c] ?? c}</option>)}
        </select>
      </label>
      <ErroDaAcao erro={erro} />
    </span>
  );
}
