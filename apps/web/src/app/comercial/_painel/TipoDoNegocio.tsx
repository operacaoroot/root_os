'use client';

import { useState } from 'react';
import { COMERCIAL_TIPOS_DE_NEGOCIO, ROTULO_DO_TIPO_DE_NEGOCIO, type ComercialTipoDeNegocio } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErroDaAcao } from '../_ui';

/*
 * O TIPO DO NEGÓCIO no topo do painel do lead (layout 26/10/2026): pagante (o padrão),
 * parceria, permuta ou repasse — o mesmo dos acordos da Análise. A troca vai ao fio
 * como fato ("negocio.tipo_definido") e não dispara automação nem mexe na etapa.
 */
export function TipoDoNegocio({ leadId, tipo, aoMudar }: { leadId: string; tipo: ComercialTipoDeNegocio; aoMudar: () => Promise<void> | void }) {
  const { token, can } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  if (!can('leads.editar')) return <span className="text-[11.5px] text-muted">negócio: {ROTULO_DO_TIPO_DE_NEGOCIO[tipo].toLowerCase()}</span>;

  async function trocar(novo: string) {
    if (novo === tipo) return;
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(`/comercial/lead/${encodeURIComponent(leadId)}/tipo`, { tipo: novo }, token);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
      <label htmlFor={`tipo-${leadId}`}>negócio:</label>
      <select
        id={`tipo-${leadId}`}
        data-testid="lead-tipo-do-negocio"
        value={tipo}
        disabled={ocupado}
        onChange={(e) => void trocar(e.target.value)}
        title="Pagante gera caixa; parceria, permuta e repasse não"
        className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11.5px] text-text"
      >
        {COMERCIAL_TIPOS_DE_NEGOCIO.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO_DE_NEGOCIO[t].toLowerCase()}</option>)}
      </select>
      <ErroDaAcao erro={erro} />
    </span>
  );
}
