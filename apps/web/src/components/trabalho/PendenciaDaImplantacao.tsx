'use client';

/*
 * O FILTRO DE PENDÊNCIA DA IMPLANTAÇÃO (rodada de produção 2, M1, S5, 22/10/2026).
 *
 * O cartão "Implantação" do Dia a dia leva para `/trabalho/implantacao?pendencia=`
 * com `sem-proximo-passo`, `passo-vencido` ou `sem-reuniao`. Aqui a Implantação lê
 * o parâmetro, pede o resumo (`GET /trabalho/implantacao/resumo`, os ids de cada
 * pendência, pela mesma regra do relógio do onboarding) e o quadro mostra só
 * esses cards, com a faixa que diz o recorte e "Ver todos".
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AGENDA_INDISPONIVEL, AGENDA_SEM_PERMISSAO, ROTULO_DA_PENDENCIA_DA_IMPLANTACAO, ehPendenciaDaImplantacao,
  type PendenciaDaImplantacao as Pendencia, type ResumoDaImplantacao,
} from '@mktos/shared';

import { apiGet } from '@/lib/api';

export function urlDaPendencia(p: Pendencia): string {
  return `/trabalho/implantacao?pendencia=${p}`;
}

export interface FiltroDaPendencia {
  pendencia: Pendencia | null;
  /** Os ids dos cards da pendência; nulo = sem filtro (ou ainda lendo). */
  ids: Set<string> | null;
  /** A faixa acima do quadro; nula sem filtro. */
  faixa: React.ReactNode;
}

function lerDoEndereco(): Pendencia | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('pendencia');
  return ehPendenciaDaImplantacao(v) ? v : null;
}

export function useFiltroDaPendencia(ativo: boolean, token: string | null): FiltroDaPendencia {
  const [pendencia, setPendencia] = useState<Pendencia | null>(null);
  const [resumo, setResumo] = useState<ResumoDaImplantacao | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => { if (ativo) setPendencia(lerDoEndereco()); }, [ativo]);
  useEffect(() => {
    if (!ativo || !pendencia || !token) return;
    let vivo = true;
    setErro(false);
    apiGet<ResumoDaImplantacao>('/trabalho/implantacao/resumo', token)
      .then((r) => { if (vivo) setResumo(r); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [ativo, pendencia, token]);
  // O mesmo conjunto enquanto o resumo e a pendência não mudam: o quadro memoriza em cima dele.
  const idsLidos = useMemo(() => (resumo && pendencia ? new Set(resumo.pendencias[pendencia] ?? []) : null), [resumo, pendencia]);

  if (!ativo || !pendencia) return { pendencia: null, ids: null, faixa: null };
  const limpar = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('pendencia');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setPendencia(null);
  };
  const ids = idsLidos;
  const rotulo = ROTULO_DA_PENDENCIA_DA_IMPLANTACAO[pendencia];
  const texto = erro
    ? 'Não deu para ler as pendências agora: o quadro mostra todos os cards.'
    : !resumo ? 'Lendo as pendências.'
    : pendencia === 'sem-reuniao' && resumo.agenda !== 'ok' ? `${resumo.agenda === 'sem-permissao' ? AGENDA_SEM_PERMISSAO : AGENDA_INDISPONIVEL}: não dá para dizer quem está sem reunião. O quadro mostra todos os cards.`
    : `Mostrando ${ids!.size} ${ids!.size === 1 ? rotulo.um : rotulo.varios}.`;
  const filtra = !erro && !!resumo && !(pendencia === 'sem-reuniao' && resumo.agenda !== 'ok');
  return {
    pendencia,
    ids: filtra ? ids : null,
    faixa: (
      <p role="status" data-testid="implantacao-filtro-pendencia" data-pendencia={pendencia} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
        <span>{texto}</span>
        <button type="button" onClick={limpar} className="underline underline-offset-2 max-md:min-h-[44px]">Ver todos</button>
      </p>
    ),
  };
}
