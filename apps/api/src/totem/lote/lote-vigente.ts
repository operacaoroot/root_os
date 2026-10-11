import type { Prisma } from '@prisma/client';
import type { TotemOrigemLote } from '@mktos/shared';

/*
 * O LOTE VIGENTE DE CADA PRODUTO NUMA LOJA (CONTRATO.md, seção 4).
 *
 * Função única: o catálogo do quiosque, a página da etiqueta e as pendências do
 * painel leem daqui, para os três nunca discordarem sobre qual lote está na
 * prateleira. A ordem de decisão:
 *   1. a `TotemReposicao` mais recente da loja e do produto (`presumido=false`);
 *   2. o item da `TotemRemessa` `recebida` mais recente (`presumido=false`,
 *      `repostoEm` = `recebidaEm`);
 *   3. o item da `TotemRemessa` `enviada` mais recente (`presumido=true`,
 *      `repostoEm` = `enviadaEm`).
 * Produto sem nenhum dos três fica fora do mapa, e o painel o lista como
 * pendência.
 *
 * CORPO PROVISÓRIO DA BASE: devolve o mapa vazio. A frente C escreve a consulta
 * e mantém a assinatura.
 */

export interface TotemLoteVigente {
  loteId: string;
  codigo: string;
  fabricadoEm: Date | null;
  validadeEm: Date;
  repostoEm: Date;
  /** `true` só no caso 3: a remessa saiu do CD e a loja ainda não confirmou. */
  presumido: boolean;
  /** A coluna `TotemLote.origem`. */
  origem: TotemOrigemLote;
}

export type ClienteDoLoteVigente = Pick<
  Prisma.TransactionClient,
  'totemReposicao' | 'totemRemessa' | 'totemRemessaItem' | 'totemLote'
>;

/** `produtoIds` ausente = todos os produtos com algum lote na loja. */
export async function loteVigentePorProduto(
  tx: ClienteDoLoteVigente,
  lojaId: string,
  produtoIds?: readonly string[],
): Promise<Map<string, TotemLoteVigente>> {
  void tx;
  void lojaId;
  void produtoIds;
  return new Map();
}
