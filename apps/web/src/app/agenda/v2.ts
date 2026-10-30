import {
  conferirEvento,
  lerCompromisso,
  SOCIOS_DA_AGENDA,
  type EstadoDaSincronia,
  type EventoDaAgenda as EventoV2,
  type FeriadoDaAgenda,
  type RespostaDoEspelho,
  type SocioDaAgenda,
  type StatusDoEvento,
} from '@mktos/shared';

import { diaDaSemana, ehChaveDeDia, inicioDoDiaNoFuso, noFuso, rotulosDoDia, somarDias } from './semana';
import type { EventoDaAgenda as EventoDoGoogle } from './tipos';

/*
 * A AGENDA V2 NA TELA — a conta pura (rodada da Agenda v2, 29/10/2026, lane G3).
 *
 * Sem React, sem rede: o que vira dado, cor e posição na grade. A tela lê do
 * ESPELHO (`GET /agenda/espelho`, o tipo `EventoDaAgenda` do shared, aqui
 * chamado `EventoV2`) e, quando ele falha, da leitura direta de hoje
 * (`GET /google/calendar/periodo`), adaptada por `doGoogleParaV2` com a mesma
 * gramática (`lerCompromisso`). Todo dia e hora são de America/Sao_Paulo
 * (`semana.ts`).
 */

export type { EventoV2 };

/* ---------------------------------------------------------------------------
 * A fonte: o espelho, ou a leitura direta adaptada
 * ------------------------------------------------------------------------- */

/** A resposta tem a forma do espelho? (o esqueleto devolve 501; um proxy pode devolver outra coisa) */
export function ehRespostaDoEspelho(x: unknown): x is RespostaDoEspelho {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<RespostaDoEspelho>;
  return Array.isArray(r.eventos) && !!r.sincronia && typeof r.sincronia === 'object' && (r.fonte === 'espelho' || r.fonte === 'google');
}

const STATUS: Record<string, StatusDoEvento> = { confirmed: 'confirmado', tentative: 'provisorio', cancelled: 'cancelado' };

/** Um evento da leitura direta (`/google/calendar/periodo`) no formato do espelho. */
export function doGoogleParaV2(e: EventoDoGoogle, feriados: readonly string[] = []): EventoV2 {
  const inicio = e.start ?? '';
  return {
    id: e.id,
    agenda: 'primary',
    origem: 'google',
    titulo: e.title ?? null,
    inicio,
    fim: e.end ?? inicio,
    diaInteiro: !!e.diaInteiro,
    local: e.location ?? null,
    meet: e.meet ?? null,
    convidados: (e.attendees ?? []).map((email) => ({ email, resposta: 'pendente' as const })),
    organizador: e.organizador ?? null,
    // A leitura direta não diz; sem saber, a tela não oferece arrastar.
    organizadorEhAgenda: false,
    status: STATUS[e.status ?? ''] ?? 'confirmado',
    atualizadoNoGoogle: null,
    serieId: null,
    criadoPeloOs: false,
    link: e.link ?? null,
    leitura: lerCompromisso(e.title, feriados),
  };
}

/* ---------------------------------------------------------------------------
 * Dias e horas
 * ------------------------------------------------------------------------- */

export type QuantosDias = 1 | 3 | 5;
export const OPCOES_DE_DIAS: readonly QuantosDias[] = [1, 3, 5];

export const ehDiaUtil = (dia: string): boolean => {
  const d = diaDaSemana(dia);
  return d >= 1 && d <= 5;
};

/** O próprio dia, se útil; senão o próximo dia útil. */
export function proximoDiaUtil(dia: string): string {
  let d = dia;
  while (!ehDiaUtil(d)) d = somarDias(d, 1);
  return d;
}

/**
 * Os dias da grade. 1 = o dia; 3 = três dias úteis a partir dele; 5 = a semana
 * útil (segunda a sexta) que contém o dia, ou a seguinte se ele cai no fim de
 * semana.
 */
export function diasDaJanela(ancora: string, n: QuantosDias): string[] {
  if (n === 1) return [ancora];
  if (n === 5) {
    const util = proximoDiaUtil(ancora);
    const segunda = somarDias(util, 1 - diaDaSemana(util));
    return Array.from({ length: 5 }, (_, i) => somarDias(segunda, i));
  }
  const dias: string[] = [];
  let d = proximoDiaUtil(ancora);
  while (dias.length < n) {
    dias.push(d);
    d = proximoDiaUtil(somarDias(d, 1));
  }
  return dias;
}

/** A âncora da janela anterior ou seguinte. */
export function ancoraVizinha(ancora: string, n: QuantosDias, sentido: 1 | -1): string {
  if (n === 1) return somarDias(ancora, sentido);
  if (n === 5) return somarDias(proximoDiaUtil(ancora), 7 * sentido);
  let d = proximoDiaUtil(ancora);
  for (let i = 0; i < n; i++) {
    d = somarDias(d, sentido);
    while (!ehDiaUtil(d)) d = somarDias(d, sentido);
  }
  return d;
}

/** "02/11 a 06/11", ou "seg 02/11" num dia só. */
export function rotuloDaJanela(dias: readonly string[]): string {
  if (!dias.length) return '';
  const a = rotulosDoDia(dias[0]);
  if (dias.length === 1) return `${a.semana} ${a.data}`;
  return `${a.data} a ${rotulosDoDia(dias[dias.length - 1]).data}`;
}

/** O instante de `dia` + `minutos` no fuso da agenda. */
export function instanteNoFuso(dia: string, minutos: number): Date {
  return new Date(inicioDoDiaNoFuso(dia).getTime() + minutos * 60_000);
}

export const horaDeMinutos = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export function minutosDeHora(h: string): number | null {
  const r = /^(\d{1,2}):(\d{2})$/.exec(h ?? '');
  if (!r) return null;
  const v = Number(r[1]) * 60 + Number(r[2]);
  return Number(r[1]) < 24 && Number(r[2]) < 60 ? v : null;
}

/** "1 h", "45 min", "1 h 30". */
export function rotuloDaDuracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** O dia (`AAAA-MM-DD`) de um evento: a data pura no dia inteiro, o dia de São Paulo no resto. */
export function diaDoEventoV2(e: Pick<EventoV2, 'inicio' | 'diaInteiro'>): string | null {
  if (!e.inicio) return null;
  if (e.diaInteiro) return ehChaveDeDia(e.inicio.slice(0, 10)) ? e.inicio.slice(0, 10) : null;
  const t = new Date(e.inicio);
  return Number.isNaN(t.getTime()) ? null : noFuso(t).dia;
}

/** Os dias que um evento de dia inteiro cobre (o fim é exclusivo, como o Google manda). */
export function diasDoDiaInteiro(e: Pick<EventoV2, 'inicio' | 'fim'>): string[] {
  const primeiro = e.inicio.slice(0, 10);
  if (!ehChaveDeDia(primeiro)) return [];
  const fimBruto = (e.fim ?? '').slice(0, 10);
  const ultimoExclusivo = ehChaveDeDia(fimBruto) && fimBruto > primeiro ? fimBruto : somarDias(primeiro, 1);
  const dias: string[] = [];
  for (let d = primeiro; d < ultimoExclusivo && dias.length < 60; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** Minuto de início e fim no dia de São Paulo (o fim que passa da meia-noite vira 24:00). */
export function minutosDoEvento(e: Pick<EventoV2, 'inicio' | 'fim'>): { dia: string; inicio: number; fim: number } | null {
  const ini = new Date(e.inicio);
  if (Number.isNaN(ini.getTime())) return null;
  const a = noFuso(ini);
  const fimT = new Date(e.fim);
  let fim = a.minutos + 30;
  if (!Number.isNaN(fimT.getTime())) {
    const b = noFuso(fimT);
    fim = b.dia === a.dia ? b.minutos : 24 * 60;
  }
  return { dia: a.dia, inicio: a.minutos, fim: Math.max(fim, a.minutos) };
}

/* ---------------------------------------------------------------------------
 * Quem, e o que cada compromisso é
 * ------------------------------------------------------------------------- */

export type Quem = 'Todos' | SocioDaAgenda;

/** O evento é deste sócio? Pelos responsáveis lidos do título, ou pelo e-mail dele entre os convidados. */
export function ehDoSocio(e: EventoV2, socio: Quem, emails: Partial<Record<SocioDaAgenda, string | null>> = {}): boolean {
  if (socio === 'Todos') return true;
  if (e.leitura.responsaveis.includes(socio)) return true;
  if (e.leitura.tipo === 'feriado') return true;
  const email = emails[socio]?.toLowerCase();
  return !!email && e.convidados.some((c) => c.email.toLowerCase() === email);
}

export type TomDoCompromisso = 'cliente' | 'interna' | 'fechado' | 'pessoal' | 'fora' | 'feriado' | 'foraDoPadrao' | 'outro';

export interface Aparencia {
  tom: TomDoCompromisso;
  /** O título que a tela mostra (o Fechado da agenda pessoal não tem título no Google). */
  titulo: string;
  /** A palavra que acompanha a cor (nunca cor sozinha). */
  etiqueta: string | null;
  /** Reunião online sem Meet (a etiqueta âmbar "sem Meet"). */
  semMeet: boolean;
}

/** A conferência do AG-01 (`conferirEvento`) sobre o evento do espelho: a tela e o vigia não discordam. */
export function conferenciaV2(e: EventoV2) {
  return conferirEvento({
    titulo: e.titulo,
    convidados: e.convidados.map((c) => c.email),
    organizador: e.organizador,
    meet: e.meet,
    local: e.local,
    status: e.status === 'cancelado' ? 'cancelled' : 'confirmed',
  });
}

export function aparenciaDo(e: EventoV2): Aparencia {
  const l = e.leitura;
  const nome = l.responsaveis[0] ?? '';
  if (l.tipo === 'fechado') {
    return { tom: 'fechado', titulo: e.titulo ?? `Fechado ${nome}`.trim(), etiqueta: e.origem === 'livre_ocupado' ? 'agenda pessoal · só ocupado' : 'bloqueio', semMeet: false };
  }
  if (l.tipo === 'pessoal') return { tom: 'pessoal', titulo: e.titulo ?? `Pessoal - ${nome}`, etiqueta: 'pessoal', semMeet: false };
  if (l.tipo === 'fora') return { tom: 'fora', titulo: e.titulo ?? `${nome} Fora`, etiqueta: 'fora', semMeet: false };
  if (l.tipo === 'feriado') return { tom: 'feriado', titulo: l.feriado ?? e.titulo ?? 'Feriado', etiqueta: 'feriado', semMeet: false };
  const titulo = e.titulo ?? '(sem título)';
  const c = conferenciaV2(e);
  const semMeet = c.problemas.includes('online_sem_meet');
  const soFaltaMeet = semMeet && c.problemas.length === 1;
  if (c.reuniao && !c.noPadrao && !soFaltaMeet) return { tom: 'foraDoPadrao', titulo, etiqueta: 'fora do padrão', semMeet };
  if (l.tipo === 'cliente') return { tom: 'cliente', titulo, etiqueta: semMeet ? 'sem Meet' : null, semMeet };
  if (l.tipo === 'interna') return { tom: 'interna', titulo, etiqueta: semMeet ? 'sem Meet' : null, semMeet };
  return { tom: 'outro', titulo, etiqueta: null, semMeet };
}

/** As classes de cada tom (cor só onde informa; a palavra vem na etiqueta). Funcionam nos três temas. */
export const CLASSE_DO_TOM: Record<TomDoCompromisso | 'choque' | 'novo', string> = {
  cliente: 'bg-brand/[0.09] border border-brand/40',
  interna: 'bg-surface-2 border border-border-strong',
  outro: 'bg-surface-2 border border-border',
  fechado: 'bg-surface border border-dashed border-border-strong',
  pessoal: 'bg-surface border border-dashed border-border-strong',
  fora: 'bg-warn/[0.08] border border-warn/60',
  feriado: 'bg-surface border border-dashed border-border-strong',
  foraDoPadrao: 'bg-warn/[0.08] border border-warn',
  choque: 'bg-mag/[0.08] border border-mag',
  novo: 'bg-brand/[0.05] border border-dashed border-brand',
};

/** A cor da etiqueta: âmbar para atenção, magenta para choque, neutra para o resto. */
export function corDaEtiqueta(tom: TomDoCompromisso | 'choque' | 'novo', semMeet = false): string {
  if (tom === 'choque') return 'text-mag';
  if (tom === 'novo') return 'text-brand';
  if (tom === 'foraDoPadrao' || tom === 'fora' || semMeet) return 'text-warn';
  return 'text-muted';
}

const contaNaGrade = (e: EventoV2) => e.status !== 'cancelado' && !e.diaInteiro && e.leitura.tipo !== 'feriado';

/**
 * Os eventos em CHOQUE: dois compromissos com hora que se sobrepõem e têm um
 * sócio em comum. Fechado contra Fechado não é choque (decisão 3); cancelado e
 * dia inteiro ficam fora (a faixa do topo cuida do Fora e do feriado).
 */
export function choquesDe(eventos: readonly EventoV2[]): Set<string> {
  const comHora = eventos.filter(contaNaGrade).map((e) => ({ e, a: new Date(e.inicio).getTime(), b: new Date(e.fim).getTime() }));
  comHora.sort((x, y) => x.a - y.a);
  const saida = new Set<string>();
  for (let i = 0; i < comHora.length; i++) {
    for (let j = i + 1; j < comHora.length && comHora[j].a < comHora[i].b; j++) {
      const x = comHora[i].e;
      const y = comHora[j].e;
      if (x.leitura.tipo === 'fechado' && y.leitura.tipo === 'fechado') continue;
      if (x.id === y.id) continue;
      if (!x.leitura.responsaveis.some((s) => y.leitura.responsaveis.includes(s))) continue;
      saida.add(x.id);
      saida.add(y.id);
    }
  }
  return saida;
}

/* ---------------------------------------------------------------------------
 * A grade: horas, terços e "+N"
 * ------------------------------------------------------------------------- */

export interface JanelaDeHoras {
  /** Minuto do dia em que a grade começa (hora cheia). */
  inicio: number;
  fim: number;
}

/** 08h às 21h, alargada para caber o que estiver fora disso. */
export function janelaDeHoras(eventos: readonly EventoV2[]): JanelaDeHoras {
  let inicio = 8 * 60;
  let fim = 21 * 60;
  for (const e of eventos) {
    if (!contaNaGrade(e)) continue;
    const m = minutosDoEvento(e);
    if (!m) continue;
    inicio = Math.min(inicio, Math.floor(m.inicio / 60) * 60);
    fim = Math.max(fim, Math.min(24 * 60, Math.ceil(m.fim / 60) * 60));
  }
  return { inicio, fim };
}

export interface BlocoNaGrade {
  evento: EventoV2;
  inicio: number;
  fim: number;
  /** A posição lado a lado (0, 1, 2) e quantas colunas o grupo tem (1, 2 ou 3). */
  coluna: number;
  colunas: number;
}

export interface MaisNaGrade {
  inicio: number;
  fim: number;
  /** Quantos ficaram escondidos atrás do "+N". */
  ocultos: number;
  /** Todos os do horário, para a lista que o "+N" abre. */
  eventos: EventoV2[];
}

export interface DiaNaGrade {
  dia: string;
  blocos: BlocoNaGrade[];
  mais: MaisNaGrade[];
  diaInteiro: EventoV2[];
}

const DURACAO_VISIVEL = 20;

/**
 * Os eventos de um dia na grade. Até três simultâneos ficam lado a lado (em
 * metades ou terços); com quatro ou mais, os dois primeiros ficam e o terceiro
 * lugar vira "+N", que abre a lista daquele horário.
 */
export function layoutDoDia(eventos: readonly EventoV2[], dia: string, janela: JanelaDeHoras): DiaNaGrade {
  const diaInteiro: EventoV2[] = [];
  const itens: Array<{ evento: EventoV2; inicio: number; fim: number }> = [];
  for (const e of eventos) {
    if (e.status === 'cancelado') continue;
    if (e.diaInteiro) {
      if (diasDoDiaInteiro(e).includes(dia)) diaInteiro.push(e);
      continue;
    }
    if (e.leitura.tipo === 'feriado') continue;
    const m = minutosDoEvento(e);
    if (!m || m.dia !== dia) continue;
    const inicio = Math.min(Math.max(m.inicio, janela.inicio), janela.fim - DURACAO_VISIVEL);
    const fim = Math.max(Math.min(m.fim, janela.fim), inicio + DURACAO_VISIVEL);
    itens.push({ evento: e, inicio, fim });
  }
  itens.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim || a.evento.id.localeCompare(b.evento.id));

  const blocos: BlocoNaGrade[] = [];
  const mais: MaisNaGrade[] = [];
  let grupo: Array<{ evento: EventoV2; inicio: number; fim: number; faixa: number }> = [];
  let fimDoGrupo = -1;
  const fechar = () => {
    if (!grupo.length) return;
    const faixas = Math.max(...grupo.map((g) => g.faixa + 1));
    if (faixas <= 3) {
      for (const g of grupo) blocos.push({ evento: g.evento, inicio: g.inicio, fim: g.fim, coluna: g.faixa, colunas: faixas });
    } else {
      const ocultos = grupo.filter((g) => g.faixa >= 2);
      for (const g of grupo) if (g.faixa < 2) blocos.push({ evento: g.evento, inicio: g.inicio, fim: g.fim, coluna: g.faixa, colunas: 3 });
      mais.push({
        inicio: Math.min(...ocultos.map((g) => g.inicio)),
        fim: Math.max(...ocultos.map((g) => g.fim)),
        ocultos: ocultos.length,
        eventos: grupo.map((g) => g.evento),
      });
    }
    grupo = [];
  };
  for (const it of itens) {
    if (grupo.length && it.inicio >= fimDoGrupo) fechar();
    const ocupadas = new Set(grupo.filter((g) => g.fim > it.inicio).map((g) => g.faixa));
    let faixa = 0;
    while (ocupadas.has(faixa)) faixa++;
    grupo.push({ ...it, faixa });
    fimDoGrupo = grupo.length === 1 ? it.fim : Math.max(fimDoGrupo, it.fim);
  }
  fechar();
  return { dia, blocos, mais, diaInteiro };
}

/** A altura da hora (px): manual entre 28 e 120; "auto" cabe a janela na altura disponível. */
export const ALTURA_MINIMA = 28;
export const ALTURA_MAXIMA = 120;
export const ALTURA_PADRAO = 48;
export type AlturaDaHora = number | 'auto';

export function alturaEfetiva(altura: AlturaDaHora, disponivelPx: number, janela: JanelaDeHoras): number {
  if (altura !== 'auto') return Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, Math.round(altura)));
  const horas = (janela.fim - janela.inicio) / 60;
  if (!disponivelPx || disponivelPx < 100 || !horas) return ALTURA_PADRAO;
  return Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, Math.floor(disponivelPx / horas)));
}

/** Lê a altura guardada no navegador (`'auto'` ou um número). */
export function lerAlturaGuardada(v: string | null): AlturaDaHora {
  if (!v || v === 'auto') return 'auto';
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, n)) : 'auto';
}

/** Arredonda um minuto ao passo (15 min por padrão), dentro do dia. */
export function arredondar(min: number, passo = 15): number {
  return Math.min(24 * 60, Math.max(0, Math.round(min / passo) * passo));
}

/* ---------------------------------------------------------------------------
 * As faixas do topo: Fora e feriado
 * ------------------------------------------------------------------------- */

export interface FaixaDoTopo {
  tipo: 'fora' | 'feriado';
  dia: string;
  texto: string;
  /** Feriado nacional ou municipal: a agenda do dia fecha (a régua pede "marcar assim mesmo"). */
  fecha: boolean;
  pessoa: SocioDaAgenda | null;
}

/** As faixas dos dias da grade: o Fora (de dia inteiro, de quem for) e o feriado, da tabela e do título. */
export function faixasDoTopo(eventos: readonly EventoV2[], feriados: readonly FeriadoDaAgenda[], dias: readonly string[]): FaixaDoTopo[] {
  const saida: FaixaDoTopo[] = [];
  const visto = new Set<string>();
  const empurrar = (f: FaixaDoTopo) => {
    const k = `${f.tipo}|${f.dia}|${f.texto}`;
    if (!visto.has(k)) { visto.add(k); saida.push(f); }
  };
  const naJanela = new Set(dias);
  for (const f of feriados) {
    if (!naJanela.has(f.data)) continue;
    if (f.tipo === 'facultativo' && !f.ligado) continue;
    const fecha = f.tipo !== 'facultativo';
    empurrar({ tipo: 'feriado', dia: f.data, texto: f.nome, fecha, pessoa: null });
  }
  for (const e of eventos) {
    if (e.status === 'cancelado') continue;
    const dosDias = e.diaInteiro ? diasDoDiaInteiro(e) : [diaDoEventoV2(e) ?? ''];
    for (const d of dosDias) {
      if (!naJanela.has(d)) continue;
      if (e.leitura.tipo === 'feriado' && e.diaInteiro) {
        if (!saida.some((x) => x.tipo === 'feriado' && x.dia === d)) empurrar({ tipo: 'feriado', dia: d, texto: e.leitura.feriado ?? e.titulo ?? 'Feriado', fecha: true, pessoa: null });
      } else if (e.leitura.tipo === 'fora' && e.diaInteiro) {
        empurrar({ tipo: 'fora', dia: d, texto: e.titulo ?? `${e.leitura.responsaveis[0] ?? ''} Fora`, fecha: false, pessoa: e.leitura.responsaveis[0] ?? null });
      }
    }
  }
  return saida.sort((a, b) => a.dia.localeCompare(b.dia) || a.tipo.localeCompare(b.tipo));
}

/** Os sócios que estão Fora num dia (para a etiqueta "Pedro Fora" nos compromissos dele). */
export function foraNoDia(faixas: readonly FaixaDoTopo[], dia: string): SocioDaAgenda[] {
  return faixas.filter((f) => f.tipo === 'fora' && f.dia === dia && f.pessoa).map((f) => f.pessoa as SocioDaAgenda);
}

/* ---------------------------------------------------------------------------
 * O selo da sincronia
 * ------------------------------------------------------------------------- */

export interface SeloDaSincronia {
  texto: string;
  tom: 'ok' | 'atencao';
}

export function seloDaSincronia(
  sincronia: EstadoDaSincronia | null,
  fonte: 'espelho' | 'google' | 'direto' | null,
  agora: Date,
): SeloDaSincronia | null {
  if (fonte === 'direto') return { texto: 'sem espelho: lendo direto do Google', tom: 'atencao' };
  if (!sincronia) return null;
  if (sincronia.atrasada || fonte === 'google') return { texto: 'espelho atrasado: lendo direto do Google', tom: 'atencao' };
  if (!sincronia.ultimaPassagem) return { texto: 'o espelho ainda não sincronizou', tom: 'atencao' };
  const s = Math.max(0, Math.round((agora.getTime() - new Date(sincronia.ultimaPassagem).getTime()) / 1000));
  const ha = s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
  return { texto: `sincronizado há ${ha}`, tom: sincronia.erro ? 'atencao' : 'ok' };
}

/** Os sócios na ordem das colunas (o filtro "Quem"). */
export const QUEM: readonly Quem[] = ['Todos', ...SOCIOS_DA_AGENDA];
