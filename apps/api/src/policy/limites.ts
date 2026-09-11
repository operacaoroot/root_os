/*
 * OS LIMITES DA EMPRESA — a janela horária e o teto de valor.
 *
 * Módulo PURO: sem Nest, sem Prisma, sem rede. Existe para que a conta da
 * janela e a do teto morem em UM lugar só, e para que o caminho quente da porta
 * (`sinais.service.ts`) não precise importar de um arquivo chamado "simulador"
 * para fazer o trabalho dele. A dependência corre nesta direção: a porta e o
 * simulador da tela da Régua importam DAQUI, e nunca um do outro.
 *
 * Uma segunda cópia da comparação faria a tela ensinar uma janela e a porta
 * impor outra — que é exatamente o defeito que a fatia 2.3 existe para impedir.
 */

/** `'08:00'` -> 480. Devolve `NaN` para o que não for `H:MM` ou `HH:MM`. */
export function minutosDoDia(hhmm: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return Number.NaN;
  const hora = Number(m[1]);
  if (hora > 23) return Number.NaN;
  return hora * 60 + Number(m[2]);
}

/** A janela desta empresa dá para comparar com um relógio? */
export function janelaLegivel(janela: readonly [string, string]): boolean {
  return janela.every((h) => !Number.isNaN(minutosDoDia(h)));
}

/**
 * A conta da janela horária, em um lugar só.
 *
 * HORÁRIO ILEGÍVEL ACENDE O SINAL, e é falha fechada de propósito. O esquema da
 * política garante que `janelaHoraria` é um par de strings, não que elas sejam
 * `HH:MM`: um `['8h', 'oito']` no documento não dá para comparar, e não dá para
 * PROVAR que a execução está dentro da janela acordada com o cliente. Acender
 * só sobe um degrau (com teto em R4) e nunca bloqueia sozinho — enquanto o
 * contrário, calar, faria um documento malformado desligar o sinal em silêncio
 * para toda a empresa. É a mesma direção que `direcaoDaJanela()` já toma em
 * `sobrescrita.ts`.
 *
 * ISTO É MAIS ESTRITO QUE O LEITOR ANTERIOR, e a mudança é deliberada: o antigo
 * aceitava `'25:99'` e `'8h'` sem reclamar. Por isso existem as duas peças
 * abaixo — `problemasDeJanela()`, que recusa o documento malformado na hora da
 * SOBRESCRITA, e `conferirJanela()`, que grita uma vez por empresa quando um
 * documento já gravado é ilegível. Sem elas, a mudança seria silenciosa e
 * ninguém descobriria por que toda ação daquela empresa subiu um degrau.
 */
export function foraDaJanela(minutos: number, janela: readonly [string, string]): boolean {
  const [ini, fim] = janela.map(minutosDoDia);
  if (Number.isNaN(minutos) || Number.isNaN(ini) || Number.isNaN(fim)) return true;
  return minutos < ini || minutos >= fim;
}

export function acimaDoTeto(valorCentavos: number | null | undefined, teto: number): boolean {
  return valorCentavos != null && valorCentavos > teto;
}

/* ------------------------------------------------- recusa na sobrescrita --- */

/**
 * O que há de errado com a janela deste documento. Vazio = está boa.
 *
 * Quem consome é `PolicyService.sobrescrever()`, junto de `verificarCatalogo()`
 * e `verificarReversibilidade()`: a recusa cai em quem ESCREVEU o documento,
 * uma vez, com a mensagem explicando o formato — e não em toda execução da
 * empresa, para sempre, como um sinal aceso que ninguém sabe explicar.
 */
export function problemasDeJanela(janela: readonly [string, string]): string[] {
  const problemas: string[] = [];
  const [ini, fim] = janela;
  for (const [nome, valor] of [
    ['início', ini],
    ['fim', fim],
  ] as const) {
    if (Number.isNaN(minutosDoDia(valor))) {
      problemas.push(
        `limitesPadrao.janelaHoraria: ${nome} "${valor}" não é um horário no formato HH:MM ` +
          '(00:00 a 23:59). Janela ilegível acende o sinal `fora_da_janela` em TODA ação ' +
          'desta empresa, o que sobe um degrau em cada uma delas.',
      );
    }
  }
  return problemas;
}

/* ------------------------------------------------- aviso, uma vez por empresa */

/**
 * Empresas para as quais a janela ilegível já foi gritada neste processo.
 *
 * Por que uma vez e não sempre: o sinal é calculado em TODA chamada de
 * ferramenta. Avisar a cada chamada afogaria o log da empresa afetada e, o que
 * é pior, afogaria o log de todas as outras. Por que não nunca: sem esta linha,
 * a empresa inteira sobe um degrau — registro reversível vira saída externa com
 * aprovação — e não há nada em lugar nenhum que explique por quê.
 */
const JA_AVISADAS = new Set<string>();

/**
 * A janela desta empresa é legível? Grita UMA vez por empresa quando não é.
 *
 * Devolve `true` quando dá para comparar. O chamador não precisa fazer nada com
 * a resposta: `foraDaJanela()` já falha fechada sozinha. O valor existe para
 * quem quiser dizer na tela que a janela está quebrada.
 */
export function conferirJanela(
  orgId: string,
  janela: readonly [string, string],
  avisar: (mensagem: string) => void,
): boolean {
  if (janelaLegivel(janela)) return true;
  if (!JA_AVISADAS.has(orgId)) {
    JA_AVISADAS.add(orgId);
    avisar(
      `empresa ${orgId}: a janela horária da política é ILEGÍVEL ` +
        `(${JSON.stringify(janela)}) — o sinal \`fora_da_janela\` fica aceso em toda ação ` +
        'desta empresa, o que sobe um degrau em cada uma. Corrija a sobrescrita ' +
        '(`limitesPadrao.janelaHoraria`) com dois horários no formato HH:MM.',
    );
  }
  return false;
}

/** Só para teste: zera a memória de quem já foi avisado. */
export function esquecerAvisosDeJanela(): void {
  JA_AVISADAS.clear();
}
