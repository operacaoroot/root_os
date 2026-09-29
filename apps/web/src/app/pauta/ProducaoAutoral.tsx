'use client';

import { useEffect, useState } from 'react';
import type { TrabTarefaLista } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { trabalhoHref } from '@/lib/work-projection';

// IDs externos do lote ROOT Marketing; não inferir escopo pelo nome das listas.
const LISTAS_MARKETING = [
  '901328341442', '901328341443', '901328341445', '901328341450',
  '901328341456', '901328341455', '901328341451',
];

export function ProducaoAutoral({ token }: { token: string }) {
  const [tarefas, setTarefas] = useState<TrabTarefaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const query = new URLSearchParams({ listExternalIds: LISTAS_MARKETING.join(','), page: '1', limit: '8' });
    apiGet<TrabTarefaLista>(`/trabalho/tarefas?${query}`, token)
      .then((result) => { if (ativo) { setTarefas(result); setErro(null); } })
      .catch((e) => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [token]);

  return (
    <section className="rounded-root border border-border bg-surface p-4" aria-label="Produção autoral no Trabalho">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Produção autoral no Trabalho</h2>
          <p className="mt-1 text-sm text-muted">Cards das sete listas de Marketing. A etapa e o prazo vêm do próprio card.</p>
        </div>
        <a href="/trabalho?lista=901328341450" className="text-sm text-brand underline">Abrir quadro</a>
      </div>
      {erro && <p role="alert" className="mt-3 text-sm text-bad">Não foi possível carregar os cards: {erro}</p>}
      {!tarefas && !erro && <p className="mt-3 text-sm text-muted">Carregando cards…</p>}
      {tarefas && (
        <>
          <ul className="mt-3 divide-y divide-border">
            {tarefas.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <a href={trabalhoHref(t.id)} className="min-w-0 font-medium text-brand underline">{t.title}</a>
                <span className="text-xs text-muted">{t.statusName}{t.dueDate ? ` · prazo ${new Date(t.dueDate).toLocaleDateString('pt-BR')}` : ''}</span>
              </li>
            ))}
          </ul>
          {tarefas.total === 0 && <p className="mt-3 text-sm text-muted">Nenhum card neste lote.</p>}
          {tarefas.total > tarefas.items.length && (
            <p className="mt-3 text-xs text-muted">Exibindo {tarefas.items.length} de {tarefas.total} cards. Abra o quadro para ver os demais.</p>
          )}
        </>
      )}
    </section>
  );
}
