import type { BloqueioFixo, FeriadoDaAgenda, RitoDaAgenda } from '@mktos/shared';

/*
 * O TEXTO DA ABA REGRAS (agenda v2, 29/10/2026, lane G2). Conta pura, sem React,
 * no formato do desenho `Regras`: "qui a partir de 19:00", "ter 08:00 · 1 h",
 * "1º sáb · dia inteiro", os próximos feriados.
 */

export const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** "qui a partir de 19:00" · "sex das 16:00 às 18:00". */
export function textoDoBloqueio(b: BloqueioFixo): string {
  const d = DIAS_CURTOS[b.diaDaSemana] ?? '?';
  return b.fim ? `${d} das ${b.inicio} às ${b.fim}` : `${d} a partir de ${b.inicio}`;
}

export function textoDosBloqueios(bs: readonly BloqueioFixo[]): string {
  return bs.length ? bs.map(textoDoBloqueio).join(' · ') : 'nenhum';
}

/** "1 h" · "1h30" · "45 min" · "dia inteiro". */
export function textoDaDuracao(min: number): string {
  if (min >= 1440) return 'dia inteiro';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h} h`;
}

/** "ter 08:00 · 1 h" · "1º sáb · dia inteiro". */
export function quandoDoRito(r: Pick<RitoDaAgenda, 'diaDaSemana' | 'ordinalNoMes' | 'inicio' | 'duracaoMin'>): string {
  const dia = `${r.ordinalNoMes ? `${r.ordinalNoMes}º ` : ''}${DIAS_CURTOS[r.diaDaSemana] ?? '?'}`;
  if (!r.inicio) return `${dia} · dia inteiro`;
  return `${dia} ${r.inicio} · ${textoDaDuracao(r.duracaoMin)}`;
}

export const POLITICA_DO_RITO: Record<RitoDaAgenda['politica'], string> = { pergunta: 'pergunta antes', bloqueia: 'bloqueia' };

/** Os próximos feriados LIGADOS que fecham ou avisam, a partir de `hoje` (`AAAA-MM-DD`): "02/11 Finados". */
export function proximosFeriados(feriados: readonly FeriadoDaAgenda[], hoje: string, n = 3): string[] {
  const vistos = new Set<string>();
  return [...feriados]
    .filter((f) => f.ligado && f.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
    .filter((f) => (vistos.has(f.data) ? false : (vistos.add(f.data), true)))
    .slice(0, n)
    .map((f) => `${f.data.slice(8, 10)}/${f.data.slice(5, 7)} ${f.nome}`);
}

/** Os nomes dos facultativos, sem repetir ("Carnaval, Corpus Christi"). */
export function nomesDosFacultativos(feriados: readonly FeriadoDaAgenda[]): string {
  return [...new Set(feriados.filter((f) => f.tipo === 'facultativo').map((f) => f.nome))].join(', ');
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ehHora = (v: string): boolean => HORA.test(v);

/** Hoje (`AAAA-MM-DD`) em São Paulo. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
