/*
 * Para onde vão as rotas que mudaram de lugar na rodada da interface (20/10/2026,
 * U1). Fora de `page.tsx` porque a página do App Router não pode exportar nada além
 * do componente. A query do link segue junto: nenhum link antigo perde o que dizia.
 */
type Query = Record<string, string | string[] | undefined>;

/** Monta `base?query`, preservando os valores repetidos e tirando as chaves pedidas. */
export function comQuery(base: string, query: Query, tirar: readonly string[] = []): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined || tirar.includes(chave)) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) p.append(chave, v);
  }
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** `/comercial/simulador` virou a área WhatsApp. */
export function destinoDoSimulador(query: Query): string {
  return comQuery('/whatsapp', query);
}

/**
 * A aba "Rodada da semana" saiu da Implantação e foi para o Comercial. Com
 * `?aba=rodada` a Implantação manda para `/comercial/rodada`; sem ela, `null` (a
 * Implantação abre como sempre).
 */
export function destinoDaAbaRodada(query: Query): string | null {
  const aba = Array.isArray(query.aba) ? query.aba[0] : query.aba;
  return aba === 'rodada' ? comQuery('/comercial/rodada', query, ['aba']) : null;
}
