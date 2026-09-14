import { EstadoDeAgente } from '@prisma/client';

import { estadoTrabalha, recusaPorEstado } from '../agents/estado-do-agente';

/**
 * ============================================================================
 * O CHECKOUT DE TAREFA — as regras, fatia A4
 * ============================================================================
 *
 * `docs/PLANO-CONTROLE-DE-AGENTES.md`, fatia A4: "a transição para em andamento
 * exige um checkout ATÔMICO — só um agente é dono da tarefa por vez. Se dois
 * tentarem ao mesmo tempo, um recebe 409 Conflict".
 *
 * Este arquivo é o ÚNICO lugar que sabe o que cada recusa quer dizer e como ela
 * se chama no rastro. O serviço ao lado (`checkout-de-tarefa.service.ts`) faz a
 * escrita; a decisão de QUEM PODE e de COMO A RECUSA SE CHAMA mora aqui, pelo
 * mesmo motivo que `estado-do-agente.ts` existe: regra escrita no componente que
 * a desenha é regra que a segunda tela contradiz.
 *
 * ----------------------------------------------------------------------------
 * POR QUE "ATÔMICO" NÃO É ENFEITE DE VOCABULÁRIO
 * ----------------------------------------------------------------------------
 * A forma natural de escrever isto é ler a tarefa, ver que está livre e gravar
 * o dono. Entre a leitura e a escrita cabe outra passagem inteira: dois agentes
 * leem "livre", os dois gravam, o segundo sobrescreve o primeiro, e os DOIS
 * seguem trabalhando convictos de que a tarefa é deles. Ninguém vê nada — não há
 * erro, não há log, não há linha vermelha. É o pior desfecho possível para o
 * produto, porque o cliente paga duas vezes a mesma coisa e descobre pelo
 * resultado duplicado.
 *
 * A defesa é UMA instrução condicional no banco:
 *
 *   UPDATE "WorkTask" SET "agenteId" = $1 WHERE "id" = $2 AND "agenteId" IS NULL
 *
 * e a decisão sai da CONTAGEM DE LINHAS AFETADAS. Um recebe 1, o outro recebe 0
 * — o Postgres bloqueia a linha e reavalia o `WHERE` depois do commit vizinho.
 * Quem recebeu 0 perdeu, e é isso que vira 409.
 *
 * Se alguém "simplificar" isso para `findFirst` + `update`, tudo continua
 * compilando e a suíte de corrida (`test/checkout-de-tarefa.test.ts`) fica
 * vermelha. Ela existe para isso.
 */

/* ========================================================================== *
 * QUEM PODE ASSUMIR
 * ========================================================================== */

/**
 * Um agente só assume trabalho no estado em que ele TRABALHA (fatia A2).
 *
 * Delegado a `estadoTrabalha` de propósito, em vez de repetir a lista: a
 * pergunta "quem trabalha" já tem dono no repositório, e duas listas divergem no
 * dia em que o enum ganhar um valor. Agente pausado com tarefa na mão é
 * exatamente o travamento que a soltura automática (abaixo) desfaz — deixá-lo
 * ASSUMIR nesse estado seria criar o problema pela porta da frente.
 */
export function agentePodeAssumir(estado: EstadoDeAgente): boolean {
  return estadoTrabalha(estado);
}

/**
 * A recusa por estado, nas palavras da A2.
 *
 * Reusa `recusaPorEstado` para a causa e o motivo não terem duas redações: a
 * tela de Agentes e o quadro de Trabalho passam a dizer a mesma frase sobre o
 * mesmo agente, que é o contrário do defeito das "horas por semana".
 */
export function recusaDeAssumirPorEstado(estado: EstadoDeAgente) {
  return recusaPorEstado(estado);
}

/* ========================================================================== *
 * AS CAUSAS DA RECUSA
 * ========================================================================== */

/**
 * Rótulos ESTÁVEIS, minúsculos com sublinhado — a mesma disciplina de
 * `CAUSA_DA_RECUSA` na A2 e de `agente_rebaixado` na porta. A causa é o que se
 * agrupa num relatório seis meses depois; a frase é o que a pessoa lê e pode
 * mudar sem quebrar contagem nenhuma.
 */
export const CAUSA_DO_CHECKOUT = {
  /** Outro agente chegou primeiro. É a corrida perdida, e é o 409 da fatia. */
  jaAssumida: 'tarefa_ja_assumida',
  /** Pediram para soltar uma tarefa que não está na mão de ninguém. */
  semAgente: 'tarefa_sem_agente',
  /** Tarefa arquivada não recebe trabalho novo. */
  arquivada: 'tarefa_arquivada',
  /** O agente existe, mas o estado declarado dele não trabalha. */
  agenteNaoTrabalha: 'agente_nao_trabalha',
} as const;

export type CausaDoCheckout = (typeof CAUSA_DO_CHECKOUT)[keyof typeof CAUSA_DO_CHECKOUT];

/* ========================================================================== *
 * POR QUE A TAREFA FOI SOLTA
 * ========================================================================== */

/**
 * Os motivos de uma tarefa voltar a ficar livre.
 *
 * Declarados, e não um texto solto, porque a diferença entre eles é operacional:
 * `pedido` é alguém devolvendo trabalho; `agente_pausado` e `agente_encerrado`
 * são o sistema impedindo que uma decisão sobre o AGENTE deixe a TAREFA presa.
 * Quem procura trabalho parado precisa distinguir os três.
 */
export const MOTIVO_DA_SOLTURA = {
  pedido: 'pedido',
  agentePausado: 'agente_pausado',
  agenteEncerrado: 'agente_encerrado',
} as const;

export type MotivoDaSoltura = (typeof MOTIVO_DA_SOLTURA)[keyof typeof MOTIVO_DA_SOLTURA];

/**
 * O motivo de soltura que corresponde a um estado que não trabalha.
 *
 * `null` quando o estado trabalha — e é assim que `definirEstado` decide se tem
 * de soltar alguma coisa: a pergunta "este estado solta tarefa?" é a mesma
 * pergunta "este estado trabalha?", invertida, e derivá-la impede que alguém
 * ligue a soltura em `ativo` por descuido. Retomar um agente NÃO devolve as
 * tarefas que ele tinha: elas foram soltas e podem estar com outro agente agora.
 */
export function soltarPorCausaDoEstado(estado: EstadoDeAgente): MotivoDaSoltura | null {
  if (estadoTrabalha(estado)) return null;
  if (estado === EstadoDeAgente.encerrado) return MOTIVO_DA_SOLTURA.agenteEncerrado;
  /*
   * `planejado` e `pausado` caem no mesmo motivo, e é decisão consciente:
   * `planejado` é um agente que nunca rodou, então ele não tem tarefa na mão
   * para soltar — a linha existe para o enum ficar coberto sem `default`
   * silencioso, não porque o caso aconteça.
   */
  return MOTIVO_DA_SOLTURA.agentePausado;
}

/* ========================================================================== *
 * OS EVENTOS DO RASTRO
 * ========================================================================== */

/** Um por verbo, nomeado pelo verbo — igual a `EVENTO_DA_TRANSICAO` na A2. */
export const EVENTO_DO_CHECKOUT = {
  assumida: 'tarefa.assumida',
  soltada: 'tarefa.soltada',
  recusada: 'tarefa.checkout_recusado',
} as const;

/* ========================================================================== *
 * AS FRASES
 * ========================================================================== */

/**
 * O 409 de quem perdeu a corrida — e ele DIZ QUEM GANHOU.
 *
 * Nome do agente e desde quando, porque a pergunta seguinte de quem recebe este
 * erro é sempre a mesma ("então quem está com ela?") e mandá-lo procurar na tela
 * é mandar dois agentes competirem no escuro. Quando o nome não resolve (agente
 * de outra empresa numa linha atravessada — ver `agentes-da-casa.ts`), a frase
 * diz "outro agente" em vez de inventar: dizer o nome errado é pior do que não
 * dizer nome nenhum.
 */
export function mensagemDeCorridaPerdida(dono: {
  nome: string | null;
  desde: Date | null;
}): string {
  const quem = dono.nome ? `o agente "${dono.nome}"` : 'outro agente';
  const quando = dono.desde
    ? ` desde ${dono.desde.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    : '';
  return (
    `Esta tarefa já está com ${quem}${quando}. Só um agente é dono de uma tarefa por vez — ` +
    'quem chegou primeiro ficou com ela. Para passá-la adiante, solte a tarefa primeiro.'
  );
}

/** O 409 de soltar o que não está travado. */
export function mensagemDeTarefaLivre(): string {
  return (
    'Esta tarefa não está na mão de nenhum agente, então não há o que soltar. ' +
    'Nada foi alterado — e a data de quando ela foi solta da última vez foi preservada.'
  );
}

/** O 409 de assumir tarefa arquivada. */
export function mensagemDeTarefaArquivada(): string {
  return (
    'Esta tarefa está arquivada. Tarefa arquivada não recebe trabalho novo: desarquive antes ' +
    'de entregá-la a um agente.'
  );
}
