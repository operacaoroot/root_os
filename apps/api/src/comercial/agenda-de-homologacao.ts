/*
 * A AGENDA DE HOMOLOGAÇÃO — os horários oferecidos ao lead (telas 01 e 02), Lane B.
 *
 * VALOR DE HOMOLOGAÇÃO. A agenda real da Root (de quem, quais dias, quantos
 * minutos de folga) é [a decidir]: ninguém decidiu ainda e este arquivo não
 * decide por ninguém. Para a jornada rodar de ponta a ponta, a homologação
 * oferece uma grade determinística: os próximos três dias úteis, às 10h e às
 * 15h de São Paulo, a partir do dia seguinte. A sala e a M2 mostram a marca
 * `AGENDA_DE_HOMOLOGACAO` para ninguém tomar a grade por promessa.
 *
 * São Paulo não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
 * Feriado não está na conta (é parte da agenda real, [a decidir]).
 */

export const AGENDA_DE_HOMOLOGACAO = true;
export const DURACAO_DA_CONVERSA_MIN = 40;
export const HORAS_OFERECIDAS = [10, 15] as const;
export const DIAS_UTEIS_OFERECIDOS = 3;

const DESLOCAMENTO_SP_MS = 3 * 3_600_000;
const DIA_MS = 86_400_000;
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** O dia civil de São Paulo de um instante: { ano, mes (1-12), dia, semana (0 = domingo) }. */
function diaEmSP(instante: Date): { ano: number; mes: number; dia: number; semana: number } {
  const local = new Date(instante.getTime() - DESLOCAMENTO_SP_MS);
  return { ano: local.getUTCFullYear(), mes: local.getUTCMonth() + 1, dia: local.getUTCDate(), semana: local.getUTCDay() };
}

function doisDigitos(n: number): string {
  return n.toString().padStart(2, '0');
}

/** ISO com o fuso de São Paulo escrito: `2026-10-16T10:00:00-03:00`. */
export function isoEmSP(ano: number, mes: number, dia: number, hora: number): string {
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}T${doisDigitos(hora)}:00:00-03:00`;
}

/** Os horários oferecidos a partir de `agora`: seis, em ordem. */
export function horariosOferecidos(agora: Date = new Date()): string[] {
  const out: string[] = [];
  let cursor = new Date(agora.getTime() + DIA_MS);
  for (let guarda = 0; out.length < DIAS_UTEIS_OFERECIDOS * HORAS_OFERECIDAS.length && guarda < 14; guarda++) {
    const d = diaEmSP(cursor);
    if (d.semana !== 0 && d.semana !== 6) {
      for (const h of HORAS_OFERECIDAS) out.push(isoEmSP(d.ano, d.mes, d.dia, h));
    }
    cursor = new Date(cursor.getTime() + DIA_MS);
  }
  return out;
}

/** "Qui 16/10 · 10h", como a tela 01 mostra. */
export function rotuloDoHorario(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const local = new Date(t.getTime() - DESLOCAMENTO_SP_MS);
  const min = local.getUTCMinutes();
  return `${DIAS[local.getUTCDay()]} ${doisDigitos(local.getUTCDate())}/${doisDigitos(local.getUTCMonth() + 1)} · ${local.getUTCHours()}h${min ? doisDigitos(min) : ''}`;
}

/** A data curta de São Paulo ("24/10"), para a validade da proposta. */
export function dataCurtaSP(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso) : iso;
  const local = new Date(t.getTime() - DESLOCAMENTO_SP_MS);
  return `${doisDigitos(local.getUTCDate())}/${doisDigitos(local.getUTCMonth() + 1)}`;
}

/** O horário escolhido está entre os oferecidos? Compara o instante, não o texto. */
export function horarioOferecido(horario: string, oferecidos: readonly string[]): boolean {
  const alvo = new Date(horario).getTime();
  if (Number.isNaN(alvo)) return false;
  return oferecidos.some((o) => new Date(o).getTime() === alvo);
}
