import type { EventoDaAgenda } from './tipos';

/*
 * ============================================================================
 * AS DUAS GRADES DA AGENDA — mês e semana
 * ============================================================================
 *
 * Tudo aqui é função pura, sem React e sem fetch, porque é a parte que erra em
 * silêncio: contagem de dia, virada de mês, semana que começa no domingo e
 * evento colocado na altura errada da coluna. Erro de grade não estoura — ele
 * desenha uma reunião na quarta quando ela é na quinta, e quem olha acredita.
 * Com as regras aqui, `apps/web/tests/unit/agenda-grade.test.ts` mede cada uma.
 *
 * AS DUAS VISÕES respondem perguntas diferentes e por isso coexistem:
 *   MÊS    — quanto a semana que vem já está cheia; onde cabe a próxima.
 *   SEMANA — a que horas cada coisa é, lado a lado, que é o que se olha antes
 *            de marcar às 14h e descobrir que já tem reunião às 14h30.
 *
 * FUSO: a grade é montada no relógio de quem está olhando. Evento de dia
 * inteiro nunca passa por `new Date()` — ver `diaDoEvento` em `tipos.ts`.
 */

export type Visao = 'mes' | 'semana';

/** O domingo da semana de `d`, à meia-noite. */
export function inicioDaSemana(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export const primeiroDoMes = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

/**
 * Os dias desenhados: 42 no mês (6×7, começando no domingo anterior ao dia 1º)
 * e 7 na semana. O mês tem sempre 42 e não "o que couber" porque grade que muda
 * de altura a cada mês faz o calendário pular na tela ao trocar de página.
 */
export function diasDaGrade(visao: Visao, ancora: Date): Date[] {
  const comeco = visao === 'semana' ? inicioDaSemana(ancora) : inicioDaSemana(primeiroDoMes(ancora));
  const quantos = visao === 'semana' ? 7 : 42;
  return Array.from({ length: quantos }, (_, i) => {
    const d = new Date(comeco);
    d.setDate(comeco.getDate() + i);
    return d;
  });
}

/**
 * O intervalo pedido à API. O fim é o dia seguinte ao último desenhado, à
 * meia-noite: `timeMax` do Google é exclusivo, e parar na meia-noite do último
 * dia esconderia tudo o que acontece nele.
 */
export function periodoDaBusca(visao: Visao, ancora: Date): { de: Date; ate: Date } {
  const dias = diasDaGrade(visao, ancora);
  const de = dias[0];
  const ate = new Date(dias[dias.length - 1]);
  ate.setDate(ate.getDate() + 1);
  return { de, ate };
}

/** Anda uma semana ou um mês, conforme a visão. */
export function mover(visao: Visao, ancora: Date, passo: number): Date {
  if (visao === 'semana') {
    const d = new Date(ancora);
    d.setDate(d.getDate() + 7 * passo);
    return d;
  }
  return new Date(ancora.getFullYear(), ancora.getMonth() + passo, 1);
}

/**
 * O que vai escrito entre as setas.
 *
 * Na semana, o mês só aparece dos dois lados quando a semana atravessa a
 * virada ("28 de setembro – 4 de outubro"); dentro do mesmo mês ele é dito uma
 * vez ("21 – 27 de setembro"). Repetir o mês nos dois números é o tipo de
 * ruído que ninguém reclama e todo mundo lê duas vezes.
 */
export function rotuloDoPeriodo(visao: Visao, ancora: Date): string {
  if (visao === 'mes') {
    return ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  const dias = diasDaGrade('semana', ancora);
  const primeiro = dias[0];
  const ultimo = dias[6];
  const mesDe = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'long' });
  if (primeiro.getMonth() === ultimo.getMonth()) {
    return `${primeiro.getDate()} – ${ultimo.getDate()} de ${mesDe(ultimo)}`;
  }
  return `${primeiro.getDate()} de ${mesDe(primeiro)} – ${ultimo.getDate()} de ${mesDe(ultimo)}`;
}

/** A primeira e a última hora desenhadas na coluna do dia. */
export interface FaixaDeHoras {
  primeira: number;
  ultima: number;
}

/** O expediente presumido, quando a semana não tem nada fora dele. */
export const FAIXA_PADRAO: FaixaDeHoras = { primeira: 8, ultima: 19 };

/**
 * A faixa de horas que a semana precisa mostrar.
 *
 * Começa no expediente e ABRE para caber o que existe: reunião às 7h e jantar
 * às 21h têm de aparecer. Não encolhe abaixo do padrão — uma semana com uma
 * reunião só desenharia uma tira de duas horas no meio da tela.
 *
 * Evento de dia inteiro não conta: ele mora na faixa de cima, fora da grade.
 */
export function faixaDeHoras(eventos: readonly EventoDaAgenda[]): FaixaDeHoras {
  let { primeira, ultima } = FAIXA_PADRAO;
  for (const e of eventos) {
    if (e.diaInteiro || !e.start) continue;
    const ini = new Date(e.start);
    primeira = Math.min(primeira, ini.getHours());
    if (e.end) {
      const fim = new Date(e.end);
      // Uma reunião que termina 19h30 precisa da linha das 20h para caber.
      const arredondado = fim.getMinutes() > 0 ? fim.getHours() + 1 : fim.getHours();
      ultima = Math.max(ultima, arredondado);
    }
  }
  return { primeira: Math.max(0, primeira), ultima: Math.min(24, Math.max(ultima, primeira + 1)) };
}

/**
 * Onde o evento fica na coluna do dia, em porcentagem da altura.
 *
 * `null` para dia inteiro — ele não tem lugar numa régua de horas. Evento que
 * começa antes da faixa ou termina depois dela é CORTADO nas bordas, e não
 * empurrado para dentro: desenhá-lo inteiro estouraria a coluna, e escondê-lo
 * seria pior ainda.
 */
export function posicaoNaFaixa(
  e: EventoDaAgenda,
  faixa: FaixaDeHoras,
): { topo: number; altura: number } | null {
  if (e.diaInteiro || !e.start) return null;
  const minutosDaFaixa = (faixa.ultima - faixa.primeira) * 60;
  if (minutosDaFaixa <= 0) return null;

  const ini = new Date(e.start);
  const fim = e.end ? new Date(e.end) : new Date(ini.getTime() + 30 * 60_000);
  const emMinutos = (d: Date) => d.getHours() * 60 + d.getMinutes();

  const comeco = Math.max(emMinutos(ini) - faixa.primeira * 60, 0);
  const termino = Math.min(emMinutos(fim) - faixa.primeira * 60, minutosDaFaixa);
  if (termino <= 0 || comeco >= minutosDaFaixa) return null;

  return {
    topo: (comeco / minutosDaFaixa) * 100,
    altura: (Math.max(termino - comeco, 15) / minutosDaFaixa) * 100,
  };
}
