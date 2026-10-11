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
 * O número de consultas não cresce com o de produtos: duas para as reposições
 * e, para cada tipo de remessa, uma que acha os produtos candidatos e algumas
 * que andam da remessa mais nova para a mais antiga em blocos que dobram de
 * tamanho, parando quando todo candidato achou o seu lote. O `distinct` do
 * Prisma faria o mesmo trazendo todo o histórico de itens para a memória.
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

const DADOS_DO_LOTE = { id: true, codigo: true, fabricadoEm: true, validadeEm: true, origem: true } as const;

type LoteLido = { id: string; codigo: string; fabricadoEm: Date | null; validadeEm: Date; origem: string };

const BLOCO_INICIAL = 20;

function vigente(lote: LoteLido, repostoEm: Date, presumido: boolean): TotemLoteVigente {
  return {
    loteId: lote.id,
    codigo: lote.codigo,
    fabricadoEm: lote.fabricadoEm,
    validadeEm: lote.validadeEm,
    repostoEm,
    presumido,
    origem: lote.origem === 'manual_loja' ? 'manual_loja' : 'producao_central',
  };
}

/** `produtoIds` ausente = todos os produtos com algum lote na loja. */
export async function loteVigentePorProduto(
  tx: ClienteDoLoteVigente,
  lojaId: string,
  produtoIds?: readonly string[],
): Promise<Map<string, TotemLoteVigente>> {
  const mapa = new Map<string, TotemLoteVigente>();
  if (produtoIds && produtoIds.length === 0) return mapa;
  const doProduto = produtoIds ? { produtoId: { in: [...new Set(produtoIds)] } } : {};

  const ultimas = await tx.totemReposicao.groupBy({
    by: ['produtoId'],
    where: { lojaId, ...doProduto },
    _max: { repostoEm: true },
  });
  if (ultimas.length > 0) {
    const reposicoes = await tx.totemReposicao.findMany({
      where: {
        lojaId,
        OR: ultimas.flatMap((u) => (u._max.repostoEm ? [{ produtoId: u.produtoId, repostoEm: u._max.repostoEm }] : [])),
      },
      orderBy: [{ repostoEm: 'desc' }, { criadoEm: 'desc' }, { id: 'desc' }],
      select: { produtoId: true, repostoEm: true, lote: { select: DADOS_DO_LOTE } },
    });
    for (const r of reposicoes) {
      if (!mapa.has(r.produtoId)) mapa.set(r.produtoId, vigente(r.lote, r.repostoEm, false));
    }
  }

  const remessas = await tx.totemRemessa.findMany({
    where: { lojaId, status: { in: ['recebida', 'enviada'] } },
    select: { id: true, status: true, enviadaEm: true, recebidaEm: true },
  });
  const recebidas = remessas
    .filter((r) => r.status === 'recebida')
    .map((r) => ({ id: r.id, data: r.recebidaEm ?? r.enviadaEm }));
  const enviadas = remessas.filter((r) => r.status === 'enviada').map((r) => ({ id: r.id, data: r.enviadaEm }));

  await completarPelasRemessas(tx, mapa, lojaId, 'recebida', recebidas, doProduto, false);
  await completarPelasRemessas(tx, mapa, lojaId, 'enviada', enviadas, doProduto, true);
  return mapa;
}

async function completarPelasRemessas(
  tx: ClienteDoLoteVigente,
  mapa: Map<string, TotemLoteVigente>,
  lojaId: string,
  status: 'recebida' | 'enviada',
  remessas: { id: string; data: Date }[],
  doProduto: { produtoId?: { in: string[] } },
  presumido: boolean,
): Promise<void> {
  if (remessas.length === 0) return;
  const candidatos = await tx.totemRemessaItem.groupBy({
    by: ['produtoId'],
    where: { ...doProduto, remessa: { is: { lojaId, status } } },
  });
  const faltando = new Set(candidatos.map((c) => c.produtoId).filter((id) => !mapa.has(id)));
  if (faltando.size === 0) return;

  const ordenadas = [...remessas].sort((a, b) => b.data.getTime() - a.data.getTime() || (a.id < b.id ? 1 : -1));
  const posicao = new Map(ordenadas.map((r, i) => [r.id, i]));
  const dataDa = new Map(ordenadas.map((r) => [r.id, r.data]));

  let inicio = 0;
  let bloco = BLOCO_INICIAL;
  while (faltando.size > 0 && inicio < ordenadas.length) {
    const ids = ordenadas.slice(inicio, inicio + bloco).map((r) => r.id);
    inicio += bloco;
    bloco *= 2;
    const itens = await tx.totemRemessaItem.findMany({
      where: { remessaId: { in: ids }, produtoId: { in: [...faltando] } },
      select: { produtoId: true, remessaId: true, lote: { select: DADOS_DO_LOTE } },
    });
    // Remessa mais nova primeiro; dois lotes do mesmo produto na mesma remessa:
    // vale o de validade mais curta, que é o que não pode passar despercebido.
    itens.sort(
      (a, b) =>
        (posicao.get(a.remessaId) ?? 0) - (posicao.get(b.remessaId) ?? 0) ||
        a.lote.validadeEm.getTime() - b.lote.validadeEm.getTime(),
    );
    for (const item of itens) {
      if (!faltando.has(item.produtoId)) continue;
      mapa.set(item.produtoId, vigente(item.lote, dataDa.get(item.remessaId) ?? new Date(0), presumido));
      faltando.delete(item.produtoId);
    }
  }
}
