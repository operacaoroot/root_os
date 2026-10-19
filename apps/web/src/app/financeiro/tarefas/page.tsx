'use client';

import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';

/*
 * Financeiro › TAREFAS: as tarefas da área Financeiro. É a mesma lista de Dia a dia › Tarefas,
 * filtrada pela área; a tarefa criada aqui já nasce com a área.
 */
export default function TarefasFinanceiroPage() {
  return <TarefasDoDia area="Financeiro" />;
}
