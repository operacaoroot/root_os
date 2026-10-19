'use client';

import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';

/*
 * DIA A DIA › TAREFAS: todas as tarefas de todas as áreas num lugar, separadas
 * por pessoa e por área, com o que está atrasado, em dia e sem prazo. Cada área
 * pode ter a sua aba de tarefas; todas leem a MESMA lista (nada é copiado).
 */
export default function TarefasDoDiaPage() {
  return <TarefasDoDia />;
}
