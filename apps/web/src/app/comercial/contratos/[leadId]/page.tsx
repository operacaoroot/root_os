import { redirect } from 'next/navigation';

import { destinoDaRotaAntiga } from '../../_painel/estado';

/** Rota antiga da tela 11: o contrato vivo agora abre na aba Dinheiro, por cima da lista de contratos. */
export default async function ContratoVivoAntigo({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  redirect(destinoDaRotaAntiga('contrato', leadId));
}
