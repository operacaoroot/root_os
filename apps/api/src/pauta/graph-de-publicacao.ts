/*
 * O CLIENTE DA GRAPH QUE O PUBLICADOR RECEBE (MD6).
 *
 * O HTTP mora em `bio/plataformas/instagram.ts`, o único arquivo com o endereço
 * da Graph. O publicador (`publicacao-instagram.service.ts`) não importa o
 * conector: recebe este cliente por injeção, montado em
 * `bio/plataformas/publicacao.module.ts` — o `*.module.ts` da pasta do
 * conector, que é a fiação que a catraca de arquitetura permite. O token de
 * injeção só pode aparecer nesses três arquivos, e a catraca confere
 * (`arquitetura.test.ts`, "o cliente de publicação da Graph tem um dono").
 *
 * Quem usa o cliente só o chama em dois lugares: dentro do efeito de
 * `instagram.post.publicar`, que a porta dispara depois da aprovação, e na
 * conclusão de um container JÁ aprovado (status, limite, publish, permalink),
 * que confere o interruptor do conector antes de sair.
 */

export const GRAPH_DE_PUBLICACAO = Symbol('GRAPH_DE_PUBLICACAO');

export interface ContainerDaGraph {
  image_url?: string;
  video_url?: string;
  media_type?: 'CAROUSEL' | 'REELS' | 'STORIES';
  is_carousel_item?: boolean;
  children?: string[];
  caption?: string;
  share_to_feed?: boolean;
}

export interface GraphDePublicacao {
  limiteDePublicacao(token: string, igUserId: string): Promise<{ usado: number; teto: number }>;
  criarContainer(token: string, igUserId: string, c: ContainerDaGraph): Promise<string>;
  statusDoContainer(token: string, containerId: string): Promise<{ codigo: string; detalhe: string | null }>;
  publicarContainer(token: string, igUserId: string, creationId: string): Promise<string>;
  permalinkDe(token: string, mediaId: string): Promise<string | null>;
  midiasRecentes(
    token: string,
    igUserId: string,
    limite?: number,
  ): Promise<Array<{ id: string; caption: string | null; timestamp: string | null; permalink: string | null }>>;
}

/** A falha que não teve resposta (rede, prazo): o pedido pode ter chegado à Meta. */
export function semResposta(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'status' in e && (e as { status: unknown }).status === null;
}
