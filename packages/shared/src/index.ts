export * from './permissions.js';
export * from './schemas.js';
export * from './modules.js';
export * from './nav.js';
// A conta das horas devolvidas mora aqui porque ela tem DOIS donos — `/rotinas`
// e `/agentes` —, e enquanto tinha duas casas tinha duas respostas. Ver o
// cabeçalho de `horas-devolvidas.ts`.
export * from './horas-devolvidas.js';

// O padrão de nomenclatura da agenda da Root (`Reunião Online - Cliente -
// Responsável`). Mora no shared porque a tela monta, a API escreve e a leitura
// desmonta o MESMO título — ver o cabeçalho de `agenda.ts`.
export * from './agenda.js';

// A regra do valor monetário do Trabalho mora aqui porque a tela, a API e o
// importador do ClickUp convertem e conferem o MESMO texto canônico — ver o
// cabeçalho de `valor-monetario.ts`.
export * from './valor-monetario.js';
export * from './metas-do-mes.js';

// Nome padrão; cada app pode sobrescrever via seu próprio env (APP_NAME).
export const DEFAULT_APP_NAME = 'Marketing OS';

// A entrada idempotente de lead (ROOT-48, C-01): a tela, a API e o teste leem o
// MESMO pedido — ver o cabeçalho de `lead-entrada.ts`.
export * from './lead-entrada.js';
// A proposta e o aceite comercial (ROOT-49, C-03): ver o cabeçalho de `lead-proposta.ts`.
export * from './lead-proposta.js';
export * from './comercial-exercicio';
export * from './fonte-autorizada.js';

export * from './comercial-ponte-exercicio.js';
export * from './catalogo-de-colecao.js';
export * from './brandbook.js';
