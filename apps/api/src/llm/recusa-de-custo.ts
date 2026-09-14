/* ==========================================================================
 * A FAMÍLIA DAS RECUSAS POR CUSTO DE IA (fatia A3)
 * ==========================================================================
 *
 * POR QUE UMA CLASSE BASE, E POR QUE ELA MORA EM ARQUIVO PRÓPRIO
 *
 * Até esta fatia havia UMA recusa por custo (`TetoDiarioEstouradoError`, o teto
 * por empresa e por dia), e o laço do agente a tratava por nome:
 *
 *     if (!(e instanceof TetoDiarioEstouradoError)) throw e;
 *
 * Esse `if` é o que impede a exceção de escapar do laço. E escapar não é
 * detalhe: a sessão já foi aberta e o pedido já foi gravado, então uma exceção
 * que sobe deixa a linha SEM situação e SEM motivo — execução pendurada para
 * sempre, que nem a tela nem o RASTRO conseguem explicar. O comentário daquele
 * `catch` conta essa história inteira, porque ela já aconteceu uma vez.
 *
 * O orçamento mensal por agente é a SEGUNDA recusa da mesma família. Se ela
 * nascesse como classe solta, o laço voltaria a ter o defeito antigo para um
 * caso novo — e a terceira recusa que alguém escrever repetiria a história. Com
 * a base, quem trata trata a FAMÍLIA: `catch (e) { if (e instanceof
 * RecusaDeCustoDeIaError) … }`.
 *
 * ARQUIVO PRÓPRIO porque as duas subclasses moram em serviços diferentes
 * (`teto-diario.service.ts` e `orcamento-de-agente.service.ts`) e o envelope
 * (`provider-com-teto.ts`) chama os dois. Pôr a base num dos dois faria o outro
 * importar o serviço inteiro do vizinho só para alcançar uma classe de erro —
 * ciclo de import esperando acontecer.
 *
 * O QUE TODA RECUSA DA FAMÍLIA DEVE: ter `motivo` em PORTUGUÊS, escrito para
 * quem opera e não para quem programou, e uma `causa` estável, que é o rótulo
 * que vai para o RASTRO e permite agrupar ("quantas vezes o orçamento deste
 * agente barrou alguém?"). Texto de tela agrupa mal; rótulo agrupa.
 */
export abstract class RecusaDeCustoDeIaError extends Error {
  /**
   * O rótulo estável do corte, para o RASTRO e para quem agrupa. Nunca a frase
   * — frase muda quando alguém a escreve melhor, e aí a série histórica quebra.
   */
  abstract readonly causa: string;

  /** A frase em português que a tela mostra ao operador. */
  readonly motivo: string;

  /** Quem paga a conta. Sempre presente: recusa de custo é sempre de alguém. */
  readonly orgId: string;

  constructor(orgId: string, motivo: string) {
    super(motivo);
    this.motivo = motivo;
    this.orgId = orgId;
  }
}
