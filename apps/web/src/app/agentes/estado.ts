/*
 * ============================================================================
 * O VOCABULÁRIO DE ESTADO NA TELA — fatia A2
 * ============================================================================
 *
 * A regra de QUEM PODE IR PARA ONDE mora no servidor
 * (`apps/api/src/agents/estado-do-agente.ts`) e chega pronta em
 * `Agente.transicoes`. Este arquivo é só a TRADUÇÃO: rótulo, tom e a frase que
 * diz o que cada botão faz.
 *
 * A TELA NÃO DEDUZ A REGRA, e a distinção é o que mantém as duas honestas: se
 * aqui existisse um `if (estado === 'encerrado')` decidindo o que mostrar,
 * haveria duas cópias de "encerrado não volta" — e um dia uma delas mudaria. O
 * que este arquivo faz com `transicoes` é DESENHAR a lista que o servidor
 * mandou, em ordem, com o texto de cada uma.
 */

export type EstadoDeAgente = 'planejado' | 'ativo' | 'pausado' | 'encerrado';

/** O eixo derivado: o que está acontecendo. Ver `situacaoDoAgente` na API. */
export type SituacaoDeAgente = 'rodando' | 'ocioso' | 'erro' | EstadoDeAgente;

export type Tom = 'ok' | 'atencao' | 'erro' | 'neutro';

export const ROTULO_DO_ESTADO: Record<EstadoDeAgente, string> = {
  planejado: 'planejado',
  ativo: 'ativo',
  pausado: 'pausado',
  encerrado: 'encerrado',
};

/** O que o estado quer dizer, na tela, sem obrigar ninguém a abrir a doc. */
export const EXPLICA_O_ESTADO: Record<EstadoDeAgente, string> = {
  planejado: 'nasceu e ainda não foi ligado — sem dono ou sem capacidade declarada',
  ativo: 'em operação: pode ser chamado, e o cron dele dispara',
  pausado: 'parado pelo dono. Não executa até alguém retomar',
  encerrado: 'fora de circulação para sempre. Não executa e não volta',
};

export const ROTULO_DA_SITUACAO: Record<SituacaoDeAgente, string> = {
  rodando: 'rodando agora',
  ocioso: 'ocioso',
  erro: 'erro na última passagem',
  planejado: 'planejado',
  ativo: 'ativo',
  pausado: 'pausado',
  encerrado: 'encerrado',
};

/**
 * O tom de cada situação.
 *
 * `ocioso` é NEUTRO e não verde: agente ativo sem nada para fazer é o estado
 * normal, e pintá-lo de verde faria o verde perder o significado de "está
 * trabalhando". `encerrado` e `planejado` são apagados — não são problema, são
 * ausência.
 */
export const TOM_DA_SITUACAO: Record<SituacaoDeAgente, Tom> = {
  rodando: 'ok',
  ocioso: 'neutro',
  erro: 'erro',
  pausado: 'atencao',
  encerrado: 'neutro',
  planejado: 'neutro',
  ativo: 'ok',
};

/** Um botão de mudança de estado, já com tudo o que a tela precisa dizer. */
export interface BotaoDeEstado {
  destino: EstadoDeAgente;
  rotulo: string;
  /** O sufixo da rota: `/agents/:slug/<rota>`. */
  rota: 'pausar' | 'retomar' | 'encerrar';
  /** O que acontece ao clicar. Aparece ANTES do clique, nunca depois. */
  explica: string;
  /** A API recusa sem motivo escrito — então a tela pede primeiro. */
  pedeMotivo: boolean;
  tom: Tom;
}

const BOTAO: Record<EstadoDeAgente, BotaoDeEstado | null> = {
  pausado: {
    destino: 'pausado',
    rotulo: 'Pausar',
    rota: 'pausar',
    explica:
      'Ele para de executar na hora — inclusive o cron. A volta é por decisão de gente, não por ' +
      'relógio. O histórico e a configuração ficam intactos.',
    pedeMotivo: false,
    tom: 'atencao',
  },
  ativo: {
    destino: 'ativo',
    rotulo: 'Retomar',
    rota: 'retomar',
    explica:
      'Ele volta a poder executar, com as mesmas capacidades declaradas e o mesmo teto de ' +
      'autonomia de antes. Se estava rebaixado por erro, continua rebaixado — aquilo é relógio.',
    pedeMotivo: false,
    tom: 'ok',
  },
  encerrado: {
    destino: 'encerrado',
    rotulo: 'Encerrar',
    rota: 'encerrar',
    explica:
      'DEFINITIVO: ele não executa e NÃO VOLTA. Encerrar é diferente de apagar — as sessões e o ' +
      'rastro dele continuam lá. Para ter esse trabalho de volta, será um agente novo.',
    pedeMotivo: true,
    tom: 'erro',
  },
  /*
   * NÃO EXISTE BOTÃO PARA `planejado`, e a ausência é deliberada: `planejado`
   * quer dizer "ainda não foi ligado", e nenhum verbo devolve um agente para
   * antes de ter sido ligado. O servidor também não oferece essa transição —
   * este `null` é a mesma decisão, do lado da tela.
   */
  planejado: null,
};

/**
 * Os botões desta linha, na ordem em que a API mandou as transições.
 *
 * Transição que a tela não sabe desenhar é IGNORADA em silêncio (o `filter`), e
 * é o comportamento certo: um estado novo no servidor aparece sem botão até
 * alguém escrever o texto dele aqui — nunca como botão sem explicação.
 */
export function botoesDeEstado(transicoes: readonly string[] = []): BotaoDeEstado[] {
  return transicoes
    .map((t) => BOTAO[t as EstadoDeAgente] ?? null)
    .filter((b): b is BotaoDeEstado => b !== null);
}

/**
 * O QUE A TELA DIZ ANTES DE ALGUÉM CLICAR EM "INVOCAR".
 *
 * Invocar faz o agente rodar de verdade: ele alcança a porta, e a porta retém
 * tudo o que passa da autonomia dele. R3 ou acima exige uma SEGUNDA PESSOA
 * (invariante 7 — quem propõe não assina), então numa empresa de operador único
 * essas ações ficam na fila até existir um segundo usuário com alçada.
 *
 * Isto é decisão de operação, não defeito — e é exatamente por isso que precisa
 * estar dito ANTES do clique, como `/atendimento` já faz. A tela de Google já
 * pagou o preço de não dizer: ela mostrava "✅ E-mail enviado" em cima de um 200
 * que era retenção.
 */
export const AVISO_DA_INVOCACAO =
  'Invocar faz o agente rodar agora, seguindo o procedimento dele. O que ele tentar acima da ' +
  'autonomia declarada não sai no clique: fica retido em Aprovações, e de R3 para cima precisa ' +
  'da assinatura de OUTRA pessoa — quem invocou não assina.';
