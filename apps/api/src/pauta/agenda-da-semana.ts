import {
  PAUTA_CHAVE_DA_GRADE,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FUSO_DA_AGENDA,
  PAUTA_GRADE_PADRAO,
  PAUTA_HORIZONTE_DA_AGENDA_DIAS,
  PAUTA_TETO_DO_TEXTO_DA_GRADE,
  diaNoFuso,
  feriadoDoDia,
  instanteNoFuso,
  lerGradeDoTexto,
  somarDias,
  diaDaSemanaDe,
  type PautaFormatoDaSemana,
  type PautaGradeDaSemana,
  type PautaMidiaNaAgenda,
  type PautaPecaStatus,
  type PautaPostagemDaPeca,
} from '@mktos/shared';
import { lerMetaDaSemana } from './derivacao-do-episodio';

/*
 * O CALENDÁRIO DA SEMANA (MC16), a parte pura: os slots que a grade da empresa
 * abre num período (no fuso de São Paulo, pulando feriado) e a distribuição das
 * peças aprovadas nos próximos slots livres, sem colidir com o que já está
 * agendado. O serviço (`agenda.service.ts`) lê o banco e grava.
 */

export interface SlotDaAgenda {
  formato: PautaFormatoDaSemana;
  em: Date;
  /** `AAAA-MM-DD` e `HH:MM`, no fuso da agenda. */
  dia: string;
  hora: string;
}

/** A nota da grade, com o que a leitura achou; sem nota (ou sem slot válido), o padrão. */
export function gradeDaNota(
  nota: { body: string; arquivadoEm?: unknown; versao?: number } | null,
): { grade: PautaGradeDaSemana; origem: 'empresa' | 'padrao'; versao: number | null; avisos: string[] } {
  if (!nota || nota.arquivadoEm || !nota.body.trim()) {
    return { grade: PAUTA_GRADE_PADRAO, origem: 'padrao', versao: null, avisos: [] };
  }
  // A nota também se edita por PUT /memoria/:id, sem o teto do PUT da grade; e
  // ela é lida em todo GET da agenda.
  if (nota.body.length > PAUTA_TETO_DO_TEXTO_DA_GRADE) {
    return {
      grade: PAUTA_GRADE_PADRAO,
      origem: 'padrao',
      versao: nota.versao ?? null,
      avisos: [`A nota ${PAUTA_CHAVE_DA_GRADE} passa do teto de ${PAUTA_TETO_DO_TEXTO_DA_GRADE} caracteres: vale a grade padrão até ela ser encurtada.`],
    };
  }
  const { grade, avisos } = lerGradeDoTexto(nota.body);
  if (!grade.slots.length) {
    return {
      grade: { ...PAUTA_GRADE_PADRAO, feriados: grade.feriados },
      origem: 'padrao',
      versao: nota.versao ?? null,
      avisos: [...avisos, `A nota ${PAUTA_CHAVE_DA_GRADE} não tem nenhum slot válido: vale a grade padrão.`],
    };
  }
  return { grade, origem: 'empresa', versao: nota.versao ?? null, avisos };
}

/** Chave de colisão: o mesmo formato no mesmo minuto. */
export function chaveDoSlot(formato: string, em: Date): string {
  return `${formato}|${new Date(Math.floor(em.getTime() / 60_000) * 60_000).toISOString()}`;
}

/**
 * Os slots da grade de `desde` (inclusive) por `dias` dias civis, em ordem de
 * tempo. Dia de feriado (nacional ou da empresa) não abre slot.
 */
export function slotsDoPeriodo(
  grade: PautaGradeDaSemana,
  desde: Date,
  dias: number,
  fuso: string = PAUTA_FUSO_DA_AGENDA,
): SlotDaAgenda[] {
  const primeiro = diaNoFuso(desde, fuso);
  const saida: SlotDaAgenda[] = [];
  for (let i = 0; i < dias; i++) {
    const dia = somarDias(primeiro, i);
    if (feriadoDoDia(dia, grade.feriados)) continue;
    const semana = diaDaSemanaDe(dia);
    for (const s of grade.slots) {
      if (s.dia !== semana) continue;
      const em = instanteNoFuso(dia, s.hora, fuso);
      if (em.getTime() < desde.getTime()) continue;
      saida.push({ formato: s.formato, em, dia, hora: s.hora });
    }
  }
  const ordem = (f: PautaFormatoDaSemana) => PAUTA_FORMATOS_DA_SEMANA.indexOf(f);
  return saida.sort((a, b) => a.em.getTime() - b.em.getTime() || ordem(a.formato) - ordem(b.formato));
}

export interface PecaParaAgendar {
  id: string;
  formato: PautaFormatoDaSemana;
  /** O número da matéria no episódio: a matéria 1 pega o primeiro slot do formato. */
  itemN: number;
}

export interface Distribuida {
  alocacoes: Array<{ id: string; formato: PautaFormatoDaSemana; itemN: number; em: Date }>;
  semVaga: PecaParaAgendar[];
}

/**
 * Aloca as peças nos próximos slots livres do formato de cada uma, a partir de
 * `desde`, em ordem de matéria. `ocupados` são as peças já agendadas (de
 * qualquer episódio): o slot delas não é oferecido de novo. O que não cabe no
 * horizonte volta em `semVaga`, sem data inventada.
 */
export function distribuir(o: {
  pecas: readonly PecaParaAgendar[];
  ocupados: ReadonlyArray<{ formato: string; em: Date }>;
  grade: PautaGradeDaSemana;
  desde: Date;
  dias?: number;
  fuso?: string;
}): Distribuida {
  const tomados = new Set(o.ocupados.map((x) => chaveDoSlot(x.formato, x.em)));
  const livres = slotsDoPeriodo(o.grade, o.desde, o.dias ?? PAUTA_HORIZONTE_DA_AGENDA_DIAS, o.fuso).filter(
    (s) => !tomados.has(chaveDoSlot(s.formato, s.em)),
  );
  const ordem = (f: PautaFormatoDaSemana) => PAUTA_FORMATOS_DA_SEMANA.indexOf(f);
  const fila = [...o.pecas].sort((a, b) => a.itemN - b.itemN || ordem(a.formato) - ordem(b.formato) || a.id.localeCompare(b.id));
  const saida: Distribuida = { alocacoes: [], semVaga: [] };
  for (const p of fila) {
    const i = livres.findIndex((s) => s.formato === p.formato);
    if (i < 0) {
      saida.semVaga.push(p);
      continue;
    }
    const [slot] = livres.splice(i, 1);
    saida.alocacoes.push({ id: p.id, formato: p.formato, itemN: p.itemN, em: slot.em });
  }
  return saida;
}

/** O comando do Mac que produz a mídia que falta, por formato. */
export function comandoDaMidia(formato: PautaFormatoDaSemana, apelido: string): string {
  const sub = formato === 'carrossel' ? 'carrosseis' : formato === 'story' ? 'stories' : 'cortes';
  return `/root-midia ${sub} ${apelido}`;
}

/** A postagem da peça: à mão (MC16, sem `externalId`) ou pela MC17. */
export function postagemDaPeca(p: { status: PautaPecaStatus; publicadaEm: Date | null; externalId: string | null; urlPublicada: string | null }): PautaPostagemDaPeca | null {
  if (p.status !== 'publicada' || !p.publicadaEm) return null;
  return { em: p.publicadaEm.toISOString(), manual: !p.externalId, url: p.urlPublicada ?? null };
}

/**
 * Onde está a mídia para postar: o PNG no storage, o mp4 no Mac, ou o comando
 * que a faz. O carrossel só está pronto com um PNG por slide (o upload do Mac
 * para na primeira falha): faltando algum, é `parcial`, com os que faltam.
 */
export function midiaDaPeca(formato: PautaFormatoDaSemana, meta: unknown, apelido: string): PautaMidiaNaAgenda {
  const m = lerMetaDaSemana(meta);
  const comando = comandoDaMidia(formato, apelido);
  if (formato === 'corte') {
    return m.video?.arquivo ? { onde: 'mac', arquivo: m.video.arquivo } : { onde: 'nenhuma', comando };
  }
  if (!m.imagens.length) return { onde: 'nenhuma', comando };
  const imagens = [...new Set(m.imagens.map((i) => i.n))].sort((a, b) => a - b);
  // Peça sem os slides na meta (anterior à MC15): o maior número que subiu.
  const esperadas = formato === 'story' ? 1 : m.slides?.length || Math.max(...imagens);
  const faltam = Array.from({ length: esperadas }, (_, i) => i + 1).filter((n) => !imagens.includes(n));
  if (faltam.length) return { onde: 'parcial', imagens, esperadas, faltam, comando };
  return { onde: 'storage', imagens, esperadas };
}
