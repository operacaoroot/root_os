'use client';

import { useEffect, useState } from 'react';
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import RodadaDaSemana from '../../operacao/page';

/*
 * A implantação de clientes numa tela só (rodada do trabalho T1, 19/10/2026): o kanban
 * denso da lista "Onboarding de cliente", com rolagem lateral e o trilho no pop-up do cartão.
 *
 * VERSÃO FINAL (F4, 19/10/2026): como era a "Operação" da produção, a tela ganha uma
 * segunda aba, a RODADA DA SEMANA do Pedro (`/operacao`, a mesma tela), só para a
 * sessão da plataforma (a ROOT): a aba só aparece quando `/tenants/plataforma/quem-sou`
 * responde, e a API do painel recusa as outras sessões de qualquer jeito. A aba escolhida
 * fica em `?aba=rodada`; `/operacao` segue viva.
 */
type Aba = 'implantacao' | 'rodada';

export default function ImplantacaoPage() {
  const { token, ready } = useAuth();
  const [ehRoot, setEhRoot] = useState(false);
  const [aba, setAba] = useState<Aba>('implantacao');

  useEffect(() => {
    setAba(new URLSearchParams(window.location.search).get('aba') === 'rodada' ? 'rodada' : 'implantacao');
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    let vivo = true;
    apiGet('/tenants/plataforma/quem-sou', token)
      .then(() => { if (vivo) setEhRoot(true); })
      .catch(() => { if (vivo) setEhRoot(false); });
    return () => { vivo = false; };
  }, [ready, token]);

  const escolher = (a: Aba) => {
    setAba(a);
    const url = new URL(window.location.href);
    if (a === 'rodada') url.searchParams.set('aba', 'rodada'); else url.searchParams.delete('aba');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const naRodada = aba === 'rodada' && ehRoot;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {ehRoot && (
        <div role="tablist" aria-label="Implantação" className="flex shrink-0 gap-1 border-b border-border">
          {([['implantacao', 'Implantação de clientes'], ['rodada', 'Rodada da semana']] as const).map(([chave, nome]) => (
            <button
              key={chave}
              type="button"
              role="tab"
              aria-selected={aba === chave}
              data-testid={`implantacao-aba-${chave}`}
              onClick={() => escolher(chave)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] max-md:min-h-[44px] ${aba === chave ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {nome}
            </button>
          ))}
        </div>
      )}
      {naRodada ? <RodadaDaSemana /> : <TrabalhoView modo="implantacao" />}
    </div>
  );
}
