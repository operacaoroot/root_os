'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TrabEstrutura } from '@mktos/shared';
import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › TAREFAS: as tarefas da área Marketing. É a mesma lista de Dia a dia › Tarefas,
 * filtrada pela área; a tarefa criada aqui já nasce com a área. Nada é copiado.
 *
 * 26/10/2026 (aba Marketing no jeito do Estúdio, decisão do Lucas): atalho filtrado, e um
 * botão que abre a pasta Marketing do Trabalho (as listas que vieram do ClickUp).
 */
export default function TarefasMarketingPage() {
  const { token, ready } = useAuth();
  const [pastaId, setPastaId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token)
      // A pasta da área: "Marketing" (ou o nome antigo, "Demandas internas / Marketing").
      .then((e) => setPastaId(e.folders.find((f) => !f.parentId && (f.name.split('/').pop() ?? '').trim().toLowerCase() === 'marketing')?.id ?? null))
      .catch(() => setPastaId(null));
  }, [ready, token]);

  return (
    <div className="space-y-3">
      {pastaId && (
        <div className="flex justify-end">
          <Link
            href={`/trabalho?pasta=${pastaId}`}
            className="inline-flex items-center gap-1.5 rounded border border-border-strong px-3 py-1.5 text-sm text-text transition hover:border-brand hover:text-brand"
          >
            Abrir as listas do Marketing no Trabalho →
          </Link>
        </div>
      )}
      <TarefasDoDia area="Marketing" />
    </div>
  );
}
