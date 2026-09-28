'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO,
  type PautaEncadeamentoDoEpisodio,
  type PautaEpisodioDetalhe,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';

/*
 * "PRÓXIMO PASSO AUTOMÁTICO" (MD1): o que a rotina `pauta.encadear` faria
 * sozinha neste episódio na próxima passagem, ou por que ela para. Só leitura.
 * Antes da transcrição e depois de Agendado a rotina não mexe no episódio, e a
 * linha diz isso sem perguntar à API.
 */

const ENCADEIAM = ['pacote', 'derivacao'];

export function textoDoEncadeamento(e: PautaEncadeamentoDoEpisodio): string {
  const passo =
    e.passo === 'parar' ? `parado — ${e.motivo ?? 'nada a fazer sozinho'}` : `${PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[e.passo]}.`;
  if (!e.rotina.existe) return `${passo} Sem a rotina de encadeamento em /rotinas, nada anda sozinho.`;
  if (e.rotina.calada) return `${passo} A rotina de encadeamento existe, mas o agendador está calado neste servidor (${e.rotina.calada}).`;
  if (!e.rotina.dispara) return `${passo} A rotina de encadeamento existe mas não está disparando (pausada ou planejada).`;
  return passo;
}

export function LinhaDoEncadeamento({ token, detalhe }: { token: string | null; detalhe: PautaEpisodioDetalhe }) {
  const [estado, setEstado] = useState<PautaEncadeamentoDoEpisodio | null>(null);
  const [falhou, setFalhou] = useState(false);
  const consulta = ENCADEIAM.includes(detalhe.status);

  useEffect(() => {
    setEstado(null);
    setFalhou(false);
    if (!token || !consulta) return;
    let vivo = true;
    apiGet<PautaEncadeamentoDoEpisodio>(`/pauta/episodios/${detalhe.id}/encadeamento`, token)
      .then((d) => {
        if (vivo) setEstado(d);
      })
      // A linha é informativa: falhar aqui não vira tarja de erro na tela toda.
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [token, detalhe, consulta]);

  if (['agendado', 'concluido'].includes(detalhe.status)) return null;

  let texto: string;
  if (!consulta) texto = 'nenhum até a transcrição chegar do Mac.';
  else if (falhou) texto = 'não deu para consultar agora.';
  else if (!estado) texto = 'consultando…';
  else texto = textoDoEncadeamento(estado);

  return (
    <p className="break-words rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted" aria-label="Próximo passo automático">
      <span className="font-semibold text-text">Próximo passo automático:</span> {texto}
    </p>
  );
}
