/*
 * Motor de política do ROOT OS — a régua R0–R5.
 *
 * `escada.ts` é CÓPIA BYTE A BYTE de HANDOFF-DEV/anexos/politica.ts, e
 * `politica-root.json` de HANDOFF-DEV/anexos/politica-root.json. Os dois são
 * normativos: mudou o documento, muda aqui, no mesmo commit — e o teste
 * reprova quando divergem. Nunca edite escada.ts junto com outra coisa.
 *
 * DIVERGÊNCIA ABERTA desde 10/09/2026 (fatia 2.2): `politica-root.json` saiu
 * na frente do anexo. Os três R2 que prometiam um desfazer inexistente
 * (clickup.tarefa.criar, crm.lead.criar, agenda.evento.criar) viraram R3 com
 * reversibilidade manual, e o arquivo foi para 1.1.0. O anexo do vault e a
 * tabela do 04-ESCADA-R0-R5.md ainda dizem R2 — a cópia de volta é manual e
 * está pendente. `escada.ts` continua byte a byte: nada nele mudou.
 *
 * O pacote é puro: sem I/O, sem Nest, sem Prisma. Quem carrega, cacheia e
 * persiste decisão é apps/api/src/policy — a casca. É isso que permite o
 * mesmo código decidir no painel, no MCP e no simulador da tela da Régua.
 *
 * ONDE A POLÍTICA DE VERDADE MORA, EM AMBIENTE JÁ SEMEADO
 * Estes JSON são o CHÃO, não a palavra final. `PolicyService.recarregar()`
 * prefere a `PolicyVersion` gravada no banco à base empacotada aqui — então
 * mudar um nível neste arquivo NÃO muda o comportamento de uma instalação que
 * já rodou o seed, até alguém rodar `pnpm --filter @mktos/api db:seed:politica`
 * naquela instalação. É o único caminho de surpresa real desta área: o código
 * dizendo R3 e a produção decidindo R2.
 */
export * from './escada.js';
export * from './esquema.js';
export * from './verificacao.js';
export * from './sobrescrita.js';
