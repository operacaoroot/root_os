/**
 * O teto de saída que as gerações longas da pauta pedem ao modelo: roteiro,
 * pacote do YouTube, newsletter, voz e as peças da rodada (MC-R). O padrão do
 * provider OpenAI (900 tokens, ~3 mil caracteres) corta no meio o JSON de
 * qualquer uma delas, e JSON cortado é geração perdida — com o gasto feito.
 * No provider da Anthropic o padrão já é maior e nada muda
 * (`saidaDaResposta` só sobe o teto).
 */
export const SAIDA_DA_GERACAO_LONGA = 8_000;
