import { redirect } from 'next/navigation';

import { destinoDaRotaAntiga } from '../../../_painel/estado';

/** Rota antiga da tela 10: o fechamento agora mora na aba Dinheiro do painel do lead. */
export default async function FechamentoAntigo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(destinoDaRotaAntiga('fechamento', id));
}
