/*
 * O CLIENTE DA GRAPH QUE O COLETOR DE COMENTÁRIOS RECEBE (MD9).
 *
 * O mesmo desenho do publicador (`graph-de-publicacao.ts`): o HTTP mora em
 * `bio/plataformas/instagram.ts`, o único arquivo com o endereço da Graph, e o
 * coletor (`comentarios.service.ts`) recebe o cliente por injeção, montado em
 * `bio/plataformas/publicacao.module.ts`. O token de injeção só aparece nesses
 * três arquivos (`arquitetura.test.ts`, "o cliente de comentários da Graph tem
 * um dono"), e o coletor só o usa DENTRO do efeito de
 * `instagram.comentario.ler`, que a porta dispara.
 */

export const GRAPH_DE_COMENTARIOS = Symbol('GRAPH_DE_COMENTARIOS');

export interface ComentarioLido {
  id: string;
  texto: string;
  timestamp: string | null;
  deId: string | null;
  deUsuario: string | null;
  parentId: string | null;
  adId: string | null;
}

export interface GraphDeComentarios {
  comentariosDa(token: string, midiaId: string, tetoPaginas?: number): Promise<{ comentarios: ComentarioLido[]; truncado: boolean }>;
  /** As mídias da conta desde uma data: acha o post marcado à mão pelo permalink. */
  midiasDesde(token: string, desde: Date, tetoPaginas?: number): Promise<Array<{ externalId: string; publicadoEm: Date; permalink?: string }>>;
}
