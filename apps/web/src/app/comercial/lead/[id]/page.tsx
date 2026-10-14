import { redirect } from 'next/navigation';

import { destinoDaRotaAntiga } from '../../_painel/estado';

/** Rota antiga da tela 05: o fio do lead agora abre no painel, por cima do funil. */
export default async function FioDoLeadAntigo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(destinoDaRotaAntiga('fio', id));
}
