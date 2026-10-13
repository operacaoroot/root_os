import { instanteNoFuso, partesNoFuso, somarDias } from '@mktos/shared';

import { fusoDaPolitica } from '../policy/limites';

/*
 * A HORA DO COMERCIAL NO FUSO DA POLÍTICA (revisão E-17, E-18, 13/10/2026).
 *
 * A regra da casa: hora de São Paulo é lida em `POLITICA_FUSO_HORARIO` pelo
 * `partesNoFuso`/`instanteNoFuso` do shared, nunca por `-3 h` fixo nem pelo dia
 * UTC do `toISOString`. Sem horário de verão hoje, o resultado é o mesmo; com
 * horário de verão de volta no tzdata, continua certo.
 */

/** O dia civil (AAAA-MM-DD) de `agora` no fuso da política. */
export function diaNaPolitica(agora: Date, fuso: string = fusoDaPolitica()): string {
  return partesNoFuso(agora, fuso).dia;
}

/** A meia-noite do dia de `agora` no fuso. */
export function inicioDoDiaNoFuso(agora: Date, fuso: string = fusoDaPolitica()): Date {
  return instanteNoFuso(diaNaPolitica(agora, fuso), '00:00', fuso);
}

/** A próxima vez em que o relógio do fuso marca `hora` cheia (0 a 23) depois de `agora` (a de hoje, se ainda não passou). */
export function proximaHoraNoFuso(agora: Date, hora: number, fuso: string = fusoDaPolitica()): Date {
  const hh = `${String(hora).padStart(2, '0')}:00`;
  const dia = diaNaPolitica(agora, fuso);
  const hoje = instanteNoFuso(dia, hh, fuso);
  return hoje.getTime() > agora.getTime() ? hoje : instanteNoFuso(somarDias(dia, 1), hh, fuso);
}

/** O último segundo de `dia` no fuso, escrito com o desvio do fuso (`AAAA-MM-DDT23:59:59-03:00`). */
export function fimDoDiaComDesvio(dia: string, fuso: string = fusoDaPolitica()): string {
  const [a, m, d] = dia.split('-').map(Number);
  const desvioMin = Math.round((Date.UTC(a, m - 1, d, 23, 59) - instanteNoFuso(dia, '23:59', fuso).getTime()) / 60_000);
  const sinal = desvioMin < 0 ? '-' : '+';
  const abs = Math.abs(desvioMin);
  return `${dia}T23:59:59${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
