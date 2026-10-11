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

// O módulo Totem (docs/totem/CONTRATO.md). Um arquivo por frente, para que as
// quatro construam em paralelo sem editar o mesmo lugar.
export * from './totem/comum.js';
export * from './totem/gestao.js';
export * from './totem/publico.js';
export * from './totem/lote.js';
export * from './totem/cadastro.js';
export * from './totem/politica.js';

// Nome padrão; cada app pode sobrescrever via seu próprio env (APP_NAME).
export const DEFAULT_APP_NAME = 'Marketing OS';
