/*
 * A SALA DO CLIENTE E O SIMULADOR — o que a tela calcula sozinha (Lane B, 13/10/2026).
 *
 * Só formatação e conversão: nenhum número nasce aqui. O valor vem em
 * centavos da API, o horário vem em ISO com fuso, e a tela mostra em São Paulo.
 */

const FUSO = 'America/Sao_Paulo';

export function reais(centavos: number | null | undefined): string {
  if (centavos == null) return '[a decidir]';
  const inteiro = Math.trunc(Math.abs(centavos) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = (Math.abs(centavos) % 100).toString().padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}R$ ${inteiro}${resto === '00' ? '' : `,${resto}`}`;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** As partes do instante em São Paulo, sem depender do fuso do navegador. */
function partesSP(iso: string): { dia: number; mes: number; ano: number; hora: number; minuto: number; semana: number } | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]));
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday));
  return { dia: Number(p.day), mes: Number(p.month), ano: Number(p.year), hora: Number(p.hour) % 24, minuto: Number(p.minute), semana };
}

const dd = (n: number) => n.toString().padStart(2, '0');

/** "Qui 16/10 · 10h" (a tela 01). */
export function rotuloDoHorario(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  if (!p) return iso;
  return `${DIAS[p.semana]} ${dd(p.dia)}/${dd(p.mes)} · ${p.hora}h${p.minuto ? dd(p.minuto) : ''}`;
}

/** "24/10" */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  return p ? `${dd(p.dia)}/${dd(p.mes)}` : '';
}

/** "13/10 09:12" */
export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  return p ? `${dd(p.dia)}/${dd(p.mes)} ${dd(p.hora)}:${dd(p.minuto)}` : '';
}

/** O valor de um `<input type="datetime-local">` lido como hora de São Paulo, em ISO com fuso. */
export function localSPParaIso(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`;
}

/** Só dígitos (CNPJ, CPF, telefone). */
export function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export const ROTULO_DA_FORMA: Record<string, string> = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão' };

/** O que o estado de uma mensagem quer dizer para quem olha o simulador. */
export function explicarEstado(estado: string, vetoAte?: string | null): string {
  switch (estado) {
    case 'rascunho':
      return 'rascunho: ainda não foi pedida';
    case 'na_fila':
      return 'na fila de aprovação: outra pessoa confirma em /atendimento';
    case 'em_veto':
      return `janela de veto até ${dataHora(vetoAte)}: depois vai à fila`;
    case 'enviada':
      return 'entregue';
    case 'vetada':
      return 'vetada: não saiu';
    case 'falhou':
      return 'não saiu';
    case 'recebida':
      return 'recebida';
    default:
      return estado;
  }
}
