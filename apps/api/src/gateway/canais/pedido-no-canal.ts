import { PREFIXO_DO_CODIGO } from './resposta-de-canal';

/*
 * ============================================================================
 * O QUE A PESSOA LÊ NO CELULAR — o conteúdo EXATO, ou nada (RF-A-06)
 * ============================================================================
 *
 * Função pura. Monta o texto do pedido de decisão e, quando o conteúdo exato não
 * cabe ou não está disponível, monta o AVISO que manda decidir na tela.
 *
 * ----------------------------------------------------------------------------
 * "CONTEÚDO EXATO" É UMA PROMESSA, E ELA É CUMPRIDA OU RETIRADA
 * ----------------------------------------------------------------------------
 * A fatia pede que o operador receba o pedido COM O CONTEÚDO EXATO. Um conteúdo
 * cortado no meio não é o conteúdo exato: é um resumo com cara de original, e
 * assinar um resumo achando que é o original é pior do que não assinar. Por
 * isso, quando o conteúdo não cabe inteiro, o canal NÃO OFERECE A DECISÃO — ele
 * avisa que há algo esperando e manda para a fila na tela, que mostra tudo.
 *
 * O mesmo vale quando os argumentos chegaram REDIGIDOS. A porta grava
 * `{ redigido: true, chaves: [...] }` em `ToolCall.args` para capacidade de
 * sensibilidade `restrita` (ver `ToolGateway.redigir`): ali o que existe é a
 * lista de campos, não o texto. Decidir sobre isso pelo celular seria decidir no
 * escuro.
 *
 * ----------------------------------------------------------------------------
 * A EXPOSIÇÃO DE CONTEÚDO, DECLARADA — e CONTIDA em outro arquivo
 * ----------------------------------------------------------------------------
 * Este texto sai para a conversa DIRETA de uma identidade cadastrada que pode
 * DECIDIR aquela linha — a mesma regra que a fila na tela adotou ("o conteúdo
 * exato vai só para quem pode decidir", `approvals.controller.ts`). Não vai para
 * grupo, não vai para quem só acompanha, e não vai para quem não alcança a
 * alçada daquela aprovação.
 *
 * O que isso ESTENDE: o conteúdo passa a existir também no armazenamento do
 * WhatsApp — o aparelho de quem decide e o banco da instância da Evolution, que
 * ficam fora do OS, fora da cifragem do cofre e fora da retenção do RASTRO.
 *
 * ESTE ARQUIVO NÃO DECIDE SE ISSO PODE. Ele só SABE ESCREVER as duas mensagens.
 * Quem decide qual das duas sai é `pode-decidir-no-canal.ts`, e a regra de lá é
 * curta: conteúdo exato só para capacidade que está na lista de permissão E cujo
 * efeito é de sensibilidade `publica`. Todo o resto — inclusive
 * `whatsapp.mensagem.enviar` e `email.enviar`, que são `confidencial` — recebe o
 * AVISO SEM CÓDIGO e decide na tela.
 *
 * (A versão anterior desta fatia dizia aqui que a exposição valia "para a única
 * escrita externa viva hoje" e que o resto seria "decisão nova". Era falso: o
 * catálogo já tinha, vivas, onze capacidades de R2/R3 que escrevem fora do OS. A
 * frase foi retirada junto com o comportamento que ela justificava.)
 */

/**
 * Quanto de conteúdo cabe numa mensagem antes de o canal desistir de oferecer a
 * decisão.
 *
 * O limite do WhatsApp é bem maior (4096). Este é menor de propósito: um
 * conteúdo que não cabe em ~1200 caracteres é um conteúdo que ninguém lê inteiro
 * na tela de um celular, e "leu antes de assinar" é a razão de o conteúdo estar
 * ali. Acima disso, a tela.
 */
export const TETO_DO_CONTEUDO = 1200;

/** O que o canal precisa saber de uma aprovação para escrever o pedido. */
export interface PedidoParaOCanal {
  codigo: string;
  resumo: string;
  nivel: string;
  capacidade: string | null;
  /** Os 12 primeiros do `contentHash` — o mesmo identificador que a tela mostra. */
  hashCurto: string;
  expiraEm: Date;
  /** Os argumentos GRAVADOS na passagem pela porta. É o conteúdo exato. */
  args: Record<string, unknown>;
}

/** Os argumentos chegaram redigidos pela porta? Ver o cabeçalho. */
export function conteudoFoiRedigido(args: Record<string, unknown>): boolean {
  return args?.redigido === true;
}

/**
 * O conteúdo exato, em texto legível — ou `null` quando não dá para mostrá-lo
 * inteiro.
 *
 * JSON indentado e não uma paráfrase: é o que a tela mostra, e as duas
 * superfícies têm de falar do mesmo objeto. Uma paráfrase seria mais bonita e
 * seria outra coisa.
 */
export function conteudoExato(args: Record<string, unknown>): string | null {
  if (conteudoFoiRedigido(args)) return null;
  let texto: string;
  try {
    texto = JSON.stringify(args ?? {}, null, 2);
  } catch {
    // Referência circular, `BigInt`: o que não serializa não tem forma exata.
    return null;
  }
  if (texto.length > TETO_DO_CONTEUDO) return null;
  return texto;
}

/** Hora de expiração em São Paulo — o relógio de quem lê, não o UTC. */
function horaLocal(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(quando);
}

/**
 * O PEDIDO COM O CONTEÚDO EXATO.
 *
 * A última linha não é enfeite: ela diz, para quem lê e para quem por acaso
 * receber um encaminhamento disto, que esta conversa não executa ordem nenhuma.
 * O que ela promete é o que o código faz — `lerRespostaDeCanal` só reconhece a
 * linha inteira e exata.
 */
export function textoDoPedido(p: PedidoParaOCanal, conteudo: string): string {
  return [
    `*ROOT · pedido de aprovação* (${p.nivel})`,
    '',
    p.resumo,
    p.capacidade ? `capacidade: ${p.capacidade}` : null,
    `conteúdo sha256:${p.hashCurto} · vale até ${horaLocal(p.expiraEm)}`,
    '',
    '*Conteúdo exato que vai sair:*',
    '```',
    conteudo,
    '```',
    '',
    'Para decidir, responda com UMA destas linhas, sozinha e sem mais nada:',
    `${'APROVAR'} ${p.codigo}`,
    `${'RECUSAR'} ${p.codigo}`,
    '',
    'Qualquer outro texto é ignorado. Esta conversa não recebe ordens — ela só ' +
      'reconhece as duas linhas acima, e só de quem está cadastrado.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/**
 * O AVISO SEM DECISÃO — quando o canal não pode cumprir "conteúdo exato" ou
 * quando o degrau exige mais do que o WhatsApp consegue provar.
 *
 * Não leva código: sem código não há o que responder, e é assim que o canal
 * recusa sem fingir que aceita.
 */
export function textoDoAviso(p: Omit<PedidoParaOCanal, 'codigo'>, porque: string): string {
  return [
    `*ROOT · aprovação esperando* (${p.nivel})`,
    '',
    p.resumo,
    `conteúdo sha256:${p.hashCurto} · vale até ${horaLocal(p.expiraEm)}`,
    '',
    porque,
    '',
    'Abra a fila de aprovações no painel para decidir.',
  ].join('\n');
}

/** O lembrete do formato, para quem é cadastrado e escreveu quase certo. */
export function textoDoFormato(): string {
  return (
    'Não entendi. A resposta precisa ser exatamente uma destas linhas, sozinha:\n' +
    `APROVAR ${PREFIXO_DO_CODIGO}XXXXXXXX\n` +
    `RECUSAR ${PREFIXO_DO_CODIGO}XXXXXXXX\n` +
    'com o código que veio no pedido.'
  );
}
