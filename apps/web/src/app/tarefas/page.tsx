import { redirect } from 'next/navigation';

import { destinoDeTarefas } from '@/lib/destino-de-tarefas';

/*
 * /tarefas VIROU A VISÃO DE LISTA DO TRABALHO (rodada do painel P2, 18/10/2026).
 *
 * Quadro e lista eram duas portas para a mesma fonte (`WorkTask`); agora são
 * uma tela só, `/trabalho`, com a troca Quadro · Lista. Esta rota continua viva
 * para não quebrar link: redireciona preservando a query (`?lista=`, `?tarefa=`,
 * filtros) e abre a visão de lista, salvo quando o link já diz `?visao=`.
 *
 * O redirect mora NA PÁGINA, e não em `rotas-antigas.mjs`: `/tarefas` segue
 * item (oculto) do NAV, e o teste "redirect e página não disputam a mesma rota"
 * reprova item do NAV com redirect de configuração. A tabela `Task` antiga não é
 * apagada (pendência ROOT-10, do Pedro).
 */
export default async function TarefasAntiga({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(destinoDeTarefas(await searchParams));
}
