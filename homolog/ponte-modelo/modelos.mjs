// @ts-check
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

/** Os esforços que o `claude -p --effort` aceita (prova com modelo real, 21/10/2026: antes o esforço do cadastro não chegava). */
export const ESFORCOS_DA_PONTE = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * O modelo deste pedido, ou o erro que diz por que não.
 * @param {{ model?: unknown } | null | undefined} pedido
 * @param {string} padrao
 * @returns {{ modelo: string, erro?: undefined } | { erro: string, modelo?: undefined }}
 */
export function modeloDoPedido(pedido, padrao) {
  const bruto = pedido && pedido.model;
  if (bruto === undefined || bruto === null || bruto === '') return { modelo: padrao };
  if (typeof bruto !== 'string' || !MODELOS_DA_PONTE.includes(bruto.trim())) {
    return { erro: `modelo não aceito pela ponte: use ${MODELOS_DA_PONTE.join(', ')}` };
  }
  return { modelo: bruto.trim() };
}

/**
 * Os argumentos do CLI, sem shell: o modelo vai em `--model`, o resto é a tranca de sempre.
 * @param {string} modelo
 * @param {readonly string[]} proibidas
 * @param {string} [esforco]
 * @returns {string[]}
 */
export function argumentosDoCli(modelo, proibidas, esforco) {
  if (!MODELOS_DA_PONTE.includes(modelo)) throw new Error(`modelo fora da lista da ponte: ${modelo}`);
  return [
    '-p',
    '--model', modelo,
    // O esforço da função (o cadastro) chega ao CLI; valor fora da lista é ignorado.
    ...(esforco && ESFORCOS_DA_PONTE.includes(esforco) ? ['--effort', esforco] : []),
    '--output-format', 'text',
    '--tools', '',
    '--disallowedTools', ...proibidas,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
}
