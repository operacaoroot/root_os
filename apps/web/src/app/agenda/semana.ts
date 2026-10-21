import type { EventoDaAgenda } from './tipos';

/*
 * A SEMANA E O DIA DA AGENDA (Rodada de produção 1, 21/10/2026, P2).
 *
 * Conta pura, sem React. Tudo o que é hora e dia é lido no relógio de
 * America/Sao_Paulo, nunca em UTC cru nem no fuso do navegador: a agenda é da
 * Root, em Juiz de Fora, e um sócio viajando não pode ver a reunião das 9h às
 * 13h. Dia é sempre a chave `AAAA-MM-DD`; a aritmética de dias é feita em UTC
 * sobre essa chave (dia civil não tem fuso), e só a conversão de um INSTANTE
 * para dia e minuto passa pelo fuso.
 */

export const FUSO_DA_AGENDA = 'America/Sao_Paulo';

/** A janela da grade de horas: 07h às 22h. */
export const PRIMEIRA_HORA = 7;
export const ULTIMA_HORA = 22;

export type VisaoDaAgenda = 'mes' | 'semana' | 'dia';
export const VISOES: readonly VisaoDaAgenda[] = ['mes', 'semana', 'dia'];

const CHAVE = /^\d{4}-\d{2}-\d{2}$/;

export function ehChaveDeDia(v: unknown): v is string {
  if (typeof v !== 'string' || !CHAVE.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_DA_AGENDA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** O dia (`AAAA-MM-DD`) e o minuto do dia de um instante, no fuso da agenda. */
export function noFuso(instante: Date): { dia: string; minutos: number } {
  const p = Object.fromEntries(formatador.formatToParts(instante).map((x) => [x.type, x.value]));
  const hora = Number(p.hour) % 24;
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: hora * 60 + Number(p.minute) };
}

export const hojeNoFuso = (agora: Date = new Date()): string => noFuso(agora).dia;

/** A chave somada de `n` dias. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo. */
export function diaDaSemana(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Os sete dias da semana que contém `dia`, de domingo a sábado (como a grade do mês). */
export function diasDaSemana(dia: string): string[] {
  const domingo = somarDias(dia, -diaDaSemana(dia));
  return Array.from({ length: 7 }, (_, i) => somarDias(domingo, i));
}

/** O instante da meia-noite deste dia no fuso da agenda. */
export function inicioDoDiaNoFuso(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  // Primeiro palpite: meia-noite UTC; depois corrige pela diferença que o fuso mostra.
  let t = Date.UTC(a, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const v = noFuso(new Date(t));
    const [va, vm, vd] = v.dia.split('-').map(Number);
    const visto = Date.UTC(va, vm - 1, vd) + v.minutos * 60_000;
    t += Date.UTC(a, m - 1, d) - visto;
  }
  return new Date(t);
}

/** O intervalo [de, ate) dos dias, em instantes, para a API. */
export function intervaloDosDias(dias: string[]): { de: Date; ate: Date } {
  return { de: inicioDoDiaNoFuso(dias[0]), ate: inicioDoDiaNoFuso(somarDias(dias[dias.length - 1], 1)) };
}

/** "seg", "20/10" e o nome longo, sem depender do fuso do navegador. */
export function rotulosDoDia(dia: string): { semana: string; data: string; extenso: string } {
  const [a, m, d] = dia.split('-').map(Number);
  const meioDia = new Date(Date.UTC(a, m - 1, d, 12));
  const semana = meioDia.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  return {
    semana,
    data: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
    extenso: meioDia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' }),
  };
}

/** "09:30", no fuso da agenda. */
export function horaNoFuso(iso: string | null): string {
  if (!iso) return '';
  const { minutos } = noFuso(new Date(iso));
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

export interface EventoNaGrade {
  evento: EventoDaAgenda;
  /** Minutos desde 00h do dia, já presos à janela 07h–22h. */
  inicio: number;
  fim: number;
  /** A faixa (0..faixas-1) para eventos que se sobrepõem. */
  faixa: number;
  faixas: number;
}

export interface DiaDaSemana {
  dia: string;
  diaInteiro: EventoDaAgenda[];
  comHora: EventoNaGrade[];
}

const JANELA_INICIO = PRIMEIRA_HORA * 60;
const JANELA_FIM = ULTIMA_HORA * 60;
const DURACAO_MINIMA = 20;

/** Separa os eventos por dia: os de dia inteiro no topo, os com hora na grade. */
export function eventosPorDia(eventos: readonly EventoDaAgenda[], dias: readonly string[]): DiaDaSemana[] {
  const indice = new Map(dias.map((d) => [d, { dia: d, diaInteiro: [] as EventoDaAgenda[], comHora: [] as Omit<EventoNaGrade, 'faixa' | 'faixas'>[] }]));
  for (const e of eventos) {
    if (!e.start) continue;
    if (e.diaInteiro) {
      // O fim do evento de dia inteiro é exclusivo (o Google manda o dia seguinte).
      const primeiro = e.start.slice(0, 10);
      const ultimoExclusivo = e.end && ehChaveDeDia(e.end.slice(0, 10)) && e.end.slice(0, 10) > primeiro ? e.end.slice(0, 10) : somarDias(primeiro, 1);
      for (let d = primeiro; d < ultimoExclusivo; d = somarDias(d, 1)) indice.get(d)?.diaInteiro.push(e);
      continue;
    }
    const ini = noFuso(new Date(e.start));
    const alvo = indice.get(ini.dia);
    if (!alvo) continue;
    let fimMin = ini.minutos + 30;
    if (e.end) {
      const f = noFuso(new Date(e.end));
      fimMin = f.dia === ini.dia ? f.minutos : 24 * 60;
    }
    const inicio = Math.min(Math.max(ini.minutos, JANELA_INICIO), JANELA_FIM - DURACAO_MINIMA);
    const fim = Math.max(Math.min(fimMin, JANELA_FIM), inicio + DURACAO_MINIMA);
    alvo.comHora.push({ evento: e, inicio, fim });
  }
  return dias.map((d) => {
    const x = indice.get(d)!;
    return { dia: d, diaInteiro: x.diaInteiro, comHora: comFaixas(x.comHora) };
  });
}

/** Faixas lado a lado para o que se sobrepõe, por grupo de sobreposição. */
function comFaixas(itens: Omit<EventoNaGrade, 'faixa' | 'faixas'>[]): EventoNaGrade[] {
  const ordenados = [...itens].sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  const saida: EventoNaGrade[] = [];
  let grupo: EventoNaGrade[] = [];
  let fimDoGrupo = -1;
  const fecharGrupo = () => {
    const n = Math.max(1, ...grupo.map((g) => g.faixa + 1));
    for (const g of grupo) g.faixas = n;
    saida.push(...grupo);
    grupo = [];
  };
  for (const it of ordenados) {
    if (grupo.length && it.inicio >= fimDoGrupo) fecharGrupo();
    const ocupadas = new Set(grupo.filter((g) => g.fim > it.inicio).map((g) => g.faixa));
    let faixa = 0;
    while (ocupadas.has(faixa)) faixa++;
    grupo.push({ ...it, faixa, faixas: 1 });
    fimDoGrupo = Math.max(fimDoGrupo, it.fim);
  }
  if (grupo.length) fecharGrupo();
  return saida;
}

/** O próximo dia da navegação: ±1 mês (no primeiro dia), ±7 dias ou ±1 dia. */
export function diaVizinho(visao: VisaoDaAgenda, dia: string, sentido: 1 | -1): string {
  if (visao === 'semana') return somarDias(dia, 7 * sentido);
  if (visao === 'dia') return somarDias(dia, sentido);
  const [a, m] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + sentido, 1));
  return dt.toISOString().slice(0, 10);
}

/** O estado da agenda lido do endereço (`?visao=semana&dia=AAAA-MM-DD`). */
export function lerEstadoDaAgenda(busca: string, hoje: string): { visao: VisaoDaAgenda; dia: string } {
  const q = new URLSearchParams(busca);
  const v = q.get('visao');
  const d = q.get('dia');
  return {
    visao: (VISOES as readonly string[]).includes(v ?? '') ? (v as VisaoDaAgenda) : 'mes',
    dia: ehChaveDeDia(d) ? d : hoje,
  };
}

/** O endereço com o estado novo, preservando o resto da query. */
export function urlDaAgenda(atual: string, visao: VisaoDaAgenda, dia: string): string {
  const u = new URL(atual, 'http://x');
  u.searchParams.set('visao', visao);
  u.searchParams.set('dia', dia);
  return `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
}
