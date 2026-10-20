import { redirect } from 'next/navigation';

import { destinoDoSimulador } from '@/lib/rotas-movidas';

/*
 * /comercial/simulador VIROU A ÁREA WHATSAPP (rodada da interface, 20/10/2026, U1).
 *
 * A tela dos celulares do lead e da mesa mora em `/whatsapp`. Esta rota continua
 * viva para não quebrar link (favoritos, roteiros antigos): ela redireciona
 * preservando a query (`?conversa=<lead>`). O item do NAV fica oculto e dono da rota;
 * o redirect mora na página, e não em `rotas-antigas.mjs`, porque item do NAV com
 * redirect de configuração reprova o teste de disputa de rota.
 */
export default async function SimuladorAntigo({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(destinoDoSimulador(await searchParams));
}
