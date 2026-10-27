/*
 * O ARQUIVO DO CLICKUP (leva 5, L1, 27/10/2026).
 *
 * "O ClickUp não vai mais ser usado." As listas que vieram do espelho do ClickUp
 * (Gestão de Temas, Copy, Rotina de stories, Design & Gravação) continuam existindo,
 * com as mesmas tarefas, os mesmos status e os mesmos ids: a Produção do Marketing
 * ainda lê o status de algumas. O que muda é ONDE elas aparecem. Elas vão para a
 * pasta "Arquivo do ClickUp", dentro de Marketing, recolhida por padrão na árvore, e
 * saem de "Todas", das contagens e do Dia a dia. Os 18 status herdados deixam de
 * virar coluna vazia em "Todas": o quadro só une os status das listas fora do Arquivo.
 *
 * A marca é a coluna `arquivoDoClickUp` da pasta e da lista (migration
 * `20261027010000_arquivo_do_clickup`), o mesmo mecanismo de `doComercial`. A regra
 * de banco mora em `apps/api/src/work/arquivadas.ts`; o que a tela precisa saber
 * mora aqui. Quem move as listas e marca as colunas é o script
 * `deploy/layout/arquivo-do-clickup.js` (simula por padrão, `--valer` grava,
 * `--desfazer` volta). Nada é apagado.
 */

/** O nome da pasta que recebe as listas, dentro de Marketing. */
export const NOME_DA_PASTA_DO_ARQUIVO_DO_CLICKUP = 'Arquivo do ClickUp';

/** A pasta de topo que a guarda (P-50: pasta = área). */
export const NOME_DA_PASTA_MARKETING = 'Marketing';

/** As listas que a reunião de 26/10 mandou para o Arquivo, pelo nome (sem diferença de maiúscula, acento ou espaço). */
export const LISTAS_DO_ARQUIVO_DO_CLICKUP: readonly string[] = [
  'Gestão de Temas',
  'Copy',
  'Rotina de stories',
  'Design & Gravação',
];

/** O nome comparável: minúsculo, sem acento, sem espaço sobrando. */
export function chaveDoNomeDoArquivo(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

/** O `externalId` de uma lista importada do ClickUp é o id numérico de lá (ex.: 901327640001). */
export function ehIdDoClickUp(externalId: string | null | undefined): boolean {
  return typeof externalId === 'string' && /^\d{6,}$/.test(externalId);
}

/** O nome está na lista das que vão para o Arquivo? */
export function ehNomeDoArquivoDoClickUp(nome: string | null | undefined): boolean {
  const chave = chaveDoNomeDoArquivo(nome);
  return LISTAS_DO_ARQUIVO_DO_CLICKUP.some((n) => chaveDoNomeDoArquivo(n) === chave);
}

interface ComMarcaDoArquivo { arquivoDoClickUp?: boolean | null }

/** A lista ou a pasta é do Arquivo do ClickUp? (pela marca, nunca pelo nome) */
export function ehDoArquivoDoClickUp(x: ComMarcaDoArquivo | null | undefined): boolean {
  return !!x?.arquivoDoClickUp;
}

/**
 * As listas que entram no quadro de "Todas" (colunas e cartões): as de fora do Arquivo.
 * A API já tira as tarefas; a tela tira os status, para os herdados não virarem coluna vazia.
 */
export function listasForaDoArquivoDoClickUp<L extends ComMarcaDoArquivo>(listas: readonly L[]): L[] {
  return listas.filter((l) => !ehDoArquivoDoClickUp(l));
}

/** A frase da árvore para a pasta e as listas do Arquivo. */
export const TRAB_ARQUIVO_DO_CLICKUP =
  'Arquivo do ClickUp: as listas importadas ficam aqui, fora de Todas e do Dia a dia. As tarefas e os status continuam valendo para quem os lê.';

/** A marca que o script grava em `metadata.origem` da auditoria. */
export const ORIGEM_DO_ARQUIVO_DO_CLICKUP = 'script.arquivo-do-clickup';
