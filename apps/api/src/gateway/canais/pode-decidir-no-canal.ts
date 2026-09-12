import { VARIAVEL_DAS_CAPACIDADES, capacidadesDoCanal } from './configuracao-do-canal';

/*
 * ============================================================================
 * O QUE ESTE CANAL PODE DECIDIR — uma pergunta, duas superfícies (RF-A-06)
 * ============================================================================
 *
 * Função pura, e é ela que a MONTAGEM do pedido e a APROVAÇÃO chamam. Duas
 * chamadas da mesma função, e não duas regras parecidas em dois arquivos: a
 * primeira decide se o código sai; a segunda decide se um código que chegou
 * vale. Se só a primeira existisse, quem tivesse o segredo de derivação
 * produziria o código de qualquer aprovação e decidiria o que o canal nunca
 * ofereceu.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A LISTA DE PERMISSÃO EXISTE — o erro que ela conserta
 * ----------------------------------------------------------------------------
 * A primeira versão desta fatia dizia, por escrito, que expor o conteúdo exato
 * no WhatsApp valia "para a única escrita externa viva hoje" e que qualquer
 * capacidade de outra natureza seria "decisão nova". Era falso: o catálogo já
 * tem, VIVAS e com efeito ligado, capacidades de R2/R3 que escrevem fora do OS —
 * enviar e-mail, criar evento de agenda, criar e anexar documento, criar e
 * alterar tarefa —, e o ÚNICO interruptor era o segredo global. Ligar o canal
 * ligava todas elas de uma vez.
 *
 * Pior no caso do e-mail: `email.enviar` é `confidencial`, e o "conteúdo exato"
 * renderizava destinatário, assunto e CORPO INTEIRO numa mensagem de WhatsApp —
 * que vai parar no aparelho de quem decide e no banco da instância da Evolution.
 * É o mesmo armazenamento que o cabeçalho de `envio-de-aprovacao.service.ts`
 * classifica como "fora do OS, fora da cifragem do cofre e fora da retenção do
 * RASTRO" para RECUSAR pedir senha por ali. O argumento não pode valer para a
 * senha e não valer para o corpo do e-mail.
 *
 * ----------------------------------------------------------------------------
 * AS DUAS CATRACAS, E POR QUE SÃO DUAS
 * ----------------------------------------------------------------------------
 *  1. A LISTA (`CANAL_APROVACAO_CAPACIDADES`) é a decisão de QUEM OPERA: quais
 *     capacidades esta empresa aceita decidir pelo celular. O padrão é uma só —
 *     `whatsapp.mensagem.enviar` —, a única em que a exposição é circular (o
 *     texto ia sair por este mesmo WhatsApp de qualquer jeito).
 *  2. A SENSIBILIDADE é a decisão do CATÁLOGO, e não tem botão: o conteúdo exato
 *     só é mostrado quando o efeito é de sensibilidade `publica`. Acima disso o
 *     canal não mostra e, por consequência, não decide — manda o AVISO SEM
 *     CÓDIGO, exatamente como já faz para R4 e R5.
 *
 * A segunda existe porque a primeira é configurável: sem ela, acrescentar
 * `email.enviar` à lista voltaria a despejar o corpo do e-mail na conversa. Com
 * ela, acrescentar `email.enviar` à lista faz o canal AVISAR que há e-mail
 * esperando, e a decisão continua na tela.
 *
 * O QUE ISSO CUSTA, DECLARADO: com a lista padrão, a única capacidade permitida
 * é `confidencial` — então, no arranjo de fábrica, este canal NOTIFICA e não
 * DECIDE. Decidir pelo celular exige duas coisas ao mesmo tempo: a capacidade na
 * lista E o efeito dela ser `publica` (hoje, no catálogo, `conteudo.publicar`).
 * Isso é deliberado e está no relatório: "o canal mostra o que vai sair" e "o
 * canal não vaza conteúdo sensível para fora do OS" não podem ser as duas
 * verdadeiras ao mesmo tempo para uma capacidade confidencial — e das duas, a
 * que não se negocia é a segunda.
 *
 * ----------------------------------------------------------------------------
 * SEM CATÁLOGO NÃO SE DECIDE — e não se invalida nada por isso
 * ----------------------------------------------------------------------------
 * `sem-catalogo` é resposta de "não consigo afirmar", não de "está errado". Quem
 * chama RECUSA (não oferece o código; não aceita o código), e NÃO derruba a
 * aprovação: ela continua na fila, e a tela decide. É a mesma regra que
 * `AcoesService` aplica para o vínculo ao conteúdo.
 */

/** Por que o canal não decide esta linha. `null` quer dizer que decide. */
export type RecusaDoCanal =
  | 'sem-acao-retida'
  | 'sem-catalogo'
  | 'fora-da-lista'
  | 'conteudo-sensivel';

/** A sensibilidade do efeito que este canal aceita MOSTRAR — a mais baixa, e só ela. */
export const SENSIBILIDADE_QUE_O_CANAL_MOSTRA = 'publica';

export interface PerguntaDoCanal {
  /** A capacidade da aprovação. `null` = superfície antiga, sem ação retida. */
  capabilityId: string | null;
  /** `efeito.sensibilidade` do catálogo. `undefined` = catálogo indisponível. */
  sensibilidade: string | null | undefined;
  /** O catálogo foi consultado? `false` faz a resposta ser `sem-catalogo`. */
  temCatalogo: boolean;
  /** A lista de permissão. Injetada para o teste medir sem mexer no ambiente. */
  permitidas?: readonly string[];
}

/**
 * Este canal pode DECIDIR esta aprovação? Devolve o motivo da recusa, ou `null`.
 *
 * A ordem das perguntas é a ordem em que elas ficam sabidas — nada aqui depende
 * de consulta nova, então a ordem só governa QUAL frase a pessoa lê.
 */
export function motivoParaNaoDecidir(p: PerguntaDoCanal): RecusaDoCanal | null {
  if (!p.capabilityId) return 'sem-acao-retida';
  if (!p.temCatalogo) return 'sem-catalogo';
  const permitidas = p.permitidas ?? capacidadesDoCanal();
  if (!permitidas.includes(p.capabilityId)) return 'fora-da-lista';
  if (p.sensibilidade !== SENSIBILIDADE_QUE_O_CANAL_MOSTRA) return 'conteudo-sensivel';
  return null;
}

/**
 * A frase que sai no AVISO SEM CÓDIGO (montagem) e na RECUSA (aprovação).
 *
 * Uma frase por motivo, e nenhuma delas conta mais do que quem lê já sabe: quem
 * recebe o aviso é identidade cadastrada com alçada naquela linha.
 */
export function fraseDaRecusa(motivo: RecusaDoCanal): string {
  switch (motivo) {
    case 'sem-acao-retida':
      return 'Esta aprovação não retém uma ação com conteúdo — não há o que mostrar por aqui.';
    case 'sem-catalogo':
      return (
        'Não consegui consultar o catálogo de capacidades para esta ação, e sem ele não dá para ' +
        'saber o que ela faz. A aprovação continua na fila: decida no painel.'
      );
    case 'fora-da-lista':
      return (
        'Esta capacidade não está na lista que esta empresa aceita decidir pelo WhatsApp ' +
        `(${VARIAVEL_DAS_CAPACIDADES}). A aprovação continua na fila: decida no painel.`
      );
    case 'conteudo-sensivel':
      return (
        'O conteúdo desta ação não é público, e este canal não repete conteúdo não público numa ' +
        'conversa de WhatsApp — ela fica no aparelho de quem lê e no banco da instância, fora do ' +
        'OS. Decidir sem ver o conteúdo inteiro não é decidir: abra a fila no painel.'
      );
  }
}
