'use client';

import { useRouter } from 'next/navigation';
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';

/*
 * TODAS AS TAREFAS (rodada da interface U3, 20/10/2026): o item do menu abre o
 * Trabalho já em "Todas" (`?pasta=todas` por dentro): as tarefas de todas as pastas
 * e listas, sem card repetido e sem cadastro como tarefa, com os segmentos por pasta
 * de topo (`?segmento=`). Abrir uma lista ou uma pasta volta para `/trabalho`.
 * `/trabalho?pasta=todas` continua valendo.
 */
export default function TodasAsTarefasPage() {
  const router = useRouter();
  return <TrabalhoView aoSairDeTodas={(busca) => router.push(`/trabalho${busca}`)} />;
}
