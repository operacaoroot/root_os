import { bytesUtf8 } from '@mktos/shared';

/*
 * LOTES DE EMBEDDING, E A BUSCA QUE NÃO SOME QUANDO FALTA VETOR (P1b).
 *
 * Arquivo puro: não lê variável de ambiente, não conhece endereço nem chave e
 * não abre conexão. Quem fala com o fornecedor continua sendo o `embed` de
 * `obsidian.service.ts` e o de `pauta.service.ts`, as duas exceções declaradas
 * na catraca de arquitetura. Daqui saem três regras que os dois dividem: quanto
 * vai em cada pedido, o que fazer quando um pedido falha e como juntar o
 * resultado semântico com o textual.
 *
 * ----------------------------------------------------------------------------
 * OS TETOS SÃO EM BYTES DE UTF-8, E É ISSO QUE OS TORNA GARANTIA
 * ----------------------------------------------------------------------------
 * O fornecedor limita em TOKENS: 8.192 por entrada, até 2.048 entradas e
 * 300.000 tokens somados por pedido (docstring de `embeddings.create` no SDK
 * oficial, `openai/openai-python`, lida em 01/10/2026). O modelo usado nos dois
 * serviços tokeniza com o `cl100k_base`, um BPE que trabalha sobre bytes: cada
 * token cobre pelo menos um byte, então um texto nunca tem mais tokens do que
 * bytes. Contar bytes não estima tokens. Dá um teto que vale para qualquer
 * texto, inclusive emoji e escrita fora do alfabeto latino, sem tokenizador no
 * código. Antes deste arquivo, a reindexação mandava todos os textos num pedido
 * só, e o tamanho do pedido crescia com a vault.
 */
export const LIMITES_DE_EMBEDDING = {
  /** Por texto: o mesmo 8.000 que o corte já usava, agora em bytes, 192 abaixo de 8.192. */
  bytesPorTexto: 8_000,
  /** Por pedido: dois terços dos 300.000 somados. Com o teto por texto, cabem 25 textos cheios. */
  bytesPorPedido: 200_000,
  /** Por pedido: longe das 2.048 entradas, e limita o que um pedido recusado leva junto. */
  textosPorPedido: 100,
  /**
   * Pedidos recusados por conteúdo que uma chamada aceita; a recusa seguinte a
   * encerra. Oito é o que a bisseção de um lote cheio gasta para isolar um texto:
   * 100 → 50 → 25 → 13 → 7 → 4 → 2 → 1.
   */
  recusasPorChamada: 8,
} as const;

export type LimitesDeEmbedding = { -readonly [K in keyof typeof LIMITES_DE_EMBEDDING]: number };

/** Prazo de um pedido de lote. Sem ele, um fornecedor pendurado segura a reindexação inteira. */
export const PRAZO_DO_LOTE_MS = 60_000;

/** Prazo do vetor da pergunta. Passou disso, a busca segue por texto em vez de esperar. */
export const PRAZO_DA_BUSCA_MS = 10_000;

/** Falha de um pedido de embedding. `status` é o HTTP; nulo quando não houve resposta que sirva. */
export class FalhaDeEmbedding extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = 'FalhaDeEmbedding';
  }
}

/**
 * Recusa que depende do CONTEÚDO do pedido: o mesmo texto em outro recorte pode
 * passar. Todo o resto (sem rede, prazo vencido, chave, cota, 5xx, resposta
 * torta) é do fornecedor ou da conta, e insistir na mesma chamada só gasta.
 */
function recusouOConteudo(e: unknown): boolean {
  return e instanceof FalhaDeEmbedding && (e.status === 400 || e.status === 413 || e.status === 422);
}

/**
 * O texto que vai ao fornecedor: no máximo `maxBytes` de UTF-8, cortado entre
 * caracteres. O `slice(0, 8000)` de antes contava unidades de UTF-16, então
 * podia partir um emoji e mandar meio par substituto, e 8.000 unidades de emoji
 * são 16.000 bytes. Meio par que já venha no texto vira U+FFFD, que é o que um
 * codificador de UTF-8 faria com ele.
 */
export function cortarParaEmbedding(
  texto: string,
  maxBytes: number = LIMITES_DE_EMBEDDING.bytesPorTexto,
): string {
  let saida = '';
  let bytes = 0;
  for (const c of texto) {
    const ponto = c.codePointAt(0) ?? 0;
    const caractere = ponto >= 0xd800 && ponto <= 0xdfff ? '\uFFFD' : c;
    const n = bytesUtf8(caractere);
    if (bytes + n > maxBytes) break;
    saida += caractere;
    bytes += n;
  }
  return saida;
}

/**
 * Agrupa textos em lotes, na ordem, sem passar de `textosPorPedido` nem de
 * `bytesPorPedido`. Recebe o tamanho em bytes de cada texto (já cortado, logo
 * cada um cabe sozinho num lote) e devolve as posições de cada lote.
 */
export function montarLotes(
  tamanhos: number[],
  limites: Pick<LimitesDeEmbedding, 'bytesPorPedido' | 'textosPorPedido'> = LIMITES_DE_EMBEDDING,
): number[][] {
  const lotes: number[][] = [];
  let atual: number[] = [];
  let bytes = 0;
  tamanhos.forEach((n, i) => {
    if (atual.length && (atual.length >= limites.textosPorPedido || bytes + n > limites.bytesPorPedido)) {
      lotes.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(i);
    bytes += n;
  });
  if (atual.length) lotes.push(atual);
  return lotes;
}

/**
 * Os vetores de uma resposta, conferidos antes de qualquer gravação. Vetor fora
 * de lugar é pior do que vetor nenhum: a nota passaria a ser achada pelo
 * significado de outra. Com `index` em todos os itens, a ordem vem dele; sem
 * ele, vale a ordem da lista.
 */
export function vetoresDaResposta(corpo: unknown, esperados: number): number[][] {
  const dados = (corpo as { data?: unknown } | null)?.data;
  if (!Array.isArray(dados) || dados.length !== esperados) {
    throw new FalhaDeEmbedding(
      `a resposta trouxe ${Array.isArray(dados) ? dados.length : 'nenhum'} vetor(es) para ` +
        `${esperados} texto(s)`,
    );
  }
  const itens = dados as Array<{ index?: unknown; embedding?: unknown }>;
  const comIndice = itens.every((d) => Number.isInteger(d?.index));
  const ordenados = comIndice ? [...itens].sort((a, b) => Number(a.index) - Number(b.index)) : itens;
  if (comIndice && ordenados.some((d, i) => d.index !== i)) {
    throw new FalhaDeEmbedding('a resposta trouxe índices repetidos ou fora da faixa');
  }
  const vetores = ordenados.map((d) => d?.embedding);
  const dimensao = Array.isArray(vetores[0]) ? vetores[0].length : 0;
  const valido = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length === dimensao && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!dimensao || !vetores.every(valido)) {
    throw new FalhaDeEmbedding('a resposta trouxe vetor vazio, com número inválido ou de tamanho diferente');
  }
  return vetores as number[][];
}

/** O que uma chamada de `vetorizarEmLotes` fez. É daqui que sai o recibo, nunca de uma suposição. */
export interface ResultadoDaVetorizacao {
  /** Um por texto, na ordem da entrada. `null` é texto que ficou sem vetor nesta chamada. */
  vetores: Array<number[] | null>;
  textos: number;
  vetorizados: number;
  semVetor: number;
  pedidos: number;
  /** Pedidos recusados por conteúdo (400, 413, 422). */
  recusados: number;
  /** A última falha vista. Nulo quando todo texto recebeu vetor. */
  motivo: string | null;
}

/**
 * Vetoriza em lotes, um pedido por vez, e grava cada lote assim que ele volta.
 *
 * POLÍTICA DE FALHA, que é também a de custo:
 *  · nenhum pedido é repetido como está. Falha do fornecedor ou da conta (sem
 *    rede, prazo, 401, 403, 404, 429, 5xx, resposta torta) PARA a chamada: os
 *    lotes seguintes nem saem, e os textos sem vetor ficam para a próxima
 *    chamada. Quem chama de novo é o cron da vault (`OBSIDIAN_REINDEX_MIN`,
 *    30 min) ou uma pessoa, então o ritmo de tentativas é o do relógio.
 *  · recusa por conteúdo (400, 413, 422) parte o lote ao meio e tenta as
 *    metades, até `recusasPorChamada` recusas. Um texto que o fornecedor não
 *    aceita fica sozinho sem vetor, em vez de prender os outros 99 do lote.
 *  · gravação que falha também para: vetor pago e não guardado volta a ser
 *    pedido na próxima chamada, então não adianta pedir mais.
 *  · texto em branco não é enviado (o fornecedor recusa entrada vazia).
 *
 * O fornecedor cobra por token processado. O teto do que uma chamada pode
 * custar é a soma dos bytes dos textos que receberam vetor, nunca mais de
 * `bytesPorTexto` por texto.
 */
export async function vetorizarEmLotes(
  textos: string[],
  enviar: (lote: string[]) => Promise<number[][]>,
  opcoes: {
    gravar?: (indices: number[], vetores: number[][]) => Promise<void>;
    limites?: Partial<LimitesDeEmbedding>;
  } = {},
): Promise<ResultadoDaVetorizacao> {
  const limites: LimitesDeEmbedding = { ...LIMITES_DE_EMBEDDING, ...opcoes.limites };
  const cortados = textos.map((t) => cortarParaEmbedding(t, limites.bytesPorTexto));
  const vetores: Array<number[] | null> = textos.map(() => null);
  const enviaveis = cortados.flatMap((t, i) => (t.trim() ? [i] : []));
  const fila = montarLotes(
    enviaveis.map((i) => bytesUtf8(cortados[i])),
    limites,
  ).map((lote) => lote.map((posicao) => enviaveis[posicao]));

  let pedidos = 0;
  let recusados = 0;
  let motivo: string | null =
    enviaveis.length < textos.length
      ? `${textos.length - enviaveis.length} texto(s) em branco não foram enviados`
      : null;

  while (fila.length) {
    const lote = fila.shift()!;
    pedidos++;
    let recebidos: number[][];
    try {
      recebidos = await enviar(lote.map((i) => cortados[i]));
      if (recebidos.length !== lote.length) {
        throw new FalhaDeEmbedding(`o envio devolveu ${recebidos.length} vetor(es) para ${lote.length} texto(s)`);
      }
    } catch (e) {
      motivo = (e as Error).message;
      if (!recusouOConteudo(e)) break;
      if (++recusados > limites.recusasPorChamada) break;
      if (lote.length > 1) {
        const meio = Math.ceil(lote.length / 2);
        fila.unshift(lote.slice(0, meio), lote.slice(meio));
      }
      continue;
    }
    try {
      await opcoes.gravar?.(lote, recebidos);
    } catch (e) {
      motivo = `o vetor chegou e não foi gravado (${(e as Error).message})`;
      break;
    }
    lote.forEach((i, k) => (vetores[i] = recebidos[k]));
  }

  const vetorizados = vetores.filter((v) => v !== null).length;
  return {
    vetores,
    textos: textos.length,
    vetorizados,
    semVetor: textos.length - vetorizados,
    pedidos,
    recusados,
    motivo: vetorizados === textos.length ? null : motivo,
  };
}

/** Uma linha para log e recibo, com o número que falta quando falta. */
export function descreverVetorizacao(r: ResultadoDaVetorizacao): string {
  const feito = `${r.vetorizados} de ${r.textos} texto(s) vetorizado(s) em ${r.pedidos} pedido(s)`;
  return r.semVetor ? `${feito}; ${r.semVetor} ficaram sem vetor (${r.motivo ?? 'motivo não informado'})` : feito;
}

/**
 * A BUSCA SEMÂNTICA SÓ ENXERGA LINHA COM VETOR. Com a cobertura parcial, uma
 * nota sem vetor que contém exatamente o texto pedido ficava de fora, e com
 * cobertura zero a busca voltava vazia. Esta função junta ao resultado
 * semântico o textual das linhas SEM vetor.
 *
 * Quantos de cada: alternando, a partir do semântico (s, t, s, t…), e quando
 * uma lista acaba a outra completa o limite. Na saída vem primeiro o bloco
 * semântico, na ordem de similaridade, depois o textual, e por isso a nota de
 * cada item continua decrescente. Com cobertura total o textual chega vazio e o
 * resultado é exatamente o semântico de antes. O mesmo `id` nunca sai duas vezes.
 */
export function mesclarComTextuais<T extends { id: string }>(
  semanticos: T[],
  textuais: T[],
  limite: number,
): T[] {
  const vistos = new Set<string>();
  const unicos = (lista: T[]) => lista.filter((x) => !vistos.has(x.id) && vistos.add(x.id));
  const sem = unicos(semanticos);
  const tex = unicos(textuais);
  let s = 0;
  let t = 0;
  while (s + t < limite && (s < sem.length || t < tex.length)) {
    if (s < sem.length && (s <= t || t >= tex.length)) s++;
    else t++;
  }
  return [...sem.slice(0, s), ...tex.slice(0, t)];
}
