import { redirect } from 'next/navigation';

import { destinoDoComercial } from '@/lib/destino-do-comercial';

/*
 * /comercial VIROU A PORTA DO FUNIL VIVO (rodada do trabalho T6, 19/10/2026).
 *
 * A fila de decisões era a tela principal do comercial. As decisões passaram à
 * aba Decisões de Pendências (`/caixa?aba=decisoes`), com o mesmo cartão e a
 * mesma rota da API, e o menu do Motor Comercial abre no Funil vivo. Esta rota
 * continua viva para não quebrar link: redireciona preservando a query
 * (`?lead=`, `?aba=`, filtros). A tela antiga da fila segue viva em
 * `/comercial/decisoes`.
 *
 * O redirect mora NA PÁGINA, e não em `rotas-antigas.mjs`: `/comercial` segue
 * item (oculto) do NAV, dono do módulo `leads` para as subrotas, e o teste
 * "redirect e página não disputam a mesma rota" reprova item do NAV com
 * redirect de configuração.
 */
export default async function ComercialAntigo({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(destinoDoComercial(await searchParams));
}
