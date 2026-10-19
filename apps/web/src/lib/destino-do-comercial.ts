/*
 * Para onde `/comercial` manda (rodada do trabalho T6, 19/10/2026): o Funil vivo,
 * com a query do link preservada. Um link antigo `/comercial?lead=X&aba=decisoes`
 * abre o painel do mesmo lead, na mesma aba, por cima do funil. Fora de
 * `page.tsx` porque a página do App Router não pode exportar nada além do
 * componente.
 */
export function destinoDoComercial(query: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) p.append(chave, v);
  }
  const busca = p.toString();
  return busca ? `/comercial/funil?${busca}` : '/comercial/funil';
}
