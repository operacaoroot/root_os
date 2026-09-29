/*
 * O CLIENTE DA GRAPH QUE A PERFORMANCE RECEBE (MK5).
 *
 * Mesmo desenho do publicador e do coletor de comentários: o HTTP mora em
 * `bio/plataformas/instagram.ts`, o único arquivo com o endereço da Graph, e o
 * serviço (`performance.service.ts`) recebe o cliente por injeção, montado em
 * `bio/plataformas/publicacao.module.ts`. O token de injeção aparece só nesses
 * três arquivos, e a Graph só é chamada DENTRO do efeito que a porta dispara.
 */

export const GRAPH_DE_INSIGHTS = Symbol('GRAPH_DE_INSIGHTS');

export interface NumerosDoPost {
  externalId: string;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
}

export interface GraphDeInsights {
  /** Os seguidores da conta agora. Nulo quando a conta não concede o campo. */
  seguidores(token: string): Promise<number | null>;
  /** Os números de um post. Métrica não concedida volta nula, nunca zero. */
  numerosDo(token: string, midiaId: string): Promise<NumerosDoPost>;
}
