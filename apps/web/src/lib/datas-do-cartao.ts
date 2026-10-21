/*
 * AS DATAS DO CARTÃO (rodada de produção 1, 21/10/2026): "as datas estão esquisitas".
 *
 * O que estava errado no quadro: o `toLocaleDateString` sem fuso formatava no fuso do
 * NAVEGADOR (quem abria fora de Brasília via outro dia), a data que diz um DIA (gravada
 * à meia-noite UTC, como o trilho grava "2026-09-22") voltava um dia em Brasília, e uma
 * data ilegível virava "Invalid Date" na tela. A régua daqui é uma só:
 *
 *   · instante de verdade (prazo do quadro, marco, movimento) → relógio de São Paulo;
 *   · meia-noite UTC em ponto → é um DIA, formatado em UTC (não escorrega);
 *   · ilegível ou ausente → nada (`null`): a tela não mostra data inventada.
 *
 * No cartão a data é curta (`dd/mm`); o dia da semana vai no balão e no `title`.
 */

const FUSO = 'America/Sao_Paulo';

function lida(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Meia-noite UTC em ponto é um DIA (a data do trilho): formata em UTC. O resto é instante em São Paulo. */
export function fusoDaData(d: Date): string {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 ? 'UTC' : FUSO;
}

/** O dia AAAA-MM-DD de uma data, pela régua acima. */
export function diaDe(iso: string | null | undefined): string | null {
  const d = lida(iso);
  return d ? d.toLocaleDateString('en-CA', { timeZone: fusoDaData(d) }) : null;
}

/** "21/10". */
export function diaCurto(iso: string | null | undefined): string | null {
  const d = lida(iso);
  return d ? d.toLocaleDateString('pt-BR', { timeZone: fusoDaData(d), day: '2-digit', month: '2-digit' }) : null;
}

/** "21/10/2026". */
export function diaCompleto(iso: string | null | undefined): string | null {
  const d = lida(iso);
  return d ? d.toLocaleDateString('pt-BR', { timeZone: fusoDaData(d), day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
}

/** "terça-feira, 21/10/2026". */
export function diaComSemana(iso: string | null | undefined): string | null {
  const d = lida(iso);
  if (!d) return null;
  const tz = fusoDaData(d);
  const semana = d.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long' });
  return `${semana}, ${diaCompleto(iso)}`;
}

/** "terça-feira, 21/10/2026 às 14:05" (instante, em São Paulo). */
export function instanteComSemana(iso: string | null | undefined): string | null {
  const d = lida(iso);
  if (!d) return null;
  if (fusoDaData(d) === 'UTC') return diaComSemana(iso);
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  return `${diaComSemana(iso)} às ${hora}`;
}

/** "21/10/2026 14:05" (o formato curto de instante do painel), em São Paulo. */
export function instanteCurto(iso: string | null | undefined): string | null {
  const d = lida(iso);
  return d ? d.toLocaleString('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }) : null;
}

export interface ProximaData {
  iso: string;
  origem: 'prazo' | 'proximo_passo';
  /** O dia já passou (em São Paulo). */
  passou: boolean;
}

/**
 * A próxima data real do cartão: o prazo da tarefa e o do próximo passo (do trilho ou da
 * subtarefa). A mais próxima de hoje em diante; sem nenhuma futura, a mais recente que
 * passou (atrasada). Sem data, nada.
 */
export function proximaDataDoCartao(
  c: { dueDate: string | null | undefined; proximoPassoEm?: string | null },
  agora: Date = new Date(),
): ProximaData | null {
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: FUSO });
  const candidatas: ProximaData[] = [];
  for (const [iso, origem] of [[c.dueDate, 'prazo'], [c.proximoPassoEm, 'proximo_passo']] as const) {
    const dia = diaDe(iso ?? null);
    if (iso && dia) candidatas.push({ iso, origem, passou: dia < hoje });
  }
  const futuras = candidatas.filter((x) => !x.passou).sort((a, b) => diaDe(a.iso)!.localeCompare(diaDe(b.iso)!));
  if (futuras.length) return futuras[0];
  return candidatas.sort((a, b) => diaDe(b.iso)!.localeCompare(diaDe(a.iso)!))[0] ?? null;
}

export const ROTULO_DA_ORIGEM_DA_DATA: Record<ProximaData['origem'], string> = {
  prazo: 'prazo da tarefa',
  proximo_passo: 'próximo passo',
};
