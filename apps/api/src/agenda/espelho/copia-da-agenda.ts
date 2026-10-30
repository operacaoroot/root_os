import type { EventoDaAgenda } from '@mktos/shared';

/*
 * A CÓPIA DIÁRIA DA AGENDA EM ARQUIVO (agenda v2, 29/10/2026, lane G7) — a parte pura.
 *
 * `jsonDaCopia` e `icsDaCopia` montam os dois arquivos a partir das linhas do
 * espelho; `chavesParaApagar` decide quais cópias antigas do próprio prefixo
 * saem (só as do OS: `agenda/copia/AAAA-MM-DD.json|.ics`, nada mais).
 */

export const PREFIXO_DA_COPIA = 'agenda/copia/';
export const DIAS_GUARDADOS = 30;
const CHAVE_DA_COPIA = /^agenda\/copia\/(\d{4}-\d{2}-\d{2})\.(json|ics)$/;

/** `AAAA-MM-DD` do instante em São Paulo. */
export function diaEmSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function chavesDaCopia(dia: string): { json: string; ics: string } {
  return { json: `${PREFIXO_DA_COPIA}${dia}.json`, ics: `${PREFIXO_DA_COPIA}${dia}.ics` };
}

/** As cópias mais velhas que os 30 dias guardados (contando o dia de hoje). Chave fora do padrão nunca sai. */
export function chavesParaApagar(chaves: readonly string[], hoje: string): string[] {
  const limite = new Date(`${hoje}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - (DIAS_GUARDADOS - 1));
  const corte = limite.toISOString().slice(0, 10);
  return chaves.filter((k) => {
    const m = CHAVE_DA_COPIA.exec(k);
    return !!m && m[1] < corte;
  });
}

export interface CopiaDaAgenda {
  versao: 1;
  geradaEm: string;
  janela: { de: string; ate: string };
  total: number;
  eventos: EventoDaAgenda[];
}

export function jsonDaCopia(eventos: EventoDaAgenda[], geradaEm: Date, de: Date, ate: Date): string {
  const copia: CopiaDaAgenda = {
    versao: 1,
    geradaEm: geradaEm.toISOString(),
    janela: { de: de.toISOString(), ate: ate.toISOString() },
    total: eventos.length,
    eventos,
  };
  return JSON.stringify(copia, null, 2);
}

/** Texto de propriedade do iCalendar (RFC 5545 §3.3.11). */
function escaparIcs(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Dobra a linha em 75 octetos (RFC 5545 §3.1), sem partir caractere. */
function dobrar(linha: string): string {
  const partes: string[] = [];
  let atual = '';
  let bytes = 0;
  for (const ch of linha) {
    const b = Buffer.byteLength(ch);
    const teto = partes.length === 0 ? 75 : 74;
    if (bytes + b > teto) {
      partes.push(atual);
      atual = '';
      bytes = 0;
    }
    atual += ch;
    bytes += b;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

const utc = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const soData = (iso: string): string => diaEmSaoPaulo(new Date(iso)).replace(/-/g, '');

const STATUS_ICS: Record<string, string> = { confirmado: 'CONFIRMED', provisorio: 'TENTATIVE', cancelado: 'CANCELLED' };

export function icsDaCopia(eventos: EventoDaAgenda[], geradaEm: Date): string {
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ROOT OS//Agenda da Root//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:America/Sao_Paulo'];
  const carimbo = utc(geradaEm.toISOString());
  for (const e of eventos) {
    const titulo = e.titulo ?? (e.origem === 'livre_ocupado' ? `Fechado ${e.leitura.responsaveis[0] ?? ''}`.trim() : '(sem título)');
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${escaparIcs(`${e.id}@${e.origem === 'livre_ocupado' ? 'livre-ocupado' : 'agenda'}.root-os`)}`);
    linhas.push(`DTSTAMP:${carimbo}`);
    if (e.diaInteiro) {
      linhas.push(`DTSTART;VALUE=DATE:${soData(e.inicio)}`);
      // O fim de dia inteiro é exclusivo; duração zero vira um dia.
      const fim = e.fim > e.inicio ? soData(e.fim) : soData(new Date(Date.parse(e.inicio) + 86_400_000).toISOString());
      linhas.push(`DTEND;VALUE=DATE:${fim}`);
    } else {
      linhas.push(`DTSTART:${utc(e.inicio)}`);
      linhas.push(`DTEND:${utc(e.fim)}`);
    }
    linhas.push(`SUMMARY:${escaparIcs(titulo)}`);
    if (e.local) linhas.push(`LOCATION:${escaparIcs(e.local)}`);
    if (e.meet) linhas.push(`URL:${escaparIcs(e.meet)}`);
    linhas.push(`STATUS:${STATUS_ICS[e.status] ?? 'CONFIRMED'}`);
    if (e.origem === 'livre_ocupado') linhas.push('TRANSP:OPAQUE', 'CLASS:PRIVATE');
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}
