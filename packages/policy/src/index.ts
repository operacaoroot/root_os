/*
 * Motor de política do ROOT OS — a régua R0–R5.
 *
 * `escada.ts` é CÓPIA BYTE A BYTE de HANDOFF-DEV/anexos/politica.ts, e
 * `politica-root.json` de HANDOFF-DEV/anexos/politica-root.json. Os dois são
 * normativos: mudou o documento, muda aqui, no mesmo commit — e o teste
 * reprova quando divergem. Nunca edite escada.ts junto com outra coisa.
 *
 * O pacote é puro: sem I/O, sem Nest, sem Prisma. Quem carrega, cacheia e
 * persiste decisão é apps/api/src/policy — a casca. É isso que permite o
 * mesmo código decidir no painel, no MCP e no simulador da tela da Régua.
 */
export * from './escada.js';
export * from './esquema.js';
export * from './verificacao.js';
