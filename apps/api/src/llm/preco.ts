/*
 * Preço por milhão de tokens, em dólar. Cotação de 28/08/2026, com os modelos
 * 5.5 da Anthropic acrescentados em 21/10/2026 (rodada dos agentes).
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
  /**
   * A SEGUNDA FAIXA, para o modelo que cobra outro preço quando o pedido é
   * longo (o Haiku 5.5, acima de 100 mil tokens de entrada). `acimaDe` conta o
   * pedido inteiro: entrada sem cache + leitura de cache + escrita de cache,
   * porque o "tamanho do prompt" da tabela é o que sobe, cacheado ou não.
   */
  pedidoLongo?: { acimaDe: number; preco: Omit<PrecoModelo, 'pedidoLongo'> };
}

export const PRECO_USD_MTOK: Record<string, PrecoModelo> = {
  // OpenRouter, conferido em 14/09/2026:
  // https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-4.5/endpoints
  // Tarifa base; contexto longo e roteamento regional podem custar mais.
  // OpenRouterProvider prioriza usage.cost (valor real) sobre esta estimativa.
  'anthropic/claude-sonnet-4.5': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 3.75 },
  // OpenRouter, 30/09/2026: cinco endpoints da rota Standard em US$ 2/10
  // por milhão, cache 0,20/2,50. Três endpoints fora dela cobram 2,20/11;
  // cache de escrita de 1h custa 4 e não tem faixa própria nesta tabela.
  // https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5.5/endpoints
  'anthropic/claude-sonnet-5.5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  /*
   * OS MODELOS 5.5 (rodada dos agentes, 21/10/2026), pela tabela da Anthropic
   * (skill `claude-api`, cache de 06/10/2026). Escrita de cache é a de 5 min
   * (1,25x a entrada); a de 1 h (2x) não tem faixa própria aqui, como no Sonnet acima.
   *  · Opus 5.5: 4/20, leitura de cache 0,20 (o roteiro da rodada dizia 0,40;
   *    vale o da tabela), escrita 5.
   *  · Sonnet 5.5: 2/10, cache 0,20/2,50.
   *  · Haiku 5.5: DUAS FAIXAS pelo tamanho do pedido — até 100 mil tokens
   *    0,10/0,50 (cache 0,01/0,125); acima, 0,50/2,50 (cache 0,05/0,625).
   */
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-5-5': {
    entrada: 0.1,
    saida: 0.5,
    cacheLeitura: 0.01,
    cacheEscrita: 0.125,
    pedidoLongo: {
      acimaDe: 100_000,
      preco: { entrada: 0.5, saida: 2.5, cacheLeitura: 0.05, cacheEscrita: 0.625 },
    },
  },
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-sonnet-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
  'gpt-4o': { entrada: 2.5, saida: 10, cacheLeitura: 1.25, cacheEscrita: 2.5 },
  /*
   * VETORIZAÇÃO (rodada dos agentes, 21/10/2026): o embedding da vault e do
   * acervo passou pelo teto por empresa. US$ 0,02 por milhão de tokens de
   * entrada, sem saída (tabela da OpenAI, developers.openai.com/api/docs/pricing,
   * lida em 21/10/2026; é a ordem de grandeza que o revisor da onda 10 já tinha
   * medido: ~US$ 0,04 por 2 milhões).
   */
  'text-embedding-3-small': { entrada: 0.02, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
  /*
   * TRANSCRIÇÃO pela contagem de tokens (mesma página, 21/10/2026): áudio de
   * entrada 2,50 e texto de saída 10 por milhão. Vale quando a resposta traz o
   * uso em tokens; sem ele, o custo é o do minuto (`PRECO_TRANSCRICAO_USD_POR_MINUTO`).
   */
  'gpt-4o-transcribe': { entrada: 2.5, saida: 10, cacheLeitura: 0, cacheEscrita: 0 },
};

/**
 * A busca na web do servidor da Anthropic (`web_search`): US$ 10 por mil buscas,
 * fora o token que o resultado ocupa na entrada (skill `claude-api`, "web searches
 * at $10 per 1,000").
 */
export const PRECO_BUSCA_NA_WEB_USD = 0.01;

/** Casa `claude-opus-5-20260101` com `claude-opus-5`, sem aceitar outro modelo por prefixo. */
function entradaDe(modelo: string): PrecoModelo | null {
  if (PRECO_USD_MTOK[modelo]) return PRECO_USD_MTOK[modelo];
  const chave = Object.keys(PRECO_USD_MTOK)
    .filter((k) => modelo.startsWith(k) && /^-(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(modelo.slice(k.length)))
    .sort((a, b) => b.length - a.length)[0];
  return chave ? PRECO_USD_MTOK[chave] : null;
}

/**
 * O preço do modelo para um pedido deste tamanho. Sem `tokensDoPedido`, a faixa
 * de base (o que vale para todo modelo de faixa única). Com ele, e acima do
 * corte de um modelo de duas faixas, a faixa de pedido longo.
 */
export function precoDe(modelo: string, tokensDoPedido?: number): PrecoModelo | null {
  const p = entradaDe(modelo);
  if (!p) return null;
  if (p.pedidoLongo && typeof tokensDoPedido === 'number' && tokensDoPedido > p.pedidoLongo.acimaDe) {
    return p.pedidoLongo.preco;
  }
  return p;
}

export function custoUsd(
  modelo: string,
  t: { entrada: number; saida: number; cacheLeitura?: number; cacheEscrita?: number },
): { custoUsd: number; custoEstimado: boolean } {
  const pedido = t.entrada + (t.cacheLeitura ?? 0) + (t.cacheEscrita ?? 0);
  const p = precoDe(modelo, pedido);
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
