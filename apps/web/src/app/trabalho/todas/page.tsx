import { redirect } from 'next/navigation';

import { destinoDeTodas } from '@/lib/rotas-movidas';

/*
 * /trabalho/todas VIROU O CHIP TODAS DE TAREFAS (20/10/2026, noite, pedido do Rodrigo).
 *
 * "O Todas é uma opção dentro de Tarefas, não uma subseção": a visão de todas as
 * pastas e listas mora em `/trabalho?pasta=todas`. Esta rota continua viva para não
 * quebrar link: redireciona preservando a query (`?segmento=`, `?visao=`, filtros),
 * com `pasta=todas` forçado e sem `lista`. O item do NAV fica oculto e dono da rota;
 * o redirect mora na página, e não em `rotas-antigas.mjs`, porque item do NAV com
 * redirect de configuração reprova o teste de disputa de rota.
 */
export default async function TodasAntiga({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(destinoDeTodas(await searchParams));
}
