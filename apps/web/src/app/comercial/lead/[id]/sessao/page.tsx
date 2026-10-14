import { redirect } from 'next/navigation';

import { destinoDaRotaAntiga } from '../../../_painel/estado';

/** Rota antiga da tela 06: a sessão agora é a aba Sessão do painel do lead. */
export default async function SessaoAntiga({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(destinoDaRotaAntiga('sessao', id));
}
