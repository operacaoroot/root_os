/*
 * A MARCA DA INSTÂNCIA.
 *
 * Uma imagem do ROOT OS pode vestir outra marca quando a instância é de um
 * cliente que usa só um módulo. A primeira é a do Sr. aGranel (12/10/2026): a
 * instância em sragranel.operacaoroot.com abre direto no login, com a identidade
 * do design system dele, e quem entra cai no painel do Totem.
 *
 * POR QUE É VARIÁVEL DE BUILD (`NEXT_PUBLIC_*`) E NÃO DE EXECUÇÃO: o login, a
 * lateral e o topo são componentes de cliente, e o título e as fontes moram no
 * layout raiz, que é estático. Uma variável lida só no servidor obrigaria a
 * tornar o layout dinâmico (o que muda o os.operacaoroot.com) ou mostraria a
 * marca ROOT por um instante antes de trocar. Inlinada no `next build`, a marca
 * já sai certa no primeiro byte. O preço é uma imagem por marca, e a do Sr.
 * aGranel já é construída à parte. Mesmo padrão de NEXT_PUBLIC_CENTRAL_PIXEL_KEY
 * (central/lib/analytics.ts).
 *
 * Vazia ou desconhecida, a marca é a ROOT e nada muda.
 */

export type IdDaMarca = 'root' | 'sragranel';

const PEDIDA = (process.env.NEXT_PUBLIC_MARCA ?? '').trim().toLowerCase();

export const MARCA: IdDaMarca = PEDIDA === 'sragranel' ? 'sragranel' : 'root';

export const EH_SRAGRANEL = MARCA === 'sragranel';

/** Para onde vai quem acabou de entrar. */
export const HOME = EH_SRAGRANEL ? '/totem-gestao' : '/painel';

/** O selo do Sr. aGranel tem 150px: não exibir acima de 75px até chegar o vetor. */
export const SELO_SRAGRANEL = '/totem/selo-sr-agranel-150.jpg';
