/**
 * Extrai o objeto JSON de uma resposta de LLM. Modelos às vezes embrulham o
 * JSON em cercas de código ou em uma frase de apresentação — pegar o maior
 * bloco {...} recupera esses casos em vez de derrubar a rodada inteira.
 */
export function parseJsonDaIa<T>(texto: string): T {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(limpo) as T;
  } catch {
    const i = limpo.indexOf('{');
    const j = limpo.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(limpo.slice(i, j + 1)) as T;
      } catch {
        /* cai no erro abaixo */
      }
    }
    throw new Error('A IA não devolveu um JSON válido.');
  }
}
