/*
 * A RÉGUA DA AGENDA (rodada da Agenda v2, 29/10/2026, lane G2) — o motor puro.
 *
 * Usado pela tela (semáforo do painel), pela API (antes de toda escrita, nos
 * Conflitos) e pelo link público (`horariosLivres`). Recebe os eventos do
 * período, as regras e o compromisso proposto; devolve verde/amarelo/vermelho
 * com as frases.
 *
 * PURO: sem relógio (o `agora` vem de fora), sem rede, sem banco. Toda conta de
 * dia e hora é feita no fuso da agenda (`America/Sao_Paulo`), nunca no fuso do
 * processo nem no do navegador.
 *
 * As regras, na ordem em que aparecem no semáforo:
 *   · já passou                         → bloqueio (código `janela`)
 *   · feriado nacional ou municipal     → bloqueio; facultativo LIGADO só avisa
 *   · Fora no dia                       → bloqueio (fecha a agenda do dia da pessoa)
 *   · bloqueio fixo                     → bloqueio
 *   · Fechado (agenda pessoal ou título)→ bloqueio; Fechado contra Fechado não é choque
 *   · a mesma pessoa em dois lugares    → bloqueio (`choque`)
 *   · rito protegido                    → `pergunta` = atenção, `bloqueia` = bloqueio
 *   · teto de reuniões no dia           → acima do teto = bloqueio; o teto e o
 *                                         penúltimo = atenção ("4ª reunião do Rodrigo
 *                                         no dia (limite 5)", desenho `Main`)
 *   · janela de trabalho, fim de semana → atenção
 *   · trajeto antes de presencial       → atenção
 *   · intervalo mínimo                  → atenção
 * Qualquer bloqueio = vermelho; atenção = amarelo; senão verde. Quem não tem
 * bloqueio ganha o item `livre` ("Rodrigo livre das 15:00 às 16:00"), e a
 * online ganha "Meet nasce junto".
 *
 * O motor NÃO interpreta as regras em frase (`AgendaRegraTexto`): elas são só
 * guardadas e listadas.
 */
import {
  AGENDA_FUSO,
  SOCIOS_DA_AGENDA,
  sociosDoResponsavel,
  type CompromissoProposto,
  type DiaLivre,
  type EventoDaAgenda,
  type FeriadoDaAgenda,
  type HorarioSugerido,
  type ItemDaRegua,
  type RegraDaPessoa,
  type RegrasDaAgenda,
  type ResultadoDaRegua,
  type RitoDaAgenda,
  type SocioDaAgenda,
  type TipoQueSeMarca,
} from './agenda-v2.js';
import { normalizarParaAgenda } from './agenda.js';
import { instanteNoFuso, partesNoFuso, somarDias } from './schemas.js';

export interface EntradaDaRegua {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  proposta: CompromissoProposto;
  /** Para "no passado" e para a frase "em N dias". */
  agora?: Date;
}

/* ---------------------------------------------------------------------------
 * Relógio de parede (São Paulo)
 * ------------------------------------------------------------------------- */

const MIN = 60_000;
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM` → minutos do dia. Hora inválida = nulo. */
export function minutosDaHora(h: string | null | undefined): number | null {
  if (!h || !HORA.test(h)) return null;
  const [a, b] = h.split(':').map(Number);
  return a * 60 + b;
}

/** Minutos do dia → `HH:MM`. 1440 vira `24:00` (o fim do dia). */
export function horaDosMinutos(m: number): string {
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** 0 = domingo, de um dia civil `AAAA-MM-DD`. */
export function diaDaSemanaDaAgenda(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** O dia e o minuto do dia de um instante, no fuso da agenda. */
export function noFusoDaAgenda(instante: Date): { dia: string; minutos: number } {
  const p = partesNoFuso(instante, AGENDA_FUSO);
  return { dia: p.dia, minutos: minutosDaHora(p.hora) ?? 0 };
}

/** O instante de `dia` às `minutos` (0 a 1440) no fuso da agenda. */
export function instanteDaAgenda(dia: string, minutos: number): Date {
  if (minutos >= 1440) return instanteNoFuso(somarDias(dia, 1), '00:00', AGENDA_FUSO);
  return instanteNoFuso(dia, horaDosMinutos(minutos), AGENDA_FUSO);
}

/** `qua 04/11`. */
export function rotuloDoDia(dia: string): string {
  return `${DIAS_CURTOS[diaDaSemanaDaAgenda(dia)]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** `HH:MM` de um instante no fuso da agenda. */
export function horaDaAgenda(instante: Date | string): string {
  return partesNoFuso(typeof instante === 'string' ? new Date(instante) : instante, AGENDA_FUSO).hora;
}

/** Dia útil: segunda a sexta (o feriado é outra regra). */
export const ehDiaUtilDaSemana = (dia: string): boolean => {
  const d = diaDaSemanaDaAgenda(dia);
  return d >= 1 && d <= 5;
};

/** Qual ocorrência do dia da semana no mês (1 = o primeiro sábado do mês). */
export function ordinalNoMes(dia: string): number {
  return Math.floor((Number(dia.slice(8, 10)) - 1) / 7) + 1;
}

const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;
const MEIA_NOITE_UTC = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/;

/**
 * Os dias civis que um evento toca. O de dia inteiro chega como data pura, como
 * meia-noite UTC (o Google manda `date`) ou como meia-noite de São Paulo; o fim
 * é exclusivo nos três casos.
 */
export function diasDoEvento(ev: Pick<EventoDaAgenda, 'inicio' | 'fim' | 'diaInteiro'>): string[] {
  let de: string;
  let ate: string;
  if (ev.diaInteiro && (DATA_PURA.test(ev.inicio) || MEIA_NOITE_UTC.test(ev.inicio))) {
    de = ev.inicio.slice(0, 10);
    const fim = ev.fim.slice(0, 10);
    ate = fim > de ? somarDias(fim, -1) : de;
  } else {
    const i = new Date(ev.inicio);
    const f = new Date(ev.fim);
    de = noFusoDaAgenda(i).dia;
    ate = noFusoDaAgenda(new Date(Math.max(i.getTime(), f.getTime() - 1))).dia;
  }
  const dias: string[] = [];
  for (let d = de; d <= ate && dias.length < 400; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** O intervalo em ms do evento (o de dia inteiro ocupa os dias inteiros, em São Paulo). */
function intervaloDoEvento(ev: Pick<EventoDaAgenda, 'inicio' | 'fim' | 'diaInteiro'>): [number, number] {
  if (ev.diaInteiro) {
    const dias = diasDoEvento(ev);
    return [instanteDaAgenda(dias[0], 0).getTime(), instanteDaAgenda(dias[dias.length - 1], 1440).getTime()];
  }
  return [new Date(ev.inicio).getTime(), new Date(ev.fim).getTime()];
}

const sobrepoe = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

const faixa = (i: number, f: number): string => `das ${horaDaAgenda(new Date(i))} às ${horaDaAgenda(new Date(f))}`;

/* ---------------------------------------------------------------------------
 * As ocupações: cada evento do espelho, com quem ele ocupa
 * ------------------------------------------------------------------------- */

type NaturezaDaOcupacao = 'reuniao' | 'fechado' | 'pessoal' | 'fora' | 'outro';

interface Ocupacao {
  ev: EventoDaAgenda;
  natureza: NaturezaDaOcupacao;
  pessoas: Set<SocioDaAgenda>;
  intervalo: [number, number];
  presencial: boolean;
  /** Fechado vindo do livre/ocupado da agenda pessoal (sem título). */
  pessoal: boolean;
}

const naturezaDoEvento = (ev: EventoDaAgenda): NaturezaDaOcupacao | null => {
  switch (ev.leitura?.tipo) {
    case 'cliente':
    case 'interna':
      return 'reuniao';
    case 'fechado':
      return 'fechado';
    case 'pessoal':
      return 'pessoal';
    case 'fora':
      return 'fora';
    case 'feriado':
      // O feriado vale pela tabela `Feriado`, não pelo evento.
      return null;
    default:
      return ev.origem === 'livre_ocupado' ? 'fechado' : 'outro';
  }
};

/** Quem um evento ocupa: o título lido, o e-mail do sócio entre os convidados, a agenda pessoal. */
export function pessoasDoEvento(ev: EventoDaAgenda, pessoas: readonly RegraDaPessoa[]): Set<SocioDaAgenda> {
  const s = new Set<SocioDaAgenda>(ev.leitura?.responsaveis ?? []);
  const email = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  for (const p of pessoas) {
    if (ev.origem === 'livre_ocupado' && p.emailPessoal && email(p.emailPessoal) === email(ev.agenda)) s.add(p.nome);
    if (p.email && ev.convidados?.some((c) => email(c.email) === email(p.email) && c.resposta !== 'recusado')) s.add(p.nome);
  }
  return s;
}

function ocupacoes(eventos: readonly EventoDaAgenda[], pessoas: readonly RegraDaPessoa[], ignorar?: string | null): Ocupacao[] {
  const regra = new Map(pessoas.map((p) => [p.nome, p]));
  const out: Ocupacao[] = [];
  for (const ev of eventos) {
    if (!ev || ev.status === 'cancelado') continue;
    if (ignorar && ev.id === ignorar) continue;
    const natureza = naturezaDoEvento(ev);
    if (!natureza) continue;
    const quem = pessoasDoEvento(ev, pessoas);
    const pessoal = ev.origem === 'livre_ocupado';
    // O Fechado da agenda pessoal só conta para quem ligou "agenda pessoal como Fechado".
    if (pessoal) for (const n of [...quem]) if (regra.get(n) && !regra.get(n)!.fechadoLigado) quem.delete(n);
    if (quem.size === 0) continue;
    out.push({
      ev,
      natureza,
      pessoas: quem,
      intervalo: intervaloDoEvento(ev),
      presencial: ev.leitura?.modalidade === 'presencial',
      pessoal,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Feriados e ritos
 * ------------------------------------------------------------------------- */

/** Os feriados LIGADOS do dia. */
export function feriadosDoDiaDaAgenda(dia: string, feriados: readonly FeriadoDaAgenda[]): FeriadoDaAgenda[] {
  return feriados.filter((f) => f.ligado && f.data === dia);
}

/** O feriado que FECHA a agenda (nacional ou municipal ligado), ou nulo. */
export function feriadoQueFecha(dia: string, feriados: readonly FeriadoDaAgenda[]): FeriadoDaAgenda | null {
  return feriadosDoDiaDaAgenda(dia, feriados).find((f) => f.tipo !== 'facultativo') ?? null;
}

/** Dia útil da agenda: segunda a sexta sem feriado que fecha. */
export function ehDiaUtilDaAgenda(dia: string, feriados: readonly FeriadoDaAgenda[]): boolean {
  return ehDiaUtilDaSemana(dia) && !feriadoQueFecha(dia, feriados);
}

/** O próximo dia útil depois de `dia`. */
export function proximoDiaUtil(dia: string, feriados: readonly FeriadoDaAgenda[]): string {
  let d = somarDias(dia, 1);
  for (let i = 0; i < 30 && !ehDiaUtilDaAgenda(d, feriados); i++) d = somarDias(d, 1);
  return d;
}

export interface OcorrenciaDoRito {
  rito: RitoDaAgenda;
  dia: string;
  intervalo: [number, number];
  pessoas: SocioDaAgenda[];
}

/** As ocorrências dos ritos LIGADOS num dia (respeitando o `ordinalNoMes` e o dia inteiro). */
export function ritosDoDia(dia: string, ritos: readonly RitoDaAgenda[]): OcorrenciaDoRito[] {
  const dow = diaDaSemanaDaAgenda(dia);
  const out: OcorrenciaDoRito[] = [];
  for (const rito of ritos) {
    if (!rito.ligado || rito.diaDaSemana !== dow) continue;
    if (rito.ordinalNoMes != null && ordinalNoMes(dia) !== rito.ordinalNoMes) continue;
    const ini = minutosDaHora(rito.inicio);
    const intervalo: [number, number] =
      ini == null
        ? [instanteDaAgenda(dia, 0).getTime(), instanteDaAgenda(dia, 1440).getTime()]
        : [instanteDaAgenda(dia, ini).getTime(), instanteDaAgenda(dia, ini).getTime() + Math.max(rito.duracaoMin, 1) * MIN];
    out.push({ rito, dia, intervalo, pessoas: sociosDoResponsavel(rito.quem) });
  }
  return out;
}

const quandoDoRito = (o: OcorrenciaDoRito): string =>
  o.rito.inicio ? `${rotuloDoDia(o.dia)} ${o.rito.inicio}` : `${rotuloDoDia(o.dia)}, dia inteiro`;

/* ---------------------------------------------------------------------------
 * avaliarNaRegua
 * ------------------------------------------------------------------------- */

const ehReuniaoProposta = (t: TipoQueSeMarca): boolean => t === 'cliente' || t === 'interna';
const ehLeve = (t: TipoQueSeMarca): boolean => t === 'bloqueio' || t === 'pessoal';

const ordinal = (n: number): string => `${n}ª`;

const nomeDoEvento = (ev: EventoDaAgenda): string => ev.titulo?.trim() || 'um compromisso';

/** O semáforo de um compromisso proposto. */
export function avaliarNaRegua(entrada: EntradaDaRegua): ResultadoDaRegua {
  const { proposta, regras, agora } = entrada;
  const itens: ItemDaRegua[] = [];
  const ini = new Date(proposta.inicio).getTime();
  const fim = new Date(proposta.fim).getTime();
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= ini) {
    return { cor: 'vermelho', itens: [{ nivel: 'bloqueio', regra: 'janela', frase: 'O fim tem de vir depois do início.' }] };
  }
  const intervalo: [number, number] = [ini, fim];
  const { dia, minutos: minIni } = noFusoDaAgenda(new Date(ini));
  const minFim = noFusoDaAgenda(new Date(fim)).dia === dia ? noFusoDaAgenda(new Date(fim)).minutos : 1440;
  const responsaveis = [...new Set(proposta.responsaveis)].filter((s) => (SOCIOS_DA_AGENDA as readonly string[]).includes(s));
  const regraDe = new Map(regras.pessoas.map((p) => [p.nome, p]));
  const ocup = ocupacoes(entrada.eventos, regras.pessoas, proposta.ignorarEventoId);
  const reuniao = ehReuniaoProposta(proposta.tipo);
  const presencial = reuniao && proposta.modalidade === 'presencial';
  const add = (i: ItemDaRegua) => itens.push(i);

  if (agora && ini < agora.getTime()) {
    add({ nivel: 'bloqueio', regra: 'janela', frase: 'Esse horário já passou.' });
  }

  // Feriado: vale para reunião (Fora, bloqueio e pessoal no feriado não pedem nada).
  if (reuniao) {
    for (const d of diasDoEvento({ inicio: proposta.inicio, fim: proposta.fim, diaInteiro: false })) {
      for (const f of feriadosDoDiaDaAgenda(d, regras.feriados)) {
        if (f.tipo === 'facultativo') {
          add({ nivel: 'atencao', regra: 'feriado_facultativo', frase: `Ponto facultativo: ${f.nome} (${rotuloDoDia(d)}).` });
        } else {
          const onde = f.tipo === 'municipal' && f.cidade ? ` em ${f.cidade}` : '';
          add({ nivel: 'bloqueio', regra: 'feriado', frase: `Feriado${onde}: ${f.nome} (${rotuloDoDia(d)}). Agenda fechada.` });
        }
      }
    }
  }

  // Os ritos do dia que o compromisso cobre.
  const ritos = diasDoEvento({ inicio: proposta.inicio, fim: proposta.fim, diaInteiro: proposta.tipo === 'fora' })
    .flatMap((d) => ritosDoDia(d, regras.ritos))
    .filter((o) => (proposta.tipo === 'fora' ? true : sobrepoe(o.intervalo, intervalo)));
  const ehOProprioRito = (o: OcorrenciaDoRito): boolean =>
    proposta.tipo === 'interna' &&
    normalizarParaAgenda(o.rito.titulo).startsWith(normalizarParaAgenda('Reunião Interna')) &&
    o.intervalo[0] === ini &&
    o.intervalo[1] === fim;
  /** Os títulos dos ritos que tocam: o evento do próprio rito não vira choque, vira o item do rito. */
  const titulosDosRitos = new Set(ritos.map((o) => normalizarParaAgenda(o.rito.titulo)));

  const comBloqueio = new Set<SocioDaAgenda>();
  const bloqueio = (pessoa: SocioDaAgenda, i: Omit<ItemDaRegua, 'nivel' | 'pessoa'>) => {
    comBloqueio.add(pessoa);
    add({ ...i, nivel: 'bloqueio', pessoa });
  };

  for (const pessoa of responsaveis) {
    const regra = regraDe.get(pessoa);
    const dela = ocup.filter((o) => o.pessoas.has(pessoa));

    // Fora: fecha a agenda do dia da pessoa.
    if (proposta.tipo !== 'fora') {
      const fora = dela.find((o) => o.natureza === 'fora' && diasDoEvento(o.ev).includes(dia));
      if (fora) {
        const motivo = fora.ev.leitura?.motivo ? ` (${fora.ev.leitura.motivo})` : '';
        const sub = regra?.substituto ? ` Substituto: ${regra.substituto}.` : '';
        bloqueio(pessoa, { regra: 'fora', frase: `${pessoa} está Fora nesse dia${motivo}.${sub}`, eventoId: fora.ev.id });
      }
    } else {
      const doDia = dela.filter((o) => o.natureza === 'reuniao' && sobrepoe(o.intervalo, intervalo));
      if (doDia.length) {
        add({
          nivel: 'atencao',
          regra: 'fora',
          pessoa,
          frase: `${pessoa} tem ${doDia.length} ${doDia.length === 1 ? 'reunião' : 'reuniões'} nesse período.`,
          eventoId: doDia[0].ev.id,
        });
      }
    }

    // Bloqueio fixo.
    if (regra && proposta.tipo !== 'fora' && !ehLeve(proposta.tipo)) {
      for (const b of regra.bloqueiosFixos ?? []) {
        if (b.diaDaSemana !== diaDaSemanaDaAgenda(dia)) continue;
        const bi = minutosDaHora(b.inicio);
        if (bi == null) continue;
        const bf = minutosDaHora(b.fim ?? null) ?? 1440;
        if (minIni < bf && bi < minFim) {
          const ate = b.fim ? ` às ${b.fim}` : '';
          bloqueio(pessoa, {
            regra: 'bloqueio_fixo',
            frase: `${pessoa} tem bloqueio fixo ${DIAS_CURTOS[b.diaDaSemana]} ${b.fim ? `das ${b.inicio}` : `a partir de ${b.inicio}`}${ate}.`,
          });
        }
      }
    }

    // Choques: Fechado, compromisso pessoal e a mesma pessoa em dois lugares.
    if (proposta.tipo !== 'fora') {
      for (const o of dela) {
        if (o.natureza === 'fora' || !sobrepoe(o.intervalo, intervalo)) continue;
        if (o.ev.diaInteiro && (o.natureza === 'reuniao' || o.natureza === 'outro')) continue;
        const leve = o.natureza === 'fechado' || o.natureza === 'pessoal';
        if (leve && ehLeve(proposta.tipo)) continue; // Fechado contra Fechado não é choque.
        const [a, b] = o.intervalo;
        if (o.natureza === 'fechado') {
          bloqueio(pessoa, {
            regra: 'fechado',
            frase: `${pessoa} está Fechado ${o.ev.diaInteiro ? 'o dia inteiro' : faixa(a, b)}${o.pessoal ? ' (agenda pessoal)' : ''}.`,
            eventoId: o.ev.id,
          });
          continue;
        }
        if (o.ev.titulo && titulosDosRitos.has(normalizarParaAgenda(o.ev.titulo))) continue;
        bloqueio(pessoa, {
          regra: 'choque',
          frase:
            o.natureza === 'pessoal'
              ? `${pessoa} tem compromisso pessoal ${faixa(a, b)}.`
              : `${pessoa} já tem ${nomeDoEvento(o.ev)} ${faixa(a, b)}.`,
          eventoId: o.ev.id,
        });
      }
    }

    // Ritos protegidos.
    for (const o of ritos) {
      if (!o.pessoas.includes(pessoa) || ehOProprioRito(o)) continue;
      const frase =
        proposta.tipo === 'fora'
          ? `${pessoa} Fora no dia do rito: ${o.rito.nome} (${quandoDoRito(o)}).`
          : `Em cima do rito: ${o.rito.nome} (${quandoDoRito(o)}).`;
      if (o.rito.politica === 'bloqueia' && proposta.tipo !== 'fora') bloqueio(pessoa, { regra: 'rito', frase });
      else add({ nivel: 'atencao', regra: 'rito', pessoa, frase });
    }

    if (!reuniao) continue;

    // Teto de reuniões no dia.
    if (regra) {
      const n =
        dela.filter((o) => o.natureza === 'reuniao' && !o.ev.diaInteiro && noFusoDaAgenda(new Date(o.intervalo[0])).dia === dia).length + 1;
      const frase = `${ordinal(n)} reunião do ${pessoa} no dia (limite ${regra.tetoPorDia})`;
      if (n > regra.tetoPorDia) bloqueio(pessoa, { regra: 'teto', frase });
      else if (n >= regra.tetoPorDia - 1) add({ nivel: 'atencao', regra: 'teto', pessoa, frase });
    }

    // Janela de trabalho e dia útil.
    if (!ehDiaUtilDaSemana(dia)) {
      add({ nivel: 'atencao', regra: 'janela', pessoa, frase: `${rotuloDoDia(dia)} não é dia útil.` });
    }
    if (regra) {
      const ji = minutosDaHora(regra.janela.inicio);
      const jf = minutosDaHora(regra.janela.fim);
      if (ji != null && jf != null && (minIni < ji || minFim > jf)) {
        add({
          nivel: 'atencao',
          regra: 'janela',
          pessoa,
          frase: `Fora da janela de trabalho de ${pessoa} (${regra.janela.inicio} às ${regra.janela.fim}).`,
        });
      }
    }

    // Trajeto antes de presencial e intervalo mínimo, contra os vizinhos do mesmo dia.
    const trajeto = regra?.trajetoMin ?? 0;
    const intervaloMin = regra?.intervaloMin ?? 0;
    for (const o of dela) {
      if (o.natureza === 'fora' || o.ev.diaInteiro || sobrepoe(o.intervalo, intervalo)) continue;
      const antes = o.intervalo[1] <= ini;
      const folga = (antes ? ini - o.intervalo[1] : o.intervalo[0] - fim) / MIN;
      // Trajeto: a presencial proposta depois de qualquer ocupação, ou qualquer reunião antes de uma presencial.
      const precisaTrajeto = trajeto > 0 && ((antes && presencial) || (!antes && o.presencial && o.natureza === 'reuniao'));
      if (precisaTrajeto && folga < trajeto) {
        add({
          nivel: 'atencao',
          regra: 'trajeto',
          pessoa,
          eventoId: o.ev.id,
          frase: antes
            ? `Falta o trajeto de ${trajeto} min antes da presencial (depois de ${nomeDoEvento(o.ev)}).`
            : `Falta o trajeto de ${trajeto} min antes de ${nomeDoEvento(o.ev)} (presencial).`,
        });
        continue;
      }
      if (o.natureza === 'reuniao' && intervaloMin > 0 && folga < intervaloMin) {
        add({
          nivel: 'atencao',
          regra: 'intervalo',
          pessoa,
          eventoId: o.ev.id,
          frase: `Sem os ${intervaloMin} min de intervalo ${antes ? 'depois de' : 'antes de'} ${nomeDoEvento(o.ev)}.`,
        });
      }
    }
  }

  // OK: quem está livre e o Meet da online.
  const ok: ItemDaRegua[] = [];
  if (proposta.tipo !== 'fora') {
    for (const pessoa of responsaveis) {
      if (!comBloqueio.has(pessoa)) ok.push({ nivel: 'ok', regra: 'livre', pessoa, frase: `${pessoa} livre ${faixa(ini, fim)}` });
    }
  } else if (!itens.some((i) => i.nivel !== 'ok')) {
    for (const pessoa of responsaveis) ok.push({ nivel: 'ok', regra: 'livre', pessoa, frase: `${pessoa} sem reunião nesse período` });
  }
  if (reuniao && proposta.modalidade === 'online') ok.push({ nivel: 'ok', regra: 'meet', frase: 'Meet nasce junto' });

  const cor = itens.some((i) => i.nivel === 'bloqueio') ? 'vermelho' : itens.some((i) => i.nivel === 'atencao') ? 'amarelo' : 'verde';
  const peso = { bloqueio: 0, atencao: 1, ok: 2 } as const;
  return { cor, itens: [...ok, ...itens].sort((a, b) => peso[a.nivel] - peso[b.nivel]) };
}

/* ---------------------------------------------------------------------------
 * sugerirHorarios e horariosLivres
 * ------------------------------------------------------------------------- */

export interface EntradaDaSugestao {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  /** O compromisso sem horário: tipo, modalidade, quem e a duração. */
  base: Omit<CompromissoProposto, 'inicio' | 'fim'> & { duracaoMin: number };
  /** A partir de quando procurar. */
  aPartirDe: Date;
  /** Quantos horários devolver (padrão 3). */
  limite?: number;
  /** Passo da procura em minutos (padrão 30). */
  passoMin?: number;
  /** Até quantos dias à frente (padrão 14). */
  dias?: number;
}

/**
 * A janela comum de quem vai: o maior início e o menor fim das janelas. Sem regra
 * de ninguém, 08:00 às 18:00 (só para não sugerir madrugada; a régua não usa isso).
 */
function janelaComum(responsaveis: readonly SocioDaAgenda[], pessoas: readonly RegraDaPessoa[]): [number, number] {
  const regras = responsaveis.map((r) => pessoas.find((p) => p.nome === r)).filter((p): p is RegraDaPessoa => !!p);
  if (!regras.length) return [8 * 60, 18 * 60];
  const ini = Math.max(...regras.map((p) => minutosDaHora(p.janela.inicio) ?? 0));
  const fim = Math.min(...regras.map((p) => minutosDaHora(p.janela.fim) ?? 1440));
  return [ini, fim];
}

/** Os candidatos de um dia, alinhados ao passo, dentro da janela comum, depois de `desde`. */
function* candidatosDoDia(dia: string, janela: [number, number], duracao: number, passo: number, desde: number): Generator<[Date, Date]> {
  const primeiro = Math.ceil(janela[0] / passo) * passo;
  for (let m = primeiro; m + duracao <= janela[1]; m += passo) {
    const i = instanteDaAgenda(dia, m);
    if (i.getTime() < desde) continue;
    yield [i, new Date(i.getTime() + duracao * MIN)];
  }
}

/** Os próximos horários VERDES. */
export function sugerirHorarios(entrada: EntradaDaSugestao): HorarioSugerido[] {
  const limite = entrada.limite ?? 3;
  const passo = Math.max(5, entrada.passoMin ?? 30);
  const dias = Math.max(1, entrada.dias ?? 14);
  const duracao = Math.max(5, entrada.base.duracaoMin);
  const { duracaoMin: _d, ...base } = entrada.base;
  void _d;
  const janela = janelaComum(base.responsaveis, entrada.regras.pessoas);
  const desde = entrada.aPartirDe.getTime();
  const primeiroDia = noFusoDaAgenda(entrada.aPartirDe).dia;
  const fimDaBusca = desde + (dias + 1) * 24 * 60 * MIN;
  const eventos = entrada.eventos.filter((e) => new Date(e.fim).getTime() >= desde - 24 * 60 * MIN && new Date(e.inicio).getTime() <= fimDaBusca);
  const out: HorarioSugerido[] = [];
  for (let k = 0; k < dias && out.length < limite; k++) {
    const dia = somarDias(primeiroDia, k);
    for (const [i, f] of candidatosDoDia(dia, janela, duracao, passo, desde)) {
      const r = avaliarNaRegua({
        eventos,
        regras: entrada.regras,
        proposta: { ...base, inicio: i.toISOString(), fim: f.toISOString() },
        agora: entrada.aPartirDe,
      });
      if (r.cor === 'verde') out.push({ inicio: i.toISOString(), fim: f.toISOString() });
      if (out.length >= limite) break;
    }
  }
  return out;
}

export interface EntradaDosLivres {
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  socio: SocioDaAgenda;
  tipo: 'cliente' | 'interna';
  modalidade: 'online' | 'presencial';
  duracaoMin: number;
  /** `AAAA-MM-DD`, inclusive, no fuso da agenda. */
  de: string;
  ate: string;
  agora: Date;
  /** Passo em minutos (padrão 30). */
  passoMin?: number;
}

/** O teto de dias que o link público alcança numa leitura. */
export const AGENDA_LIVRES_DIAS_MAXIMO = 62;

/**
 * O que o link público mostra: por dia útil, os horários VERDES da manhã (antes
 * das 12:00) e da tarde, só depois de `agora`. Nunca devolve título nem quem:
 * só a hora de início. Dia sem horário não aparece.
 */
export function horariosLivres(entrada: EntradaDosLivres): DiaLivre[] {
  if (!DATA_PURA.test(entrada.de) || !DATA_PURA.test(entrada.ate) || entrada.ate < entrada.de) return [];
  const passo = Math.max(5, entrada.passoMin ?? 30);
  const duracao = Math.max(5, entrada.duracaoMin);
  const janela = janelaComum([entrada.socio], entrada.regras.pessoas);
  const desde = entrada.agora.getTime();
  const out: DiaLivre[] = [];
  let n = 0;
  for (let dia = entrada.de; dia <= entrada.ate && n < AGENDA_LIVRES_DIAS_MAXIMO; dia = somarDias(dia, 1), n++) {
    if (!ehDiaUtilDaAgenda(dia, entrada.regras.feriados)) continue;
    const manha: string[] = [];
    const tarde: string[] = [];
    for (const [i, f] of candidatosDoDia(dia, janela, duracao, passo, desde)) {
      const r = avaliarNaRegua({
        eventos: entrada.eventos,
        regras: entrada.regras,
        proposta: { tipo: entrada.tipo, modalidade: entrada.modalidade, responsaveis: [entrada.socio], inicio: i.toISOString(), fim: f.toISOString() },
        agora: entrada.agora,
      });
      if (r.cor !== 'verde') continue;
      const hora = horaDaAgenda(i);
      (hora < '12:00' ? manha : tarde).push(hora);
    }
    if (manha.length || tarde.length) out.push({ dia, manha, tarde });
  }
  return out;
}
