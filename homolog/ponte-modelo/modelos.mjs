/*
 * OS MODELOS QUE A PONTE ACEITA (rodada dos agentes, 21/10/2026).
 *
 * A ponte respeita o modelo PEDIDO: o provider `ponte` da API manda `model` no
 * corpo, escolhido pela função do cadastro único, e a ponte passa `--model <id>`
 * ao `claude -p`. Só os três modelos 5.5 do cadastro entram; qualquer outro é
 * recusado com 400 (nada de modelo inventado no meio da prova). Pedido sem
 * `model` usa o padrão da ponte (`PONTE_MODELO`, que também tem de ser um dos três).
 *
 * Mora fora de `ponte.mjs` porque aquele arquivo sobe o servidor ao ser
 * importado: estas duas funções são puras e a suíte da API as testa com dublê.
 */

export const MODELOS_DA_PONTE = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);

/** O modelo deste pedido, ou o erro que diz por que não. */
export function modeloDoPedido(pedido, padrao) {
  const bruto = pedido && pedido.model;
  if (bruto === undefined || bruto === null || bruto === '') return { modelo: padrao };
  if (typeof bruto !== 'string' || !MODELOS_DA_PONTE.includes(bruto.trim())) {
    return { erro: `modelo não aceito pela ponte: use ${MODELOS_DA_PONTE.join(', ')}` };
  }
  return { modelo: bruto.trim() };
}

/** Os argumentos do CLI, sem shell: o modelo vai em `--model`, o resto é a tranca de sempre. */
export function argumentosDoCli(modelo, proibidas) {
  if (!MODELOS_DA_PONTE.includes(modelo)) throw new Error(`modelo fora da lista da ponte: ${modelo}`);
  return [
    '-p',
    '--model', modelo,
    '--output-format', 'text',
    '--tools', '',
    '--disallowedTools', ...proibidas,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
}
