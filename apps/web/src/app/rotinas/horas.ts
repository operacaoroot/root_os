import type { ExecucaoResumo, RotinaResumo } from './tipos';

/* ==========================================================================
 * HORAS DEVOLVIDAS — RF-N-05
 * ==========================================================================
 *
 * Este é o número que sustenta renovação e venda, e por isso ele é o número que
 * mais precisa de procedência. Nada aqui é estimado, arredondado para cima ou
 * preenchido com padrão: quando uma parcela não existe, o resultado diz que não
 * existe, e a tela mostra travessão.
 *
 * A CONTA, INTEIRA:
 *
 *     minutos na semana = (execuções com desfecho `ok` nos últimos 7 dias)
 *                         × (minutos que UMA PESSOA gastava por execução)
 *
 * De onde vem cada metade:
 *
 *   · A PRIMEIRA é medida. Sai de `RotinaExecucao` — uma linha por passagem,
 *     com carimbo de início e desfecho —, lida por `/rotinas/:id/execucoes`.
 *     É dado do banco, não contador acumulado.
 *   · A SEGUNDA é DECLARADA por uma pessoa, na própria tela
 *     (`Rotina.minutosPorExecucao`, com `baselinePorId` e `baselineEm` dizendo
 *     quem e quando). Sem essa declaração não há conta nenhuma a fazer: zero no
 *     banco quer dizer "ninguém informou", e o resultado é
 *     `sem-linha-de-base` — nunca um padrão inventado, nunca zero minuto
 *     apresentado como se fosse uma medição.
 *
 * O QUE NÃO ENTRA, e por quê:
 *
 *   · EXECUÇÃO QUE FALHOU não devolve tempo nenhum — devolve retrabalho. Só
 *     `status === 'ok'` conta.
 *   · EXECUÇÃO `pulada` nem chega a virar linha (o executor acordou e não havia
 *     o que fazer — ver o comentário de `RotinaExecucao` no schema).
 *   · `RotinaResumo.minutosDevolvidos`, que a API já manda, NÃO é usado aqui.
 *     Ele é `minutosPorExecucao × Rotina.execucoes`, e `execucoes` soma as
 *     passagens que deram ERRO junto com as que deram certo — um número de
 *     venda inflado pelas falhas. O acumulado honesto está em
 *     `minutosAcumulados` abaixo, e o conserto do campo da API está no
 *     relatório da fatia (FORA DO ESCOPO).
 *
 * ORIGEM `manual` CONTA. Alguém ter clicado em "rodar agora" não muda quem fez
 * o trabalho: a máquina fez. O que a pessoa gastou foi o clique, não os minutos
 * da linha de base.
 */

/** A janela da medição. Sete dias corridos, contados para trás de agora. */
export const DIAS_DA_JANELA = 7;
export const JANELA_MS = DIAS_DA_JANELA * 24 * 60 * 60 * 1000;

/**
 * Quantas passagens pedir por rotina.
 *
 * É o teto que `RotinasService.historico` aceita (`HISTORICO_MAXIMO = 200`):
 * pedir mais não traz mais, e pedir menos estreitaria a janela sem avisar. Uma
 * rotina de hora em hora cabe folgada (168 passagens por semana); uma de minuto
 * em minuto não cabe — e é para esse caso que existe `janelaCoberta`.
 */
export const LIMITE_DO_HISTORICO = 200;

export type EstadoDaMedicao =
  /** Ninguém declarou quantos minutos uma pessoa gastava. Não há o que contar. */
  | 'sem-linha-de-base'
  /** Há linha de base, mas o histórico desta rotina ainda não chegou. */
  | 'sem-historico'
  /** Dá para somar. */
  | 'medida';

export interface HorasDaRotina {
  estado: EstadoDaMedicao;
  /** A linha de base declarada, em minutos. `null` = ninguém declarou. */
  minutosPorExecucao: number | null;
  /** Passagens com desfecho `ok` dentro da janela de 7 dias. */
  execucoesNaSemana: number;
  /** `null` sempre que `estado !== 'medida'`. */
  minutosNaSemana: number | null;
  /** Passagens com desfecho `ok` desde sempre — contador, não log. */
  execucoesBemSucedidas: number;
  /** `null` quando não há linha de base. */
  minutosAcumulados: number | null;
  /**
   * O histórico lido alcança os 7 dias inteiros?
   *
   * `false` quer dizer que a rotina passou mais de `LIMITE_DO_HISTORICO` vezes
   * na janela e o que se mediu é um PEDAÇO dela. O número vira piso, não total,
   * e a tela precisa dizer isso — um piso apresentado como total é a forma mais
   * discreta de mentir num número de venda.
   */
  janelaCoberta: boolean;
  /** O instante mais antigo que o histórico lido alcança. ISO, ou `null`. */
  cobreDesde: string | null;
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
  const base = rotina.minutosPorExecucao;
  // Acumulado honesto: as que deram certo. `execucoes` soma ok + erro, e
  // `falhas` é o pedaço que deu errado (ver `RotinasService.registrarDesfecho`).
  const bemSucedidas = Math.max(rotina.execucoes - rotina.falhas, 0);

  if (base === null || base <= 0) {
    return {
      estado: 'sem-linha-de-base',
      minutosPorExecucao: null,
      execucoesNaSemana: 0,
      minutosNaSemana: null,
      execucoesBemSucedidas: bemSucedidas,
      minutosAcumulados: null,
      janelaCoberta: false,
      cobreDesde: null,
    };
  }

  if (!historico) {
    return {
      estado: 'sem-historico',
      minutosPorExecucao: base,
      execucoesNaSemana: 0,
      minutosNaSemana: null,
      execucoesBemSucedidas: bemSucedidas,
      minutosAcumulados: base * bemSucedidas,
      janelaCoberta: false,
      cobreDesde: null,
    };
  }

  const corte = agora - JANELA_MS;
  let naSemana = 0;
  let maisAntigo: number | null = null;

  for (const e of historico) {
    const t = Date.parse(e.inicioEm);
    // Carimbo ilegível não entra na conta nem na cobertura: contá-lo como
    // "dentro da semana" inflaria o número, e como "fora" encolheria a janela.
    if (Number.isNaN(t)) continue;
    if (maisAntigo === null || t < maisAntigo) maisAntigo = t;
    if (e.status === 'ok' && t >= corte) naSemana++;
  }

  /*
   * A janela está coberta quando o histórico ACABOU antes do teto (veio menos
   * do que se pediu: não há mais passagem nenhuma) ou quando a linha mais
   * antiga que veio já é anterior ao corte de 7 dias.
   */
  const janelaCoberta =
    historico.length < limitePedido || (maisAntigo !== null && maisAntigo <= corte);

  return {
    estado: 'medida',
    minutosPorExecucao: base,
    execucoesNaSemana: naSemana,
    minutosNaSemana: base * naSemana,
    execucoesBemSucedidas: bemSucedidas,
    minutosAcumulados: base * bemSucedidas,
    janelaCoberta,
    cobreDesde: maisAntigo === null ? null : new Date(maisAntigo).toISOString(),
  };
}

export interface TotalDaSemana {
  /** Soma dos minutos das rotinas que deu para medir. */
  minutos: number;
  /** Quantas rotinas entraram na soma. */
  contadas: number;
  /** Quantas ficaram de fora por ninguém ter declarado a linha de base. */
  semLinhaDeBase: number;
  /** Quantas ficaram de fora porque o histórico ainda não chegou. */
  semHistorico: number;
  /** Quantas entraram como PISO, por não caberem os 7 dias no histórico lido. */
  parciais: number;
  /** Nenhuma rotina medida: a tela mostra travessão, não zero. */
  vazio: boolean;
}

/**
 * O total da empresa.
 *
 * `vazio` é diferente de `minutos === 0`, e a diferença importa: zero minuto
 * medido quer dizer "as rotinas existem, têm linha de base e não rodaram esta
 * semana" — informação de verdade. Vazio quer dizer "não há o que somar", e
 * mostrar "0h" nesse caso seria afirmar uma medição que não aconteceu.
 */
export function totalDaSemana(medidas: HorasDaRotina[]): TotalDaSemana {
  let minutos = 0;
  let contadas = 0;
  let semLinhaDeBase = 0;
  let semHistorico = 0;
  let parciais = 0;

  for (const m of medidas) {
    if (m.estado === 'sem-linha-de-base') {
      semLinhaDeBase++;
      continue;
    }
    if (m.estado === 'sem-historico') {
      semHistorico++;
      continue;
    }
    minutos += m.minutosNaSemana ?? 0;
    contadas++;
    if (!m.janelaCoberta) parciais++;
  }

  return { minutos, contadas, semLinhaDeBase, semHistorico, parciais, vazio: contadas === 0 };
}
