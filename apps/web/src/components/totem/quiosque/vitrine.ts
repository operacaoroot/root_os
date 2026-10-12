import {
  totemEhUrlDeMidia,
  type TotemCatalogo,
  type TotemCatalogoCampanha,
  type TotemCatalogoConfig,
  type TotemCatalogoProduto,
  type TotemNutriente,
} from '@mktos/shared';

/*
 * A lógica da vitrine do quiosque sem React: banners, ficha e pré-carga das
 * imagens. Fica aqui para o teste unitário alcançar sem montar tela.
 */

/** A ficha e a etiqueta já escrevem "Alergênicos:"; o rótulo digitado junto com o aviso sairia em dobro. */
export function semRotuloDeAlergenicos(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim().replace(/^(?:al[ée]rgicos|alerg[êe]nicos)\s*:\s*/iu, '');
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : null;
}

/** Texto em branco no produto conta como "não tem" e cai no aviso padrão da loja. */
export function alergenicosEfetivos(
  produto: Pick<TotemCatalogoProduto, 'alergenicos'>,
  config: Pick<TotemCatalogoConfig, 'alergenicosPadrao'>,
): string | null {
  return semRotuloDeAlergenicos(produto.alergenicos) ?? semRotuloDeAlergenicos(config.alergenicosPadrao);
}

/** Os produtos do banner na ordem escolhida no painel; id fora do catálogo some. */
export function produtosDaCampanha(
  campanha: Pick<TotemCatalogoCampanha, 'produtoIds'>,
  produtos: readonly TotemCatalogoProduto[],
): TotemCatalogoProduto[] {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const vistos = new Set<string>();
  const lista: TotemCatalogoProduto[] = [];
  for (const id of campanha.produtoIds) {
    const p = porId.get(id);
    if (!p || vistos.has(id)) continue;
    vistos.add(id);
    lista.push(p);
  }
  return lista;
}

export function proximoIndice(atual: number, total: number): number {
  return total > 0 ? (atual + 1) % total : 0;
}

export function indiceAnterior(atual: number, total: number): number {
  return total > 0 ? (atual - 1 + total) % total : 0;
}

/** O índice que continua valendo depois que a sincronia encolhe a lista. */
export function indiceSeguro(atual: number, total: number): number {
  if (total <= 0 || !Number.isFinite(atual) || atual < 0) return 0;
  return Math.min(Math.trunc(atual), total - 1);
}

/** Para onde o arrasto leva: passou de um quinto da largura, troca de banner. */
export function destinoDoArrasto(atual: number, total: number, deslocamento: number, largura: number): number {
  if (total <= 1 || largura <= 0 || Math.abs(deslocamento) < largura / 5) return atual;
  return deslocamento < 0 ? proximoIndice(atual, total) : indiceAnterior(atual, total);
}

export function inicialDoNome(nome: string): string {
  const letra = nome.match(/[\p{L}\p{N}]/u)?.[0];
  return letra ? letra.toLocaleUpperCase('pt-BR') : '?';
}

/*
 * O fundo de quem não tem foto. São três combinações da marca e o nome
 * escolhe uma, para a grade não virar um bloco da mesma cor e o mesmo produto
 * aparecer sempre igual. `tinta` é o acento (inicial, categoria, retícula);
 * `texto` é o do nome, com contraste de leitura a um metro.
 */
export const FUNDOS_DA_MARCA = [
  { fundo: '#28371D', tinta: '#CB8139', texto: '#F5F3EC' },
  { fundo: '#54331B', tinta: '#EEEAC4', texto: '#F5F3EC' },
  { fundo: '#CB8139', tinta: '#16200F', texto: '#16200F' },
] as const;
export type FundoDaMarca = (typeof FUNDOS_DA_MARCA)[number];

export function fundoDaMarca(semente: string): FundoDaMarca {
  let h = 0;
  for (const c of semente) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return FUNDOS_DA_MARCA[h % FUNDOS_DA_MARCA.length]!;
}

/*
 * IN 75/2020: nutriente sem valor diário de referência leva "**" na coluna
 * %VD. A coluna só existe quando algum nutriente tem VD; sem ela não há o que
 * marcar.
 */
export function temVdNaoEstabelecido(nutricional: readonly Pick<TotemNutriente, 'vd'>[]): boolean {
  return nutricional.some((n) => n.vd != null) && nutricional.some((n) => n.vd == null);
}

/**
 * As imagens que o aparelho guarda para mostrar sem rede: banners primeiro
 * (são a primeira coisa na tela), depois o logo e as fotos dos produtos. Só
 * entram as da rota de mídia da própria API; endereço externo o service worker
 * não guarda.
 */
export function urlsDeImagemDoCatalogo(catalogo: Pick<TotemCatalogo, 'campanhas' | 'config' | 'produtos'>): string[] {
  const urls = new Set<string>();
  const juntar = (url: string | null | undefined) => {
    if (url && totemEhUrlDeMidia(url)) urls.add(url);
  };
  for (const c of catalogo.campanhas ?? []) juntar(c.imagemUrl);
  juntar(catalogo.config.logoUrl);
  for (const p of catalogo.produtos) juntar(p.imagemUrl);
  return [...urls];
}

export interface OpcoesDaPreCarga {
  concorrencia?: number;
  /** As que já vieram numa sincronia anterior desta abertura; recebe as novas. */
  jaCarregadas?: Set<string>;
}

/**
 * Baixa as imagens poucas por vez, para a pré-carga não disputar a rede com o
 * catálogo e os eventos. Falha não interrompe: a imagem que não veio tenta de
 * novo na próxima sincronia. Devolve quantas vieram agora.
 */
export async function preCarregar(
  urls: readonly string[],
  carregar: (url: string) => Promise<unknown>,
  { concorrencia = 3, jaCarregadas }: OpcoesDaPreCarga = {},
): Promise<number> {
  const fila = [...new Set(urls)].filter((u) => !jaCarregadas?.has(u));
  let proxima = 0;
  let carregadas = 0;
  const trabalhador = async () => {
    while (proxima < fila.length) {
      const url = fila[proxima++]!;
      try {
        await carregar(url);
        jaCarregadas?.add(url);
        carregadas++;
      } catch {
        /* fica para a próxima sincronia */
      }
    }
  };
  const vagas = Math.max(1, Math.min(Math.trunc(concorrencia) || 1, fila.length));
  await Promise.all(Array.from({ length: vagas }, trabalhador));
  return carregadas;
}
