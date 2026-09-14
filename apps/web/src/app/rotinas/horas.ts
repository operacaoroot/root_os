import {
  DIAS_DA_JANELA,
  JANELA_MS,
  horasDevolvidas,
  janelaDeLog,
  totalDaSemana,
  type EstadoDaMedicao,
  type HorasDevolvidas,
  type TotalDaSemana,
} from '@mktos/shared';
import type { ExecucaoResumo, RotinaResumo } from './tipos';

/* ==========================================================================
 * HORAS DEVOLVIDAS DE UMA ROTINA — RF-N-05
 * ==========================================================================
 *
 * A CONTA NÃO MORA MAIS AQUI. Ela está em `@mktos/shared`
 * (`horas-devolvidas.ts`), e o cabeçalho de lá é o documento: o que entra, o
 * que não entra e por quê.
 *
 * O motivo da mudança, em uma frase: `/agentes` tinha uma SEGUNDA conta,
 * publicando acumulado de vida inteira (com as passagens que falharam dentro)
 * no cartão que esta tela chama de "por semana". Duas contas do mesmo número
 * dão duas respostas, e uma delas mentia. Agora a aritmética é uma só e cada
 * tela traz apenas o LOG dela — aqui, `RotinaExecucao`; lá, `Session`.
 *
 * O que sobrou neste arquivo é o ADAPTADOR: converter o histórico como a API o
 * devolve (`ExecucaoResumo[]`) para o formato que a conta pede, e dizer qual
 * desfecho de rotina devolve tempo. Nada mais.
 *
 * `RotinaResumo.minutosDevolvidos`, que a API já manda, continua NÃO sendo
 * usado: ele é `minutosPorExecucao × Rotina.execucoes`, e `execucoes` soma as
 * passagens que deram ERRO junto com as que deram certo — o mesmo defeito que
 * `/agentes` publicava. O acumulado honesto está em `minutosAcumulados`.
 */

export { DIAS_DA_JANELA, JANELA_MS, totalDaSemana };
export type { EstadoDaMedicao, TotalDaSemana };

/** O nome antigo do tipo, mantido porque a tela e a suíte o citam. */
export type HorasDaRotina = HorasDevolvidas;

/**
 * Quantas passagens pedir por rotina.
 *
 * É o teto que `RotinasService.historico` aceita (`HISTORICO_MAXIMO = 200`):
 * pedir mais não traz mais, e pedir menos estreitaria a janela sem avisar. Uma
 * rotina de hora em hora cabe folgada (168 passagens por semana); uma de minuto
 * em minuto não cabe — e é para esse caso que existe `janelaCoberta`.
 */
export const LIMITE_DO_HISTORICO = 200;

/**
 * O desfecho de rotina que DEVOLVE tempo.
 *
 * Só `ok`. `erro` devolve retrabalho, e `pulada` nem chega a virar linha no log
 * (ver o comentário de `RotinaExecucao` no schema).
 */
function devolveuTempo(status: string): boolean {
  return status === 'ok';
}

type RotinaMedivel = Pick<RotinaResumo, 'minutosPorExecucao' | 'execucoes' | 'falhas'>;

/**
 * A medição de UMA rotina.
 *
 * `historico` é o que voltou de `/rotinas/:id/execucoes?limite=LIMITE_DO_HISTORICO`
 * — `undefined` enquanto não chegou. `agora` entra por parâmetro (e não sai de
 * `Date.now()` aqui dentro) para que a conta seja testável com relógio preso.
 */
export function horasDaRotina(
  rotina: RotinaMedivel,
  historico: ExecucaoResumo[] | undefined,
  agora: number,
  limitePedido: number = LIMITE_DO_HISTORICO,
): HorasDaRotina {
  // Acumulado honesto: as que deram certo. `execucoes` soma ok + erro, e
  // `falhas` é o pedaço que deu errado (ver `RotinasService.registrarDesfecho`).
  const bemSucedidas = Math.max(rotina.execucoes - rotina.falhas, 0);

  return horasDevolvidas(
    rotina.minutosPorExecucao,
    bemSucedidas,
    historico
      ? janelaDeLog(
          historico.map((e) => ({ quandoIso: e.inicioEm, bomDesfecho: devolveuTempo(e.status) })),
          agora,
          limitePedido,
        )
      : null,
  );
}
