/*
 * Para onde `/tarefas` manda (rodada do painel P2, 18/10/2026): `/trabalho` na
 * visão de lista, com a query do link preservada. Fora de `page.tsx` porque a
 * página do App Router não pode exportar nada além do componente.
 */
export function destinoDeTarefas(query: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) p.append(chave, v);
  }
  if (!p.get('visao')) p.set('visao', 'lista');
  return `/trabalho?${p.toString()}`;
}
