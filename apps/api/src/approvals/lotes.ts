import { createHash } from 'node:crypto';
import type { AprovacaoDaCapacidade, CapacidadeCatalogo } from '@mktos/policy';
import { canonizar } from '../gateway/event-log.service';

/*
 * A parte PURA da aprovação de lote (MD7): o hash da lista, a conferência do
 * catálogo e a leitura do `loteItemId`. Sem banco e sem Nest, para a porta, o
 * serviço e o teste chamarem a MESMA função.
 */

/** O `loteItemId` é da porta, não do conteúdo: sai antes da validação e do hash. */
export const CAMPO_DO_ITEM_DE_LOTE = 'loteItemId';

/** Um item como ele entra no hash da lista. As datas vão em ISO. */
export interface ItemParaOHash {
  capabilityId: string;
  recursoId: string;
  hashItem: string;
  janelaDe: string;
  janelaAte: string;
  usoMaximo: number;
  tetoPorDia: number | null;
}

/**
 * A ordem da lista é parte do que se assina: pela janela, depois capacidade e
 * recurso. Ordenar aqui, e não confiar na ordem de quem montou, é o que faz o
 * mesmo conjunto de itens dar o mesmo hash no pedido e na conferência.
 */
export function ordenarItens<T extends ItemParaOHash>(itens: readonly T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      a.janelaDe.localeCompare(b.janelaDe) ||
      a.capabilityId.localeCompare(b.capabilityId) ||
      a.recursoId.localeCompare(b.recursoId),
  );
}

/**
 * O `hashConteudo` do lote: sha256 da lista ordenada, com o prazo e a
 * capacidade que assina. Usa `canonizar` do RASTRO, a mesma serialização do
 * `canonicalHash` das aprovações comuns — duas fórmulas para a mesma ideia
 * divergiriam um dia.
 */
export function hashDoLote(entrada: { capabilityId: string; validaAte: string; itens: readonly ItemParaOHash[] }): string {
  const corpo = {
    capacidade: entrada.capabilityId,
    validaAte: entrada.validaAte,
    itens: ordenarItens(entrada.itens).map((i) => ({
      capabilityId: i.capabilityId,
      recursoId: i.recursoId,
      hashItem: i.hashItem,
      janelaDe: i.janelaDe,
      janelaAte: i.janelaAte,
      usoMaximo: i.usoMaximo,
      tetoPorDia: i.tetoPorDia,
    })),
  };
  return createHash('sha256').update(`lote:${canonizar(corpo)}`).digest('hex');
}

/** O modo de aprovação que a capacidade declara no catálogo, ou nulo (uso único). */
export function modoDeAprovacao(cap: unknown): AprovacaoDaCapacidade | null {
  const a = (cap as Pick<CapacidadeCatalogo, 'aprovacao'> | null)?.aprovacao;
  return a && (a.modo === 'lote' || a.modo === 'sob_lote') ? a : null;
}

/**
 * Separa o `loteItemId` dos argumentos. `presente` distingue "não veio" de
 * "veio vazio ou com tipo errado" — o segundo é recusa, nunca caminho comum.
 */
export function separarItemDeLote(args: Record<string, unknown> | null | undefined): {
  presente: boolean;
  loteItemId: string | null;
  conteudo: Record<string, unknown>;
} {
  const a = args ?? {};
  if (!Object.prototype.hasOwnProperty.call(a, CAMPO_DO_ITEM_DE_LOTE)) {
    return { presente: false, loteItemId: null, conteudo: a };
  }
  const { [CAMPO_DO_ITEM_DE_LOTE]: bruto, ...conteudo } = a;
  const valido = typeof bruto === 'string' && bruto.trim() !== '' && bruto.length <= 64;
  return { presente: true, loteItemId: valido ? bruto : null, conteudo };
}

/** O estado do contador, como vai ao RASTRO em `estadoAnterior`/`estadoNovo`. */
export interface ContadorDoItem {
  usos: number;
  usoMaximo: number;
  dia?: string | null;
  usosNoDia?: number;
}

/**
 * Por que o consumo não passou — lido DEPOIS da instrução que recusou, só para
 * a frase. A decisão já foi tomada pela escrita condicional; isto nunca a muda.
 */
export function motivoDaRecusaDoItem(
  item: {
    capabilityId: string;
    recursoId: string;
    estado: string;
    janelaDe: Date;
    janelaAte: Date;
    usos: number;
    usoMaximo: number;
    hashItem: string;
    tetoPorDia: number | null;
    usosNoDia: number;
    diaDoContador: string | null;
    lote: { estado: string; validaAte: Date; capabilityId: string };
  } | null,
  pedido: { capabilityId: string; recursoId: string; hashAtual: string; loteDaCapacidade: string; agora: Date; hoje: string },
): string {
  if (!item) return 'o item de lote não existe nesta empresa';
  if (item.capabilityId !== pedido.capabilityId) return `o item é de "${item.capabilityId}", não de "${pedido.capabilityId}"`;
  if (item.lote.capabilityId !== pedido.loteDaCapacidade) return `o lote é de "${item.lote.capabilityId}", e esta capacidade só aceita "${pedido.loteDaCapacidade}"`;
  if (item.recursoId !== pedido.recursoId) return 'o item é de outro recurso';
  // Antes do estado do lote: o lote de um item só fica `encerrado` porque o item foi usado.
  if (item.usos >= item.usoMaximo) return `o item já foi usado ${item.usos} de ${item.usoMaximo} vez(es)`;
  if (item.lote.estado !== 'ativo') return `o lote está ${item.lote.estado}`;
  if (item.lote.validaAte.getTime() <= pedido.agora.getTime()) return 'o lote venceu';
  if (item.estado !== 'ativo') return `o item está ${item.estado}`;
  if (item.hashItem !== pedido.hashAtual) return 'o conteúdo difere do que foi assinado no lote';
  if (pedido.agora < item.janelaDe || pedido.agora > item.janelaAte) return 'fora da janela do item';
  if (item.tetoPorDia !== null && item.diaDoContador === pedido.hoje && item.usosNoDia >= item.tetoPorDia) {
    return `o teto do dia (${item.tetoPorDia}) foi atingido`;
  }
  return 'o item mudou enquanto era consumido';
}
