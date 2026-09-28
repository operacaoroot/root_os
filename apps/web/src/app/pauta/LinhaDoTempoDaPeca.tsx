'use client';

import {
  PAUTA_ETAPAS_DA_PECA_NA_SEMANA,
  PAUTA_ETAPA_DA_PECA_NA_SEMANA_ROTULO,
  type PautaEtapaDaPecaNaSemana,
} from '@mktos/shared';

/*
 * MD8: onde a peça está no caminho até o ar — rascunho → proposto → aguardando
 * assinatura → ativo → publicando → publicada. A etapa vem de
 * `etapaDaPecaNaSemana` (shared), a mesma conta da API. Em 375 px a linha
 * quebra em duas; a etapa atual é a única em destaque.
 */
export function LinhaDoTempoDaPeca({ etapa }: { etapa: PautaEtapaDaPecaNaSemana }) {
  const atual = PAUTA_ETAPAS_DA_PECA_NA_SEMANA.indexOf(etapa);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px]" aria-label={`Etapa: ${PAUTA_ETAPA_DA_PECA_NA_SEMANA_ROTULO[etapa]}`}>
      {PAUTA_ETAPAS_DA_PECA_NA_SEMANA.map((e, i) => (
        <li key={e} className="flex items-center gap-1" aria-current={i === atual ? 'step' : undefined}>
          {i > 0 && <span className="text-muted" aria-hidden>→</span>}
          <span
            className={
              i === atual
                ? 'rounded bg-brand/15 px-1 py-0.5 font-medium text-brand'
                : i < atual
                  ? 'text-text'
                  : 'text-muted opacity-70'
            }
          >
            {PAUTA_ETAPA_DA_PECA_NA_SEMANA_ROTULO[e]}
          </span>
        </li>
      ))}
    </ol>
  );
}
