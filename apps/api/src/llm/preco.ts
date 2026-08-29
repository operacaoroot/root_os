/*
 * Preço por milhão de tokens, em dólar. Cotação de 28/08/2026.
 *
 * Modelo fora desta tabela devolve custo 0 com `custoEstimado: false`, e a tela
 * mostra "não medido". Chutar um preço médio seria o mesmo erro que a régua
 * existe para impedir: número sem procedência.
 */
export interface PrecoModelo {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export const PRECO_USD_MTOK: Record<string, PrecoModelo> = {
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-sonnet-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
  'gpt-4o': { entrada: 2.5, saida: 10, cacheLeitura: 1.25, cacheEscrita: 2.5 },
};

/** Casa `claude-opus-5-20260101` com a entrada `claude-opus-5`. */
export function precoDe(modelo: string): PrecoModelo | null {
  if (PRECO_USD_MTOK[modelo]) return PRECO_USD_MTOK[modelo];
  const chave = Object.keys(PRECO_USD_MTOK)
    .filter((k) => modelo.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return chave ? PRECO_USD_MTOK[chave] : null;
}

export function custoUsd(
  modelo: string,
  t: { entrada: number; saida: number; cacheLeitura?: number; cacheEscrita?: number },
): { custoUsd: number; custoEstimado: boolean } {
  const p = precoDe(modelo);
  if (!p) return { custoUsd: 0, custoEstimado: false };
  const total =
    (t.entrada * p.entrada +
      t.saida * p.saida +
      (t.cacheLeitura ?? 0) * p.cacheLeitura +
      (t.cacheEscrita ?? 0) * p.cacheEscrita) /
    1_000_000;
  // 6 casas: uma pergunta barata custa ~0,0004 USD e não pode virar zero.
  return { custoUsd: Number(total.toFixed(6)), custoEstimado: true };
}
