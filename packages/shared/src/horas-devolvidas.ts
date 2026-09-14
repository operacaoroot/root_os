/* ==========================================================================
 * HORAS DEVOLVIDAS — UMA CONTA, DOIS DONOS (RF-N-05, fatia A3)
 * ==========================================================================
 *
 * Este é o número que sustenta renovação e venda, e por isso ele é o número que
 * mais precisa de procedência. Nada aqui é estimado, arredondado para cima ou
 * preenchido com padrão: quando uma parcela não existe, o resultado diz que não
 * existe, e a tela mostra travessão.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTA CONTA MUDOU DE CASA
 * ----------------------------------------------------------------------------
 * Ela nasceu em `apps/web/src/app/rotinas/horas.ts`, servindo só `/rotinas`.
 * `/agentes` tinha OUTRA conta, escrita direto na resposta do roster:
 *
 *     minutosPorExecucao × Agent.execucoes / 60      ← o que /agentes publicava
 *
 * `Agent.execucoes` é contador de VIDA INTEIRA e soma as passagens que
 * FALHARAM. A tela chamava o resultado de "horas devolvidas" no cartão que a
 * outra tela chamava de "por semana", e mostrava a fórmula ao lado — duas telas
 * publicando versões contraditórias do mesmo fato, uma delas inflada pelas
 * falhas. O CLAUDE.md registrava isso como dívida conhecida desde a fatia 5.6.
 *
 * A conta de `/rotinas` é a verdade, então ela virou a única: mora aqui, no
 * pacote que os dois lados alcançam, e cada superfície só traz o LOG dela. O
 * número certo é MENOR que o que `/agentes` publicava — e fica menor.
 *
 * ----------------------------------------------------------------------------
 * A CONTA, INTEIRA
 * ----------------------------------------------------------------------------
 *
 *     minutos na semana = (passagens com bom desfecho nos últimos 7 dias)
 *                         × (minutos que UMA PESSOA gastava por passagem)
 *
 * De onde vem cada metade:
 *
 *   · A PRIMEIRA é MEDIDA, do log real de passagens — `RotinaExecucao` para as
 *     rotinas, `Session` para os agentes. É dado de linha, nunca contador
 *     acumulado: contador não sabe dizer QUANDO, e "por semana" é uma pergunta
 *     sobre quando.
 *   · A SEGUNDA é DECLARADA por uma pessoa, na tela
 *     (`Rotina.minutosPorExecucao` / `Agent.minutosPorExecucao`, com autor e
 *     data ao lado). Sem essa declaração não há conta nenhuma a fazer: zero no
 *     banco quer dizer "ninguém informou", e o resultado é `sem-linha-de-base`
 *     — nunca um padrão inventado, nunca zero minuto apresentado como medição.
 *
 * O QUE NÃO ENTRA, e por quê:
 *
 *   · PASSAGEM QUE FALHOU não devolve tempo — devolve retrabalho.
 *   · PASSAGEM QUE FICOU RETIDA esperando aprovação também não: alguém ainda
 *     tem de assinar, e até assinar o trabalho não foi entregue (é o caso do
 *     agente; ver `DESFECHO_BOM_DE_SESSAO` em `apps/api/src/agents`).
 *   · PASSAGEM `pulada` de rotina nem chega a virar linha no log.
 *   · Contador de vida inteira NÃO entra em nada que se chame "semana". Ele
 *     aparece em `minutosAcumulados`, com esse nome, e a tela diz que é
 *     acumulado.
 *
 * ORIGEM `manual` CONTA. Alguém ter clicado em "rodar agora" ou em "invocar"
 * não muda quem fez o trabalho: a máquina fez. O que a pessoa gastou foi o
 * clique, não os minutos da linha de base.
 */

/** A janela da medição. Sete dias corridos, contados para trás de agora. */
export const DIAS_DA_JANELA = 7;
export const JANELA_MS = DIAS_DA_JANELA * 24 * 60 * 60 * 1000;

export type EstadoDaMedicao =
  /** Ninguém declarou quantos minutos uma pessoa gastava. Não há o que contar. */
  | 'sem-linha-de-base'
  /** Há linha de base, mas o log de passagens desta linha ainda não chegou. */
  | 'sem-historico'
  /** Dá para somar. */
  | 'medida';

/** O que a janela de sete dias rendeu, já contado — de SQL ou de lista. */
export interface PassagensDaJanela {
  /** Passagens com bom desfecho dentro dos 7 dias. Medido, nunca acumulado. */
  bemSucedidasNaJanela: number;
  /**
   * O log lido alcança os 7 dias inteiros?
   *
   * `false` quer dizer que o que se mediu é um PEDAÇO da semana — o log veio
   * truncado por teto de página. O número vira piso, não total, e a tela precisa
   * dizer isso: um piso apresentado como total é a forma mais discreta de mentir
   * num número de venda.
   */
  janelaCoberta: boolean;
  /** O instante mais antigo que o log lido alcança. ISO, ou `null`. */
  cobreDesde: string | null;
}

export interface HorasDevolvidas {
  estado: EstadoDaMedicao;
  /** A linha de base declarada, em minutos. `null` = ninguém declarou. */
  minutosPorExecucao: number | null;
  /** Passagens com bom desfecho dentro da janela de 7 dias. */
  execucoesNaSemana: number;
  /** `null` sempre que `estado !== 'medida'`. */
  minutosNaSemana: number | null;
  /** Passagens com bom desfecho desde sempre — contador, não log. */
  execucoesBemSucedidas: number;
  /** `null` quando não há linha de base. É ACUMULADO, e a tela diz isso. */
  minutosAcumulados: number | null;
  janelaCoberta: boolean;
  cobreDesde: string | null;
}

/**
 * A medição de UMA linha — rotina ou agente.
 *
 * `janela` é `null` quando o log ainda não chegou (a tela está carregando, ou o
 * pedido dele falhou). Isso é `sem-historico`, e NÃO é zero: zero medido quer
 * dizer "a linha existe, tem base declarada e não passou esta semana", que é
 * informação de verdade.
 *
 * `acumuladoBemSucedido` é o contador de vida inteira JÁ descontado das falhas.
 * Ele não toca em `minutosNaSemana` — é a separação que esta fatia existe para
 * garantir.
 */
export function horasDevolvidas(
  minutosPorExecucao: number | null,
  acumuladoBemSucedido: number,
  janela: PassagensDaJanela | null,
): HorasDevolvidas {
  const base = minutosPorExecucao;
  const bemSucedidas = Math.max(Math.trunc(acumuladoBemSucedido) || 0, 0);

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

  if (!janela) {
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

  return {
    estado: 'medida',
    minutosPorExecucao: base,
    execucoesNaSemana: janela.bemSucedidasNaJanela,
    minutosNaSemana: base * janela.bemSucedidasNaJanela,
    execucoesBemSucedidas: bemSucedidas,
    minutosAcumulados: base * bemSucedidas,
    janelaCoberta: janela.janelaCoberta,
    cobreDesde: janela.cobreDesde,
  };
}

/** Uma passagem do log, no mínimo que esta conta precisa saber dela. */
export interface PassagemDoLog {
  /** Quando a passagem COMEÇOU, em ISO. Carimbo ilegível é descartado. */
  quandoIso: string;
  /** O desfecho devolveu tempo? Falha e retenção não devolvem. */
  bomDesfecho: boolean;
}

/**
 * Varre um log já carregado e devolve a janela.
 *
 * `limitePedido` é o teto que se pediu ao endpoint do histórico: quando o log
 * volta com exatamente esse tamanho, pode haver passagem que não caiu na
 * página, e é isso que faz `janelaCoberta` virar `false`.
 *
 * `agora` entra por parâmetro (e não sai de `Date.now()` aqui dentro) para que
 * a conta seja testável com relógio preso.
 */
export function janelaDeLog(
  passagens: PassagemDoLog[],
  agora: number,
  limitePedido: number,
): PassagensDaJanela {
  const corte = agora - JANELA_MS;
  let naSemana = 0;
  let maisAntigo: number | null = null;

  for (const p of passagens) {
    const t = Date.parse(p.quandoIso);
    // Carimbo ilegível não entra na conta nem na cobertura: contá-lo como
    // "dentro da semana" inflaria o número, e como "fora" encolheria a janela.
    if (Number.isNaN(t)) continue;
    if (maisAntigo === null || t < maisAntigo) maisAntigo = t;
    if (p.bomDesfecho && t >= corte) naSemana++;
  }

  /*
   * A janela está coberta quando o log ACABOU antes do teto (veio menos do que
   * se pediu: não há mais passagem nenhuma) ou quando a linha mais antiga que
   * veio já é anterior ao corte de 7 dias.
   */
  const janelaCoberta =
    passagens.length < limitePedido || (maisAntigo !== null && maisAntigo <= corte);

  return {
    bemSucedidasNaJanela: naSemana,
    janelaCoberta,
    cobreDesde: maisAntigo === null ? null : new Date(maisAntigo).toISOString(),
  };
}

export interface TotalDaSemana {
  /** Soma dos minutos das linhas que deu para medir. */
  minutos: number;
  /** Quantas linhas entraram na soma. */
  contadas: number;
  /** Quantas ficaram de fora por ninguém ter declarado a linha de base. */
  semLinhaDeBase: number;
  /** Quantas ficaram de fora porque o log ainda não chegou. */
  semHistorico: number;
  /** Quantas entraram como PISO, por não caberem os 7 dias no log lido. */
  parciais: number;
  /** Nenhuma linha medida: a tela mostra travessão, não zero. */
  vazio: boolean;
}

/**
 * O total da empresa.
 *
 * `vazio` é diferente de `minutos === 0`, e a diferença importa: zero minuto
 * medido quer dizer "as linhas existem, têm base e não rodaram esta semana" —
 * informação de verdade. Vazio quer dizer "não há o que somar", e mostrar "0h"
 * nesse caso seria afirmar uma medição que não aconteceu.
 */
export function totalDaSemana(medidas: HorasDevolvidas[]): TotalDaSemana {
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

/** Minutos em horas com uma casa. A tela nunca inventa a segunda. */
export function emHorasDecimais(minutos: number): number {
  return Number((minutos / 60).toFixed(1));
}
