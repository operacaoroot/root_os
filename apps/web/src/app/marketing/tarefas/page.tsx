'use client';

import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';

/*
 * Marketing › TAREFAS: as tarefas da área Marketing. É a mesma lista de Dia a dia › Tarefas,
 * filtrada pela área; a tarefa criada aqui já nasce com a área.
 */
export default function TarefasMarketingPage() {
  return <TarefasDoDia area="Marketing" />;
}
