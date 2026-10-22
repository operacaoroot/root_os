'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { VisaoGeralDasTarefas } from '@/components/tarefas/VisaoGeralDasTarefas';
import { AniversariosDoDia } from '@/components/AniversariosDoDia';

/*
 * DIA A DIA › VISÃO GERAL (versão final, 19/10/2026): a primeira aba e a entrada
 * do Dia a dia. O dash das tarefas do Lucas, organizado pelas pastas e listas do
 * Trabalho. A lista de todas as tarefas que morava aqui virou "Todas" no
 * Trabalho; cada número abre essa lista já filtrada.
 */
export default function VisaoGeralPage() {
  const { can } = useAuth();
  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-muted">As tarefas de todas as pastas, num dash só. Cada número abre a lista no Trabalho.</p>
        <Link href="/trabalho?pasta=todas&visao=lista" className="text-sm text-muted underline hover:text-brand">todas as tarefas no Trabalho</Link>
      </div>
      <AniversariosDoDia />
      {can('tarefas.ver') ? <VisaoGeralDasTarefas /> : <p className="text-muted">Sem acesso às tarefas.</p>}
    </div>
  );
}
