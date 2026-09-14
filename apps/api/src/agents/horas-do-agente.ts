import { SessionStatus } from '@prisma/client';
import {
  JANELA_MS,
  horasDevolvidas,
  type HorasDevolvidas,
  type PassagensDaJanela,
} from '@mktos/shared';

/* ==========================================================================
 * AS HORAS DE UM AGENTE — o conserto da mentira declarada (fatia A3, RF-N-05)
 * ==========================================================================
 *
 * O QUE ESTAVA ERRADO, e estava escrito no CLAUDE.md como dívida conhecida:
 * o roster publicava
 *
 *     horasDevolvidas = minutosPorExecucao × Agent.execucoes / 60
 *
 * e o KPI da mesma tela chamava a soma disso de "Horas devolvidas", ao lado do
 * cartão que `/rotinas` chama de "por semana". `Agent.execucoes` é contador de
 * VIDA INTEIRA e soma as passagens que FALHARAM: um agente com trezentas
 * passagens, metade delas com erro, e uma linha de base de vinte minutos
 * publicava cem horas "devolvidas" — número que nunca aconteceu, exibido com a
 * fórmula do lado, na tela que se mostra a cliente.
 *
 * `/rotinas` já contava certo (log real, só o que deu bom desfecho, janela de
 * sete dias). Esta fatia escolheu aquela conta como a verdade, moveu a
 * aritmética para `@mktos/shared` e deixou para cá o que é DO AGENTE:
 *
 *   1. qual é o log de passagens de um agente — é `Session`, uma linha por
 *      passagem, com `criadaEm` e `status`;
 *   2. qual desfecho de sessão DEVOLVE tempo.
 *
 * O número certo é menor. Ele fica menor.
 *
 * ----------------------------------------------------------------------------
 * POR QUE `retida` NÃO CONTA
 * ----------------------------------------------------------------------------
 * Sessão retida é ação que ficou esperando aprovação: o agente propôs, e alguém
 * ainda tem de assinar. Enquanto a assinatura não vem, o trabalho não foi
 * entregue e nenhuma pessoa deixou de gastar os minutos dela — contá-la seria
 * cobrar pelo trabalho antes de fazê-lo. É a mesma régua conservadora que
 * `/rotinas` usa ao descartar `erro`: na dúvida, o número menor.
 *
 * `rodando` não conta porque ainda não terminou. `recusada` e `falhou` não
 * contam porque devolvem retrabalho, não tempo.
 */

/**
 * Os desfechos de sessão que DEVOLVEM tempo.
 *
 * Lista fechada de propósito: enum novo em `SessionStatus` entra aqui por
 * decisão de alguém, e não por "não estava na lista de exclusão". O caminho
 * contrário — listar o que NÃO conta — daria ao próximo status a generosidade
 * como padrão, e generosidade como padrão é como o número ficou inflado.
 */
export const DESFECHO_BOM_DE_SESSAO = [
  SessionStatus.respondida,
  SessionStatus.executada,
] as const;

/** O instante em que a janela de sete dias começou. */
export function inicioDaJanela(agora: Date = new Date()): Date {
  return new Date(agora.getTime() - JANELA_MS);
}

/**
 * A janela, quando quem contou foi o BANCO.
 *
 * `janelaCoberta` é sempre `true` aqui, e a diferença com o lado do web é real:
 * lá o histórico vem paginado e pode estourar o teto, então o número pode ser
 * piso; aqui a contagem é um `COUNT(*)` sobre a janela inteira, sem página. E
 * `cobreDesde` é o começo da janela, não a passagem mais antiga encontrada:
 * contamos desde ali, inclusive quando não havia nada para contar.
 */
export function janelaContada(bemSucedidasNaJanela: number, inicio: Date): PassagensDaJanela {
  return {
    bemSucedidasNaJanela: Math.max(Math.trunc(bemSucedidasNaJanela) || 0, 0),
    janelaCoberta: true,
    cobreDesde: inicio.toISOString(),
  };
}

/** O que o roster precisa saber de um agente para medir as horas dele. */
export interface AgenteMedivel {
  minutosPorExecucao: number;
  execucoes: number;
  falhas: number;
}

/**
 * A medição de UM agente.
 *
 * `janela` é `null` quando a contagem de passagens não pôde ser feita — e isso
 * é `sem-historico`, NÃO zero. Zero medido quer dizer "este agente tem base
 * declarada e não passou nenhuma vez esta semana", que é informação de verdade;
 * "não deu para contar" é ausência de informação, e as duas não podem sair com
 * a mesma cara na tela.
 */
export function horasDoAgente(
  a: AgenteMedivel,
  janela: PassagensDaJanela | null,
): HorasDevolvidas {
  // Acumulado honesto: as que deram certo. `execucoes` soma bom desfecho + erro
  // e `falhas` é o pedaço que deu errado — o mesmo par de `/rotinas`.
  const bemSucedidas = Math.max(a.execucoes - a.falhas, 0);
  const base = a.minutosPorExecucao > 0 ? a.minutosPorExecucao : null;
  return horasDevolvidas(base, bemSucedidas, janela);
}
