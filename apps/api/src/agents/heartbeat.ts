/**
 * ============================================================================
 * OS GATILHOS DE HEARTBEAT — fatia A2 acende o primeiro; A6 acende os outros três
 * ============================================================================
 *
 * Hoje o OS tem UM relógio: o tique das rotinas (`routines/rotinas.scheduler.ts`),
 * por empresa, por cron. Um agente só acorda na hora marcada ou quando alguém
 * escreve um pedido para ele em `/agentes` ou no chat.
 *
 * O plano do controle de agentes (`docs/PLANO-CONTROLE-DE-AGENTES.md`, item 6)
 * quer quatro gatilhos além do cron. Esta fatia entrega UM — o manual, o botão
 * "Invocar" — e declara os quatro aqui, com a lista de quem está LIGADO
 * separada da lista de quem EXISTE.
 *
 * POR QUE DECLARAR OS QUATRO AGORA, se três não funcionam. Porque a alternativa
 * é o botão "Invocar" chamar `AgentRuntime.executar` direto com um texto
 * inventado no controlador — e então a fatia A6 chegaria e encontraria quatro
 * caminhos diferentes escrevendo o pedido de acordar, cada um com a sua frase.
 * O pedido de heartbeat é um FORMATO, e formato mora num lugar só. O que A6 faz
 * é acrescentar o motivo a `MOTIVOS_LIGADOS` e ligar quem dispara; nada aqui
 * precisa ser reescrito.
 *
 * E POR QUE A LISTA DE LIGADOS É SEPARADA em vez de os três simplesmente não
 * existirem: porque `test/estado-do-agente.test.ts` cobra que ela tem UM item.
 * Ligar um gatilho sem implementar quem o dispara deixa o teste vermelho, e é o
 * que impede a fatia A6 de ser declarada pronta pela metade.
 */

export const MOTIVOS_DE_HEARTBEAT = [
  /** O dono clicou "Invocar" na tela. É o único ligado nesta fatia. */
  'manual',
  /** A6: uma tarefa foi atribuída a este agente. */
  'atribuicao',
  /** A6: alguém mencionou o agente numa sessão ou num comentário. */
  'mencao',
  /** A6: uma aprovação que ele propôs foi assinada ou recusada. */
  'aprovacao_resolvida',
] as const;

export type MotivoDeHeartbeat = (typeof MOTIVOS_DE_HEARTBEAT)[number];

/**
 * Os gatilhos que TÊM quem os dispare hoje.
 *
 * Um por um, e não `MOTIVOS_DE_HEARTBEAT` inteiro: a diferença entre as duas
 * listas é a dívida declarada da fatia A6, e ela precisa ser legível sem ler o
 * plano.
 */
export const MOTIVOS_LIGADOS: readonly MotivoDeHeartbeat[] = ['manual'];

export function heartbeatLigado(motivo: MotivoDeHeartbeat): boolean {
  return MOTIVOS_LIGADOS.includes(motivo);
}

/**
 * A frase que abre a passagem, por motivo.
 *
 * ELA É O PEDIDO DA SESSÃO, e por isso não é enfeite: vai para `Session.pedido`,
 * aparece em `/sessoes` e entra no prompt como a pergunta que o agente está
 * respondendo. Um "acorde" genérico faria o modelo perguntar de volta o que ele
 * deveria fazer — e queimaria um passo e um custo para descobrir o que o SOP dele
 * já diz.
 *
 * Por isso cada frase manda o agente ler o procedimento dele e AGIR dentro das
 * capacidades declaradas. O "dentro das capacidades" é redundante para a porta
 * (que recusa fora da declaração de qualquer forma), e está escrito assim mesmo:
 * a descrição que o modelo lê tem de concordar com a recusa que ele vai receber,
 * senão ele gasta passo tentando o que não pode.
 */
const FRASE: Record<MotivoDeHeartbeat, string> = {
  manual:
    'Passagem manual: seu dono te invocou agora pela tela de Agentes. Siga o seu procedimento — ' +
    'olhe o que está pendente na sua missão, use só as ferramentas que você declarou e responda ' +
    'o que você fez, com a procedência de cada número. Se não houver nada a fazer, diga isso em ' +
    'uma linha, sem chamar ferramenta.',
  atribuicao:
    'Passagem por atribuição: uma tarefa acabou de ficar sob sua responsabilidade. Leia o seu ' +
    'procedimento e trate a tarefa.',
  mencao:
    'Passagem por menção: alguém te citou. Leia o que foi dito e responda dentro da sua missão.',
  aprovacao_resolvida:
    'Passagem por aprovação resolvida: uma ação que você propôs foi decidida. Continue de onde ' +
    'parou, ou registre por que não dá para continuar.',
};

/**
 * Monta o pedido de uma passagem de heartbeat.
 *
 * `nota` é opcional e entra DEPOIS da frase, marcada como vinda do dono: o dono
 * pode querer dizer "olhe o cliente X" sem escrever um pedido inteiro. Ela é
 * TEXTO DE PESSOA da própria casa — não passa pela cerca de conteúdo externo
 * (`blocoExterno`), e é por isso que o limite de tamanho é curto e a rota o
 * valida com Zod antes de chegar aqui.
 */
export function pedidoDoHeartbeat(
  motivo: MotivoDeHeartbeat,
  opcoes: { nota?: string | null } = {},
): string {
  const nota = opcoes.nota?.trim();
  return nota ? `${FRASE[motivo]}\n\nRecado do dono: ${nota}` : FRASE[motivo];
}
