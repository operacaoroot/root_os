'use client';

import { useEffect } from 'react';
import { ListasDoComercial } from '@/components/trabalho/ListasDoComercial';
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';
import { destinoDaAbaRodada } from '@/lib/rotas-movidas';

/*
 * A implantação de clientes numa tela só (rodada do trabalho T1, 19/10/2026): o kanban
 * denso da lista "Onboarding de cliente", com rolagem lateral e o trilho no pop-up do cartão.
 *
 * A aba "Rodada da semana" que a versão final (F4) pôs aqui saiu em 20/10/2026 (rodada da
 * interface, U1, item 10 da ata): a rodada do Pedro mora em `/comercial/rodada`, no
 * Comercial, com a mesma trava de plataforma. O link antigo `?aba=rodada` vai para lá,
 * com o resto da query; `/operacao` segue viva.
 */
export default function ImplantacaoPage() {
  useEffect(() => {
    const destino = destinoDaAbaRodada(Object.fromEntries(new URLSearchParams(window.location.search)));
    if (destino) window.location.replace(destino);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ListasDoComercial />
      <TrabalhoView modo="implantacao" />
    </div>
  );
}
