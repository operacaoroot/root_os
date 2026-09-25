/*
 * O CLIENTE DA GRAPH QUE A DM AUTOMÁTICA RECEBE (MD11).
 *
 * O mesmo desenho do publicador e do coletor: o HTTP mora em
 * `bio/plataformas/instagram.ts`, o único arquivo com o endereço da Graph, e a
 * DM automática (`dm-automatica.service.ts`) recebe o cliente por injeção,
 * montado em `bio/plataformas/publicacao.module.ts`. O token de injeção só
 * aparece nesses três arquivos (`arquitetura.test.ts`), e o serviço só o usa
 * DENTRO do efeito de `instagram.resposta_privada.enviar`, que a porta dispara.
 */

export const GRAPH_DE_MENSAGENS = Symbol('GRAPH_DE_MENSAGENS');

export interface GraphDeMensagens {
  /**
   * A resposta privada da Meta: `POST <IG_ID>/messages` com
   * `recipient.comment_id`. Uma por comentário, até 7 dias depois dele. O erro
   * da Meta chega com `codigoDaMeta` (`code` e `error_subcode`).
   */
  responderEmPrivado(token: string, igUserId: string, commentId: string, texto: string): Promise<{ mensagemId: string | null }>;
}
