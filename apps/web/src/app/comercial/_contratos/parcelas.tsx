'use client';

/*
 * AS PARCELAS EM ABERTO DO LEAD, para encerrar e fazer distrato. Sem conseguir ler, a
 * tela não supõe zero: pede a mesma ciência, dizendo que não conferiu.
 */
import type { ContratoVivo } from '@mktos/shared';

import { useCarregar } from '../_ui';
import { parcelasEmAberto } from './regras';

export interface ParcelasDoLead {
  /** Nulo enquanto não se sabe (carregando ou falhou). */
  emAberto: number | null;
  falhou: boolean;
}

export function useParcelasDoLead(leadId: string): ParcelasDoLead {
  const vivo = useCarregar<ContratoVivo>(`/comercial/contratos/${encodeURIComponent(leadId)}`, 60_000);
  return { emAberto: vivo.dados ? parcelasEmAberto(vivo.dados) : null, falhou: !vivo.dados && !!vivo.erro };
}

export function AvisoDeParcelas({ parcelas, ciente, aoMudar, frase }: {
  parcelas: ParcelasDoLead;
  ciente: boolean;
  aoMudar: (c: boolean) => void;
  frase: string;
}) {
  const { emAberto, falhou } = parcelas;
  if (emAberto === 0) return null;
  if (emAberto == null && !falhou) return <p className="w-full text-[12px] text-dim">Lendo as parcelas…</p>;
  return (
    <div role="alert" data-testid="contrato-parcelas-em-aberto" className="w-full space-y-1 rounded border border-warn/50 bg-warn/10 p-2 text-[12.5px]">
      <p>
        <strong className="text-warn">{falhou ? 'Não deu para ler as parcelas agora.' : emAberto === 1 ? '1 parcela em aberto.' : `${emAberto} parcelas em aberto.`}</strong>{' '}
        {frase}
      </p>
      <label className="flex items-center gap-2 max-md:min-h-[44px]">
        <input type="checkbox" data-testid="contrato-parcelas-ciente" checked={ciente} onChange={(e) => aoMudar(e.target.checked)} />
        {falhou ? 'Sei que pode haver parcela em aberto e sigo.' : 'Vi as parcelas em aberto e sigo.'}
      </label>
    </div>
  );
}
