'use client';

import { TrabalhoView } from '@/components/trabalho/TrabalhoView';

// A implantação de clientes numa tela só (rodada do trabalho T1, 19/10/2026): o kanban
// denso da lista "Onboarding de cliente", com rolagem lateral e o trilho no pop-up do cartão.
export default function ImplantacaoPage() {
  return <TrabalhoView modo="implantacao" />;
}
