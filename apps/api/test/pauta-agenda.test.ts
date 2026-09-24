import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  PAUTA_GRADE_PADRAO,
  PAUTA_TETO_DO_A_PARTIR_DE_DIAS,
  PautaDiaCivilSchema,
  PautaDistribuirSchema,
  PautaGradeSalvarSchema,
  PautaMarcarPostadaSchema,
  PautaReagendarSchema,
  diaNoFuso,
  feriadoDoDia,
  feriadosDoAno,
  horaNoFuso,
  instanteNoFuso,
  lerGradeDoTexto,
  motivoParaNaoAgendar,
  pascoa,
  segundaDaSemana,
  textoDaGrade,
  type PautaEpisodioStatus,
  type PautaGradeDaSemana,
  type PautaItemCurado,
} from '@mktos/shared';

import { chaveDoSlot, distribuir, gradeDaNota, midiaDaPeca, postagemDaPeca, slotsDoPeriodo } from '../src/pauta/agenda-da-semana';
import { AgendaService } from '../src/pauta/agenda.service';
import { AgendaController } from '../src/pauta/agenda.controller';
import { EpisodioService } from '../src/pauta/episodio.service';
import { RotinaService } from '../src/pauta/rotina.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CALENDÁRIO DA SEMANA — MC16: as peças aprovadas nos slots da grade, e
 * cada slot pronto para postar à mão.
 *
 * Quatro camadas:
 *   1. a parte pura: o relógio de São Paulo, os feriados, a grade lida do
 *      texto da nota, os slots de um período e o `distribuir` (semana cheia,
 *      feriado pulado, reagendar liberando o slot);
 *   2. os contratos (reagendar, postada, distribuir, grade);
 *   3. o `AgendaService` DE VERDADE com dublês — distribuir, reagendar, marcar
 *      postada, a semana na tela, a grade na memória — e a peça que sai da
 *      agenda quando deixa de estar aprovada;
 *   4. com banco: distribuir, reagendar e postar pela sessão da empresa.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc16';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000016';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W' },
  { id: 'c3', titulo: 'Modelos abertos', url: 'https://noticia.exemplo/abertos', origem: 'R' },
];

const SP = (dia: string, hora: string) => instanteNoFuso(dia, hora);
const iso = (dia: string, hora: string) => SP(dia, hora).toISOString();

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('agenda: o relógio de São Paulo', () => {
  it('meio-dia em São Paulo é 15h em UTC; o dia e a hora voltam do instante', () => {
    expect(iso('2026-09-28', '12:00')).toBe('2026-09-28T15:00:00.000Z');
    expect(iso('2026-09-28', '00:00')).toBe('2026-09-28T03:00:00.000Z');
    const quaseMeiaNoite = new Date('2026-09-29T02:30:00.000Z');
    expect(diaNoFuso(quaseMeiaNoite)).toBe('2026-09-28');
    expect(horaNoFuso(quaseMeiaNoite)).toBe('23:30');
  });

  it('a virada de horário de verão: a hora que não existe vai para depois, a repetida vale a primeira', () => {
    const local = (d: Date, fuso: string) => `${diaNoFuso(d, fuso)} ${horaNoFuso(d, fuso)}`;
    // Nova York, 08/03/2026: 02:00 vira 03:00.
    expect(local(instanteNoFuso('2026-03-08', '02:30', 'America/New_York'), 'America/New_York')).toBe('2026-03-08 03:30');
    // Nova York, 01/11/2026: 01:30 acontece duas vezes; vale a primeira (EDT, -4).
    expect(instanteNoFuso('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
    // São Paulo em 2018: 00:00 de 04/11 virou 01:00. Nunca o sábado às 23h.
    expect(local(instanteNoFuso('2018-11-04', '00:00'), 'America/Sao_Paulo')).toBe('2018-11-04 01:00');
    expect(local(instanteNoFuso('2018-11-04', '00:30'), 'America/Sao_Paulo')).toBe('2018-11-04 01:30');
    // E em 2019, 23:00 de 16/02 se repetiu: a primeira ainda é -02.
    expect(instanteNoFuso('2019-02-16', '23:30').toISOString()).toBe('2019-02-17T01:30:00.000Z');
  });

  it('a semana começa na segunda', () => {
    expect(segundaDaSemana('2026-09-24')).toBe('2026-09-21');
    expect(segundaDaSemana('2026-09-27')).toBe('2026-09-21');
    expect(segundaDaSemana('2026-09-28')).toBe('2026-09-28');
  });

  it('os feriados: fixos, os móveis da Páscoa e os da empresa', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
    const dias = feriadosDoAno(2026).map((f) => f.dia);
    expect(dias).toEqual(expect.arrayContaining(['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-10-12', '2026-11-20', '2026-12-25']));
    expect(feriadoDoDia('2026-10-12')).toBe('Nossa Senhora Aparecida');
    expect(feriadoDoDia('2026-10-13')).toBeNull();
    expect(feriadoDoDia('2026-10-13', ['2026-10-13'])).toBe('Feriado da empresa');
  });
});

describe('agenda: a grade no texto da nota', () => {
  it('o padrão: carrossel seg/qua/sex 12h, corte ter/qui 18h, story todo dia útil 9h — e volta igual do texto', () => {
    const pares = (g: PautaGradeDaSemana) => g.slots.map((s) => `${s.formato} ${s.dia} ${s.hora}`).sort();
    expect(pares(PAUTA_GRADE_PADRAO)).toEqual([
      'carrossel qua 12:00', 'carrossel seg 12:00', 'carrossel sex 12:00',
      'corte qui 18:00', 'corte ter 18:00',
      'story qua 09:00', 'story qui 09:00', 'story seg 09:00', 'story sex 09:00', 'story ter 09:00',
    ]);
    const texto = textoDaGrade(PAUTA_GRADE_PADRAO);
    expect(texto).toContain('carrossel: seg, qua, sex 12:00');
    const lida = lerGradeDoTexto(texto);
    expect(lida.avisos).toEqual([]);
    expect(pares(lida.grade)).toEqual(pares(PAUTA_GRADE_PADRAO));
  });

  it('aceita o jeito de escrever: dias úteis, faixa, 9h, dia por extenso, stories, feriados em DD/MM/AAAA', () => {
    const { grade, avisos } = lerGradeDoTexto(
      ['# minha grade', 'Stories: dias úteis 9h', 'corte vertical: terça e quinta às 18h30', 'carrossel: sab-seg 10:00 # fim de semana', 'feriados: 20/01/2027, 2027-02-01, 20/01/2027'].join('\n'),
    );
    expect(avisos).toEqual([]);
    expect(grade.slots.filter((s) => s.formato === 'story').map((s) => s.dia)).toEqual(['seg', 'ter', 'qua', 'qui', 'sex']);
    expect(grade.slots.filter((s) => s.formato === 'corte')).toEqual([
      { formato: 'corte', dia: 'ter', hora: '18:30' },
      { formato: 'corte', dia: 'qui', hora: '18:30' },
    ]);
    expect(grade.slots.filter((s) => s.formato === 'carrossel').map((s) => s.dia)).toEqual(['seg', 'sab', 'dom']);
    expect(grade.feriados).toEqual(['2027-01-20', '2027-02-01']);
  });

  it('linha que não fecha vira aviso com o número dela — nada é inventado', () => {
    const { grade, avisos } = lerGradeDoTexto(['reels: seg 12h', 'carrossel: seg', 'story: 9h', 'corte: ter 25:00', 'feriados: 31/02/2026', 'qualquer coisa', 'carrossel: qua 12h'].join('\n'));
    expect(avisos).toHaveLength(6);
    expect(avisos[0]).toMatch(/Linha 1: "reels" não é formato/);
    expect(avisos[1]).toMatch(/Linha 2: falta a hora/);
    expect(avisos[2]).toMatch(/Linha 3: faltam os dias/);
    expect(avisos[3]).toMatch(/Linha 4: não entendi "25:00"/);
    expect(avisos[4]).toMatch(/Linha 5: "31\/02\/2026" não é uma data/);
    expect(avisos[5]).toMatch(/Linha 6/);
    expect(grade.slots).toEqual([{ formato: 'carrossel', dia: 'qua', hora: '12:00' }]);
  });

  it('a nota: sem ela, arquivada ou sem slot válido, vale o padrão (e diz por quê)', () => {
    expect(gradeDaNota(null)).toMatchObject({ origem: 'padrao', versao: null, avisos: [] });
    expect(gradeDaNota({ body: 'carrossel: seg 12h', arquivadoEm: '2026-09-01' })).toMatchObject({ origem: 'padrao' });
    const ruim = gradeDaNota({ body: 'bobagem', versao: 3 });
    expect(ruim.origem).toBe('padrao');
    expect(ruim.grade.slots).toEqual(PAUTA_GRADE_PADRAO.slots);
    expect(ruim.avisos.at(-1)).toMatch(/nenhum slot válido/);
    expect(gradeDaNota({ body: 'carrossel: seg 12h', versao: 2 })).toMatchObject({ origem: 'empresa', versao: 2, grade: { slots: [{ formato: 'carrossel', dia: 'seg', hora: '12:00' }] } });
  });

  it('a nota acima do teto (editada por fora, em /memoria) não é lida: vale o padrão, com o aviso', () => {
    const grande = gradeDaNota({ body: `carrossel: seg 12h\n${'a '.repeat(50_000)}b`, versao: 5 });
    expect(grande).toMatchObject({ origem: 'padrao', versao: 5 });
    expect(grande.grade.slots).toEqual(PAUTA_GRADE_PADRAO.slots);
    expect(grande.avisos[0]).toMatch(/passa do teto de 2000 caracteres/);
  });

  it('uma linha longa sem ":" é lida em tempo linear', () => {
    const t0 = performance.now();
    const { avisos } = lerGradeDoTexto(`${'a '.repeat(50_000)}b`);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(avisos).toEqual([expect.stringMatching(/Linha 1: esperava "formato: dias hora"/)]);
    expect(lerGradeDoTexto('Carrossel\t: seg 12h').grade.slots).toEqual([{ formato: 'carrossel', dia: 'seg', hora: '12:00' }]);
    expect(lerGradeDoTexto('12:00 carrossel seg').avisos[0]).toMatch(/Linha 1: esperava/);
  });
});

describe('agenda: os slots e o distribuir', () => {
  const SEG = SP('2026-09-28', '00:00');
  const pecas = [1, 2, 3].flatMap((n) => (['carrossel', 'story', 'corte'] as const).map((formato) => ({ id: `${formato}${n}`, formato, itemN: n })));
  const quandoDe = (r: ReturnType<typeof distribuir>, id: string) => {
    const a = r.alocacoes.find((x) => x.id === id);
    return a ? `${diaNoFuso(a.em)} ${horaNoFuso(a.em)}` : null;
  };

  it('a semana do padrão tem 10 slots, e o que já passou não é oferecido', () => {
    expect(slotsDoPeriodo(PAUTA_GRADE_PADRAO, SEG, 7)).toHaveLength(10);
    const quartaAlmoco = SP('2026-09-30', '12:30');
    const resto = slotsDoPeriodo(PAUTA_GRADE_PADRAO, quartaAlmoco, 5);
    expect(resto[0]).toMatchObject({ formato: 'story', dia: '2026-10-01', hora: '09:00' });
    expect(resto.every((s) => s.em.getTime() >= quartaAlmoco.getTime())).toBe(true);
  });

  it('3 matérias: a matéria 1 pega o primeiro slot de cada formato; o terceiro corte vai para a outra terça', () => {
    const r = distribuir({ pecas, ocupados: [], grade: PAUTA_GRADE_PADRAO, desde: SEG });
    expect(r.semVaga).toEqual([]);
    expect(quandoDe(r, 'carrossel1')).toBe('2026-09-28 12:00');
    expect(quandoDe(r, 'carrossel2')).toBe('2026-09-30 12:00');
    expect(quandoDe(r, 'carrossel3')).toBe('2026-10-02 12:00');
    expect(quandoDe(r, 'story1')).toBe('2026-09-28 09:00');
    expect(quandoDe(r, 'story3')).toBe('2026-09-30 09:00');
    expect(['corte1', 'corte2', 'corte3'].map((id) => quandoDe(r, id))).toEqual(['2026-09-29 18:00', '2026-10-01 18:00', '2026-10-06 18:00']);
  });

  it('semana cheia: com os 10 slots tomados (de outro episódio), tudo vai para a semana seguinte, sem colidir', () => {
    const ocupados = slotsDoPeriodo(PAUTA_GRADE_PADRAO, SEG, 7).map((s) => ({ formato: s.formato, em: s.em }));
    const r = distribuir({ pecas, ocupados, grade: PAUTA_GRADE_PADRAO, desde: SEG });
    const tomados = new Set(ocupados.map((o) => chaveDoSlot(o.formato, o.em)));
    expect(r.alocacoes).toHaveLength(9);
    expect(r.alocacoes.some((a) => tomados.has(chaveDoSlot(a.formato, a.em)))).toBe(false);
    expect(r.alocacoes.every((a) => diaNoFuso(a.em) >= '2026-10-05')).toBe(true);
    expect(quandoDe(r, 'carrossel1')).toBe('2026-10-05 12:00');
  });

  it('feriado é pulado: 12/10 (Aparecida) e o da empresa não abrem slot', () => {
    const r = distribuir({ pecas, ocupados: [], grade: PAUTA_GRADE_PADRAO, desde: SP('2026-10-12', '00:00') });
    expect(r.alocacoes.some((a) => diaNoFuso(a.em) === '2026-10-12')).toBe(false);
    expect(quandoDe(r, 'story1')).toBe('2026-10-13 09:00');
    expect(quandoDe(r, 'carrossel1')).toBe('2026-10-14 12:00');
    const daEmpresa = distribuir({ pecas, ocupados: [], grade: { ...PAUTA_GRADE_PADRAO, feriados: ['2026-09-29'] }, desde: SEG });
    expect(daEmpresa.alocacoes.some((a) => diaNoFuso(a.em) === '2026-09-29')).toBe(false);
    expect(quandoDe(daEmpresa, 'story2')).toBe('2026-09-30 09:00');
  });

  it('reagendar: a peça movida libera o slot dela e ocupa o novo — a próxima distribuição respeita os dois', () => {
    const primeira = distribuir({ pecas: [{ id: 'a', formato: 'carrossel', itemN: 1 }], ocupados: [], grade: PAUTA_GRADE_PADRAO, desde: SEG });
    expect(quandoDe(primeira, 'a')).toBe('2026-09-28 12:00');
    // O operador moveu "a" para quarta 12h: segunda 12h ficou livre.
    const movida = [{ formato: 'carrossel', em: SP('2026-09-30', '12:00') }];
    const r = distribuir({ pecas: [{ id: 'b', formato: 'carrossel', itemN: 1 }, { id: 'c', formato: 'carrossel', itemN: 2 }], ocupados: movida, grade: PAUTA_GRADE_PADRAO, desde: SEG });
    expect(quandoDe(r, 'b')).toBe('2026-09-28 12:00');
    expect(quandoDe(r, 'c')).toBe('2026-10-02 12:00');
  });

  it('o que não cabe no horizonte volta sem data', () => {
    const soSegunda: PautaGradeDaSemana = { slots: [{ formato: 'corte', dia: 'seg', hora: '18:00' }], feriados: [] };
    const r = distribuir({ pecas: pecas.filter((p) => p.formato === 'corte'), ocupados: [], grade: soSegunda, desde: SEG, dias: 8 });
    expect(r.alocacoes.map((a) => a.id)).toEqual(['corte1', 'corte2']);
    expect(r.semVaga.map((p) => p.id)).toEqual(['corte3']);
  });

  it('o carrossel que subiu pela metade não está pronto: diz quantos faltam e o comando que completa', () => {
    const slides = Array.from({ length: 5 }, (_, i) => ({ titulo: `s${i + 1}`, texto: '' }));
    expect(midiaDaPeca('carrossel', { imagens: [{ n: 1, chave: 'a' }, { n: 2, chave: 'b' }], slides }, 'ep-04')).toEqual({
      onde: 'parcial', imagens: [1, 2], esperadas: 5, faltam: [3, 4, 5], comando: '/root-midia carrosseis ep-04',
    });
    // Buraco no meio (o 2 falhou, o 3 subiu numa rodada anterior) também é parcial.
    expect(midiaDaPeca('carrossel', { imagens: [{ n: 1, chave: 'a' }, { n: 3, chave: 'c' }] }, 'ep-04')).toMatchObject({ onde: 'parcial', esperadas: 3, faltam: [2] });
  });

  it('a mídia de cada peça e a postagem', () => {
    expect(midiaDaPeca('corte', { video: { arquivo: '/Users/p/ep-04-m1-corte.mp4' } }, 'ep-04')).toEqual({ onde: 'mac', arquivo: '/Users/p/ep-04-m1-corte.mp4' });
    expect(midiaDaPeca('corte', { video: null }, 'ep-04')).toEqual({ onde: 'nenhuma', comando: '/root-midia cortes ep-04' });
    const slides = (n: number) => Array.from({ length: n }, (_, i) => ({ titulo: `s${i + 1}`, texto: '' }));
    const png = (...ns: number[]) => ns.map((n) => ({ n, chave: `k${n}` }));
    expect(midiaDaPeca('carrossel', { imagens: png(2, 1), slides: slides(2) }, 'ep-04')).toEqual({ onde: 'storage', imagens: [1, 2], esperadas: 2 });
    // Sem os slides na meta (peça antiga): vale o maior número que subiu.
    expect(midiaDaPeca('carrossel', { imagens: png(2, 1) }, 'ep-04')).toEqual({ onde: 'storage', imagens: [1, 2], esperadas: 2 });
    expect(midiaDaPeca('story', { imagens: png(1) }, 'ep-04')).toEqual({ onde: 'storage', imagens: [1], esperadas: 1 });
    expect(midiaDaPeca('story', {}, 'ep-04')).toEqual({ onde: 'nenhuma', comando: '/root-midia stories ep-04' });
    const em = new Date('2026-09-28T15:02:00.000Z');
    expect(postagemDaPeca({ status: 'publicada', publicadaEm: em, externalId: null, urlPublicada: null })).toEqual({ em: em.toISOString(), manual: true, url: null });
    expect(postagemDaPeca({ status: 'publicada', publicadaEm: em, externalId: '1789', urlPublicada: 'https://x' })).toMatchObject({ manual: false });
    // MD6: o post recuperado sem id (story com a resposta perdida) é do OS, não da mão de alguém.
    expect(postagemDaPeca({ status: 'publicada', publicadaEm: em, externalId: null, urlPublicada: null }, true)).toMatchObject({ manual: false });
    expect(postagemDaPeca({ status: 'aprovada', publicadaEm: null, externalId: null, urlPublicada: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('agenda: contratos', () => {
  it('reagendar leva ISO com fuso, ou nulo para tirar da agenda', () => {
    expect(PautaReagendarSchema.parse({ agendadaPara: '2026-09-29T12:00:00-03:00' })).toEqual({ agendadaPara: '2026-09-29T12:00:00-03:00' });
    expect(PautaReagendarSchema.parse({ agendadaPara: null })).toEqual({ agendadaPara: null });
    expect(() => PautaReagendarSchema.parse({ agendadaPara: '29/09/2026 12:00' })).toThrow();
    expect(() => PautaReagendarSchema.parse({})).toThrow();
    expect(() => PautaReagendarSchema.parse({ agendadaPara: null, status: 'publicada' })).toThrow();
  });

  it('postada: a URL é opcional e só https', () => {
    expect(PautaMarcarPostadaSchema.parse({})).toEqual({});
    expect(PautaMarcarPostadaSchema.parse({ url: ' https://www.instagram.com/p/abc/ ' })).toEqual({ url: 'https://www.instagram.com/p/abc/' });
    expect(() => PautaMarcarPostadaSchema.parse({ url: 'http://www.instagram.com/p/abc/' })).toThrow(/https/);
    expect(() => PautaMarcarPostadaSchema.parse({ url: 'javascript:alert(1)' })).toThrow();
    expect(() => PautaMarcarPostadaSchema.parse({ url: `https://x.com/${'a'.repeat(500)}` })).toThrow();
  });

  it('distribuir: o dia é AAAA-MM-DD que existe; a grade é texto com teto', () => {
    expect(PautaDistribuirSchema.parse({})).toEqual({});
    expect(PautaDistribuirSchema.parse({ aPartirDe: '2026-10-05' })).toEqual({ aPartirDe: '2026-10-05' });
    expect(() => PautaDistribuirSchema.parse({ aPartirDe: '2026-02-30' })).toThrow();
    expect(() => PautaDistribuirSchema.parse({ aPartirDe: '05/10/2026' })).toThrow();
    // O ano tem faixa: 9999-12-27 somaria para o ano 10000 e estouraria a conta de fuso.
    expect(() => PautaDiaCivilSchema.parse('9999-12-27')).toThrow(/2000 a 2100/);
    expect(() => PautaDiaCivilSchema.parse('1999-12-31')).toThrow(/2000 a 2100/);
    expect(PautaDiaCivilSchema.parse('2100-12-31')).toBe('2100-12-31');
    expect(() => PautaGradeSalvarSchema.parse({ texto: 'x'.repeat(2_001) })).toThrow();
    expect(() => PautaGradeSalvarSchema.parse({ texto: 'carrossel: seg 12h', outra: 1 })).toThrow();
  });

  it('a agenda vale na Derivação e no Agendado', () => {
    expect(motivoParaNaoAgendar('derivacao')).toBeNull();
    expect(motivoParaNaoAgendar('agendado')).toBeNull();
    expect(motivoParaNaoAgendar('pacote')).toMatch(/Derivação e no Agendado/);
    expect(motivoParaNaoAgendar('concluido')).toMatch(/Concluído/);
  });
});

// ---------------------------------------------------------------------------
// 3. O serviço com dublês
// ---------------------------------------------------------------------------

type Ep = {
  id: string; orgId: string; numero: number; titulo: string; status: PautaEpisodioStatus; rodadaId: string;
  roteiro: string; midia: unknown; transcricao: unknown; transcricaoTexto: string; titulos: unknown; thumbs: unknown;
  descricao: string; bioPageId: string | null; criadoPor: string | null; criadoEm: Date; atualizadoEm: Date;
  rodada: { titulo: string; itens: unknown; janelaIni: Date; janelaFim: Date };
};

type Peca = {
  id: string; orgId: string; rodadaId: string; canal: string; formato: string; titulo: string; corpo: string; meta: unknown;
  status: string; criadaEm: Date; agendadaPara: Date | null; publicadaEm: Date | null; publicadaPor: string | null;
  externalId: string | null; urlPublicada: string | null; erro: string | null;
};

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 'e1', orgId: ORG, numero: 4, titulo: 'Semana 40', status: 'derivacao', rodadaId: 'r1', roteiro: '', midia: null,
    transcricao: [], transcricaoTexto: '', titulos: [], thumbs: [], descricao: '', bioPageId: null, criadoPor: PESSOA,
    criadoEm: new Date('2026-09-20T12:00:00.000Z'), atualizadoEm: new Date('2026-09-24T12:00:00.000Z'),
    rodada: { titulo: 'Semana 40', itens: ITENS, janelaIni: new Date('2026-09-17T00:00:00.000Z'), janelaFim: new Date('2026-09-24T00:00:00.000Z') },
    ...over,
  };
}

let seq = 0;
function peca(formato: 'carrossel' | 'story' | 'corte', itemN: number, over: Partial<Peca> & { episodioId?: string; metaExtra?: Record<string, unknown> } = {}): Peca {
  const { episodioId = 'e1', metaExtra = {}, ...resto } = over;
  return {
    id: `p${++seq}`, orgId: ORG, rodadaId: episodioId === 'e1' ? 'r1' : `r-${episodioId}`, canal: 'instagram', formato,
    titulo: `${formato} da matéria ${itemN}`, corpo: `Legenda do ${formato} ${itemN}`,
    meta: { episodioId, itemId: `c${itemN}`, itemN, formato, imagens: [], avisos: [], transcricaoSha: 'x', linkDaMateria: null, ...metaExtra },
    status: 'aprovada', criadaEm: new Date(Date.parse('2026-09-24T12:00:00.000Z') + seq * 1000), agendadaPara: null,
    publicadaEm: null, publicadaPor: null, externalId: null, urlPublicada: null, erro: null,
    ...resto,
  };
}

function casa(obj: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Array<Record<string, unknown>>).some((w) => casa(obj, w));
    const atual = obj[k];
    if (v === null) return atual === null || atual === undefined;
    if (v instanceof Date) return atual instanceof Date && atual.getTime() === v.getTime();
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('in' in o) return (o.in as unknown[]).includes(atual);
      if ('not' in o) return atual !== o.not;
      if (!(atual instanceof Date)) return false;
      if (o.gte instanceof Date && atual.getTime() < o.gte.getTime()) return false;
      if (o.lt instanceof Date && atual.getTime() >= o.lt.getTime()) return false;
      return true;
    }
    return atual === v;
  });
}

function servico(
  opts: {
    pecas?: Peca[];
    episodios?: Ep[];
    agora?: string;
    nota?: { id: string; body: string; versao: number; arquivadoEm: string | null } | null;
    publicacoes?: Array<Record<string, unknown> & { pecaId: string }>;
  } = {},
) {
  const lista = opts.episodios ?? [ep()];
  const pecas = opts.pecas ?? [];
  const auditoria: Array<Record<string, unknown>> = [];
  const travas: string[] = [];
  const memoriaChamadas: Array<{ metodo: string; args: unknown[] }> = [];
  let nota = opts.nota ?? null;

  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = lista.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? structuredClone(e) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(lista.filter((e) => casa(e as unknown as Record<string, unknown>, where))),
    },
    pautaPeca: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => structuredClone(pecas.filter((p) => casa(p, where))),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const p = pecas.find((x) => casa(x, where));
        return p ? structuredClone(p) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = pecas.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return structuredClone(p);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvo = pecas.filter((p) => casa(p, where));
        for (const p of alvo) Object.assign(p, data);
        return { count: alvo.length };
      },
    },
    $executeRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      travas.push(String(valores[0]));
      return partes.length;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
    // MD6: a agenda lê a publicação de cada peça.
    pautaPublicacao: {
      findMany: async ({ where }: { where: { pecaId: { in: string[] } } }) =>
        structuredClone((opts.publicacoes ?? []).filter((p) => where.pecaId.in.includes(p.pecaId))),
    },
  } as unknown as PrismaService;

  const memoria = {
    porChave: async (orgId: string, chave: string) => {
      memoriaChamadas.push({ metodo: 'porChave', args: [orgId, chave] });
      return nota ? { ...nota, chave } : null;
    },
    criar: async (orgId: string, e: { body: string; chave: string }) => {
      memoriaChamadas.push({ metodo: 'criar', args: [orgId, e] });
      nota = { id: 'n1', body: e.body, versao: 1, arquivadoEm: null };
      return nota;
    },
    alterar: async (orgId: string, id: string, m: { body: string; versaoEsperada?: number }) => {
      memoriaChamadas.push({ metodo: 'alterar', args: [orgId, id, m] });
      if (m.versaoEsperada !== undefined && m.versaoEsperada !== nota!.versao) throw new ConflictException('A nota mudou desde a leitura');
      nota = { ...nota!, body: m.body, versao: nota!.versao + 1 };
      return nota;
    },
    restaurar: async (orgId: string, id: string) => {
      memoriaChamadas.push({ metodo: 'restaurar', args: [orgId, id] });
      nota = { ...nota!, arquivadoEm: null };
      return nota;
    },
  } as unknown as MemoriaService;

  const audit = new AuditService(prisma);
  const agenda = new AgendaService(prisma, audit, memoria, new EpisodioService(prisma, audit));
  agenda.agora = () => new Date(opts.agora ?? '2026-09-27T12:00:00.000Z');
  return { agenda, prisma, pecas, lista, auditoria, travas, memoriaChamadas, nota: () => nota };
}

describe('agenda: distribuir o episódio', () => {
  it('as aprovadas e sem data vão para os próximos slots; rascunho, descartada e a já agendada ficam', async () => {
    const pecas = [
      peca('carrossel', 1), peca('story', 1), peca('corte', 1),
      peca('carrossel', 2, { status: 'rascunho' }), peca('story', 2, { status: 'descartada' }),
      peca('corte', 2, { agendadaPara: SP('2026-10-01', '18:00') }),
    ];
    const s = servico({ pecas });
    const r = await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(r.conta).toEqual({ alocadas: 3, jaAgendadas: 1, semVaga: 0 });
    const em = (i: number) => (s.pecas[i].agendadaPara ? `${diaNoFuso(s.pecas[i].agendadaPara!)} ${horaNoFuso(s.pecas[i].agendadaPara!)}` : null);
    expect(em(0)).toBe('2026-09-28 12:00');
    expect(em(1)).toBe('2026-09-28 09:00');
    expect(em(2)).toBe('2026-09-29 18:00');
    expect(em(3)).toBeNull();
    expect(em(4)).toBeNull();
    expect(em(5)).toBe('2026-10-01 18:00');
    expect(s.travas).toEqual([`pauta-agenda:${ORG}`]);
    const rastro = s.auditoria.find((a) => a.action === 'pauta.semana_distribuida')!;
    expect(rastro).toMatchObject({ orgId: ORG, actorId: PESSOA, entityId: 'e1', after: { jaAgendadas: 1, semVaga: 0 } });
    expect((rastro.after as { alocadas: unknown[] }).alocadas).toHaveLength(3);
    // O episódio não anda sozinho: ir para Agendado é passo do operador.
    expect(s.lista[0].status).toBe('derivacao');
  });

  it('não colide com a peça agendada de OUTRO episódio no mesmo slot', async () => {
    const outro = ep({ id: 'e2', numero: 3, rodadaId: 'r-e2' });
    const pecas = [peca('carrossel', 1), peca('carrossel', 1, { episodioId: 'e2', agendadaPara: SP('2026-09-28', '12:00') })];
    const s = servico({ pecas, episodios: [ep(), outro] });
    await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(s.pecas[0].agendadaPara?.toISOString()).toBe(iso('2026-09-30', '12:00'));
  });

  it('"a partir de" um dia à frente; um dia que já passou vale como agora', async () => {
    const s = servico({ pecas: [peca('carrossel', 1)] });
    await s.agenda.distribuir(ORG, 'e1', PESSOA, { aPartirDe: '2026-10-05' });
    expect(s.pecas[0].agendadaPara?.toISOString()).toBe(iso('2026-10-05', '12:00'));
    const t = servico({ pecas: [peca('carrossel', 1)], agora: '2026-09-28T16:00:00.000Z' });
    await t.agenda.distribuir(ORG, 'e1', PESSOA, { aPartirDe: '2026-09-01' });
    // Segunda às 13h em São Paulo: o slot de segunda 12h já passou.
    expect(t.pecas[0].agendadaPara?.toISOString()).toBe(iso('2026-09-30', '12:00'));
  });

  it('"a partir de" além do teto é 400 e nada é gravado; no teto, o slot fica dentro dos 90 dias', async () => {
    // Domingo 27/09/2026 às 9h em São Paulo: o teto é hoje + 62 dias.
    expect(PAUTA_TETO_DO_A_PARTIR_DE_DIAS).toBe(62);
    const s = servico({ pecas: [peca('carrossel', 1)] });
    await expect(s.agenda.distribuir(ORG, 'e1', PESSOA, { aPartirDe: '2099-01-05' })).rejects.toThrow(/vai até 28\/11\/2026/);
    await expect(s.agenda.distribuir(ORG, 'e1', PESSOA, { aPartirDe: '2026-11-29' })).rejects.toThrow(BadRequestException);
    expect(s.pecas[0].agendadaPara).toBeNull();
    expect(s.auditoria.some((a) => a.action === 'pauta.semana_distribuida')).toBe(false);
    await s.agenda.distribuir(ORG, 'e1', PESSOA, { aPartirDe: '2026-11-28' });
    // 28/11 é sábado: o próximo carrossel do padrão é segunda 30/11, dentro dos 90 dias.
    expect(s.pecas[0].agendadaPara?.toISOString()).toBe(iso('2026-11-30', '12:00'));
  });

  it('memória fora do ar no distribuir é 503: a grade que grava não cai para o padrão', async () => {
    const s = servico({ pecas: [peca('carrossel', 1)], nota: { id: 'n1', body: 'carrossel: sab 10h', versao: 1, arquivadoEm: null } });
    (s.agenda as unknown as { memoria: { porChave: () => Promise<never> } }).memoria.porChave = async () => {
      throw new Error('banco da memória fora');
    };
    await expect(s.agenda.distribuir(ORG, 'e1', PESSOA, {})).rejects.toThrow(ServiceUnavailableException);
    expect(s.pecas[0].agendadaPara).toBeNull();
    expect(s.travas).toEqual([]);
  });

  it('sem peça aprovada é 400; fora da Derivação/Agendado é 400; episódio de outra empresa é 404', async () => {
    await expect(servico({ pecas: [peca('carrossel', 1, { status: 'rascunho' })] }).agenda.distribuir(ORG, 'e1', PESSOA, {})).rejects.toThrow(/Nenhuma peça aprovada/);
    await expect(servico({ pecas: [peca('carrossel', 1)], episodios: [ep({ status: 'pacote' })] }).agenda.distribuir(ORG, 'e1', PESSOA, {})).rejects.toThrow(BadRequestException);
    await expect(servico().agenda.distribuir('outra-org', 'e1', PESSOA, {})).rejects.toThrow(NotFoundException);
  });

  it('a grade da empresa vale; a que não cabe no horizonte (4 semanas, com o 12/10 no meio) volta como aviso, sem data', async () => {
    const nota = { id: 'n1', body: 'carrossel: seg 12h', versao: 2, arquivadoEm: null };
    const pecas = [1, 2, 3, 4, 5].map((n) => peca('carrossel', n));
    const s = servico({ pecas, nota });
    const r = await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(r.conta).toEqual({ alocadas: 3, jaAgendadas: 0, semVaga: 2 });
    expect(r.avisos[0]).toMatch(/Carrossel da matéria 4: sem slot livre/);
    // O caminho que o aviso aponta existe na tela: distribuir de novo mais adiante, ou a grade.
    expect(r.avisos[0]).toMatch(/"a partir de" mais adiante/);
    expect(r.avisos[0]).not.toMatch(/à mão/);
    expect(s.pecas.slice(0, 3).map((p) => diaNoFuso(p.agendadaPara!))).toEqual(['2026-09-28', '2026-10-05', '2026-10-19']);
    expect(s.pecas.slice(3).map((p) => p.agendadaPara)).toEqual([null, null]);
  });
});

describe('agenda: reagendar', () => {
  it('muda o slot da peça aprovada, com o antes e o depois no RASTRO; nulo tira da agenda', async () => {
    const s = servico({ pecas: [peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00') })] });
    const r = await s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: '2026-09-29T19:30:00-03:00' });
    expect(r.agendadaPara).toBe('2026-09-29T22:30:00.000Z');
    expect(s.pecas[0].agendadaPara?.toISOString()).toBe('2026-09-29T22:30:00.000Z');
    expect(s.auditoria.at(-1)).toMatchObject({
      action: 'pauta.semana_reagendada',
      before: { agendadaPara: iso('2026-09-28', '12:00') },
      after: { agendadaPara: '2026-09-29T22:30:00.000Z' },
    });
    await s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: null });
    expect(s.pecas[0].agendadaPara).toBeNull();
  });

  it('o mesmo formato no mesmo minuto é 409; o passado e além de 90 dias são 400', async () => {
    const s = servico({ pecas: [peca('carrossel', 1), peca('carrossel', 2, { agendadaPara: SP('2026-09-30', '12:00') }), peca('story', 2, { agendadaPara: SP('2026-09-30', '12:00') })] });
    await expect(s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: iso('2026-09-30', '12:00') })).rejects.toThrow(ConflictException);
    await expect(s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: '2026-09-20T12:00:00-03:00' })).rejects.toThrow(/já passou/);
    await expect(s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: '2027-03-01T12:00:00-03:00' })).rejects.toThrow(/90 dias/);
    // Outro formato no mesmo minuto não colide.
    const st = servico({ pecas: [peca('story', 1), peca('carrossel', 2, { agendadaPara: SP('2026-09-30', '12:00') })] });
    await expect(st.agenda.reagendar(ORG, st.pecas[0].id, PESSOA, { agendadaPara: iso('2026-09-30', '12:00') })).resolves.toMatchObject({ agendadaPara: iso('2026-09-30', '12:00') });
  });

  it('rascunho e postada não se reagendam; peça que não é da semana é 404', async () => {
    const s = servico({ pecas: [peca('carrossel', 1, { status: 'rascunho' }), peca('corte', 1, { status: 'publicada', publicadaEm: new Date() })] });
    await expect(s.agenda.reagendar(ORG, s.pecas[0].id, PESSOA, { agendadaPara: iso('2026-09-30', '12:00') })).rejects.toThrow(/aprove antes/);
    await expect(s.agenda.reagendar(ORG, s.pecas[1].id, PESSOA, { agendadaPara: iso('2026-09-30', '18:00') })).rejects.toThrow(/já postada/);
    const antiga = servico({ pecas: [{ ...peca('carrossel', 1), meta: { slides: [] } }] });
    await expect(antiga.agenda.reagendar(ORG, antiga.pecas[0].id, PESSOA, { agendadaPara: null })).rejects.toThrow(NotFoundException);
  });
});

describe('agenda: marcar como postada (registro interno)', () => {
  it('a aprovada vira publicada à mão: quando, quem e o link; externalId fica nulo', async () => {
    const s = servico({ pecas: [peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00'), metaExtra: { imagens: [{ n: 1, chave: 'k' }] } })], agora: '2026-09-28T15:04:00.000Z' });
    const r = await s.agenda.marcarPostada(ORG, s.pecas[0].id, PESSOA, { url: 'https://www.instagram.com/p/abc/' });
    expect(s.pecas[0]).toMatchObject({ status: 'publicada', publicadaPor: PESSOA, urlPublicada: 'https://www.instagram.com/p/abc/', externalId: null });
    expect(s.pecas[0].publicadaEm?.toISOString()).toBe('2026-09-28T15:04:00.000Z');
    expect(r).toMatchObject({ status: 'publicada', postada: { manual: true, url: 'https://www.instagram.com/p/abc/' }, apelido: 'ep-04', materia: ITENS[0].titulo });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.semana_postada', before: { status: 'aprovada' }, after: { status: 'publicada', manual: true } });
  });

  it('sem link também vale; depois dá para acrescentar só o link, sem mudar a data', async () => {
    const s = servico({ pecas: [peca('story', 1)] });
    await s.agenda.marcarPostada(ORG, s.pecas[0].id, PESSOA, {});
    const quando = s.pecas[0].publicadaEm;
    expect(s.pecas[0]).toMatchObject({ status: 'publicada', urlPublicada: null });
    await expect(s.agenda.marcarPostada(ORG, s.pecas[0].id, PESSOA, {})).rejects.toThrow(/mande o link/);
    s.agenda.agora = () => new Date('2026-09-30T12:00:00.000Z');
    await s.agenda.marcarPostada(ORG, s.pecas[0].id, PESSOA, { url: 'https://www.instagram.com/stories/root/1/' });
    expect(s.pecas[0].urlPublicada).toBe('https://www.instagram.com/stories/root/1/');
    expect(s.pecas[0].publicadaEm).toEqual(quando);
  });

  it('rascunho é 400; a publicada pelo OS (com externalId) não se mexe daqui', async () => {
    const s = servico({ pecas: [peca('corte', 1, { status: 'rascunho' }), peca('corte', 2, { status: 'publicada', publicadaEm: new Date(), externalId: '1789' })] });
    await expect(s.agenda.marcarPostada(ORG, s.pecas[0].id, PESSOA, {})).rejects.toThrow(/aprove antes/);
    await expect(s.agenda.marcarPostada(ORG, s.pecas[1].id, PESSOA, { url: 'https://x.exemplo/p' })).rejects.toThrow(/publicada pelo OS/);
  });
});

describe('agenda: a semana na tela', () => {
  it('MD6: a peça traz a publicação pelo OS quando alguém pediu, e nulo quando não', async () => {
    const pecas = [peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00') }), peca('story', 2, { agendadaPara: SP('2026-09-28', '09:00') })];
    const s = servico({
      pecas,
      agora: '2026-09-28T12:00:00.000Z',
      publicacoes: [
        {
          id: 'pub1', pecaId: pecas[0].id, rede: 'instagram', estado: 'processando', externalId: null, permalink: null, erro: null,
          tentativas: 2, proximaEm: new Date('2026-09-28T15:01:00.000Z'), atualizadaEm: new Date('2026-09-28T15:00:00.000Z'),
        },
      ],
    });
    const a = await s.agenda.semana(ORG);
    const doDia = a.dias[0].linhas.map((l) => l.peca).filter(Boolean);
    expect(doDia.find((p) => p!.id === pecas[0].id)?.publicacao).toEqual({
      id: 'pub1', rede: 'instagram', estado: 'processando', externalId: null, permalink: null, erro: null, tentativas: 2,
      proximaEm: '2026-09-28T15:01:00.000Z', atualizadaEm: '2026-09-28T15:00:00.000Z',
    });
    expect(doDia.find((p) => p!.id === pecas[1].id)?.publicacao).toBeNull();
  });

  it('sete dias a partir da segunda, cada slot com a peça ou vago; fora da grade, postada e o que falta distribuir', async () => {
    const pecas = [
      peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00'), metaExtra: { imagens: [{ n: 1, chave: 'a' }, { n: 2, chave: 'b' }], palavraChave: 'PRECO' } }),
      peca('story', 2, { agendadaPara: SP('2026-09-28', '10:30') }),
      peca('corte', 1, { status: 'publicada', agendadaPara: SP('2026-09-29', '18:00'), publicadaEm: SP('2026-09-29', '18:05'), urlPublicada: 'https://www.instagram.com/reel/x/', metaExtra: { video: { arquivo: '/Users/p/ep-04-m1-corte.mp4' } } }),
      // Postada sem slot: aparece no dia em que foi ao ar.
      peca('story', 3, { status: 'publicada', publicadaEm: SP('2026-10-02', '08:00') }),
      peca('carrossel', 3, { agendadaPara: SP('2026-10-07', '12:00') }),
      peca('carrossel', 2),
    ];
    const s = servico({ pecas, agora: '2026-09-30T12:00:00.000Z' });
    const a = await s.agenda.semana(ORG);
    expect(a).toMatchObject({ de: '2026-09-28', ate: '2026-10-04', hoje: '2026-09-30', origemDaGrade: 'padrao', fuso: 'America/Sao_Paulo' });
    expect(a.dias.map((d) => d.diaDaSemana)).toEqual(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']);
    const seg = a.dias[0].linhas;
    expect(seg.map((l) => `${l.hora} ${l.formato} ${l.daGrade ? 'grade' : 'fora'} ${l.peca?.id ?? 'vago'}`)).toEqual([
      '09:00 story grade vago',
      `10:30 story fora ${pecas[1].id}`,
      `12:00 carrossel grade ${pecas[0].id}`,
    ]);
    expect(seg[2].peca).toMatchObject({ apelido: 'ep-04', itemN: 1, materia: ITENS[0].titulo, legenda: 'Legenda do carrossel 1', palavraChave: 'PRECO', midia: { onde: 'storage', imagens: [1, 2] } });
    const corte = a.dias[1].linhas.find((l) => l.formato === 'corte')!;
    expect(corte.peca).toMatchObject({ midia: { onde: 'mac', arquivo: '/Users/p/ep-04-m1-corte.mp4' }, postada: { manual: true, url: 'https://www.instagram.com/reel/x/' } });
    expect(a.dias[4].linhas.find((l) => l.peca)?.peca).toMatchObject({ id: pecas[3].id, agendadaPara: null, midia: { onde: 'nenhuma' } });
    expect(a.dias[5].linhas).toEqual([]);
    expect(JSON.stringify(a.dias)).not.toContain(pecas[4].id);
    expect(a.paraDistribuir).toEqual([{ episodioId: 'e1', apelido: 'ep-04', titulo: 'Semana 40', status: 'derivacao', aprovadasSemData: 1, motivo: null }]);
    expect(seg[2].peca?.motivoParaNaoAgendar).toBeNull();
  });

  it('a peça de episódio fora da Derivação/Agendado traz o motivo: a tela não oferece reagendar', async () => {
    const pecas = [peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00') })];
    const s = servico({ pecas, episodios: [ep({ status: 'concluido' })] });
    const a = await s.agenda.semana(ORG, '2026-09-28');
    const p = a.dias[0].linhas.find((l) => l.peca)?.peca;
    expect(p?.motivoParaNaoAgendar).toMatch(/Concluído/);
    await expect(s.agenda.reagendar(ORG, pecas[0].id, PESSOA, { agendadaPara: null })).rejects.toThrow(p!.motivoParaNaoAgendar!);
  });

  it('?de= com ano fora da faixa não chega ao serviço (400, não 500)', () => {
    const chamou: unknown[] = [];
    const c = new AgendaController({ semana: async (...args: unknown[]) => void chamou.push(args) } as unknown as AgendaService);
    expect(() => c.semana({ sub: PESSOA, orgId: ORG } as never, '9999-12-27')).toThrow(/2000 a 2100/);
    expect(chamou).toEqual([]);
  });

  it('feriado não abre slot, mas a peça posta nele aparece', async () => {
    const s = servico({ pecas: [peca('carrossel', 1, { agendadaPara: SP('2026-10-12', '12:00') })] });
    const a = await s.agenda.semana(ORG, '2026-10-12');
    expect(a.dias[0]).toMatchObject({ dia: '2026-10-12', feriado: 'Nossa Senhora Aparecida' });
    expect(a.dias[0].linhas).toHaveLength(1);
    expect(a.dias[0].linhas[0]).toMatchObject({ daGrade: false, peca: { id: s.pecas[0].id } });
    expect(a.dias[1].linhas.length).toBeGreaterThan(0);
  });
});

describe('agenda: a grade na memória (ADR-011)', () => {
  it('sem nota, o padrão em texto; salvar cria a nota pelo MemoriaService, normalizada', async () => {
    const s = servico();
    const g = await s.agenda.grade(ORG);
    expect(g).toMatchObject({ origem: 'padrao', versao: null });
    expect(g.texto).toContain('corte: ter, qui 18:00');
    const salvo = await s.agenda.salvarGrade(ORG, PESSOA, { texto: 'carrossel: seg-sex 12h\nferiados: 21/11/2026' });
    expect(s.memoriaChamadas.find((c) => c.metodo === 'criar')?.args[1]).toMatchObject({ chave: 'pauta.semana.grade', sourceType: 'operador', kind: 'definicao' });
    expect(salvo).toMatchObject({ origem: 'empresa', versao: 1 });
    expect(salvo.texto).toContain('carrossel: seg, ter, qua, qui, sex 12:00');
    expect(salvo.texto).toContain('feriados: 21/11/2026');
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.agenda_grade', after: { versao: 1, slots: 5, feriados: 1 } });
  });

  it('editar é versão nova conferindo a versão lida (409); linha ruim é 400 e nada é gravado', async () => {
    const s = servico({ nota: { id: 'n1', body: 'carrossel: seg 12h', versao: 3, arquivadoEm: null } });
    await expect(s.agenda.salvarGrade(ORG, PESSOA, { texto: 'carrossel: seg 12h\nreels: ter 9h' })).rejects.toThrow(/Linha 2/);
    await expect(s.agenda.salvarGrade(ORG, PESSOA, { texto: '# nada' })).rejects.toThrow(/pelo menos um slot/);
    await expect(s.agenda.salvarGrade(ORG, PESSOA, { texto: 'carrossel: ter 12h', versao: 2 })).rejects.toThrow(ConflictException);
    const ok = await s.agenda.salvarGrade(ORG, PESSOA, { texto: 'carrossel: ter 12h', versao: 3 });
    expect(ok).toMatchObject({ versao: 4, grade: { slots: [{ formato: 'carrossel', dia: 'ter', hora: '12:00' }] } });
    expect(s.memoriaChamadas.filter((c) => c.metodo === 'criar')).toHaveLength(0);
  });

  it('a nota arquivada volta a valer com a versão nova', async () => {
    const s = servico({ nota: { id: 'n1', body: 'carrossel: seg 12h', versao: 3, arquivadoEm: '2026-09-01T00:00:00.000Z' } });
    expect((await s.agenda.grade(ORG)).origem).toBe('padrao');
    await s.agenda.salvarGrade(ORG, PESSOA, { texto: 'carrossel: qua 12h' });
    expect(s.memoriaChamadas.map((c) => c.metodo)).toContain('restaurar');
    expect((await s.agenda.grade(ORG)).origem).toBe('empresa');
  });

  it('memória fora do ar não para a semana: vale o padrão', async () => {
    const s = servico();
    (s.agenda as unknown as { memoria: { porChave: () => Promise<never> } }).memoria.porChave = async () => {
      throw new Error('banco da memória fora');
    };
    const a = await s.agenda.semana(ORG);
    expect(a.origemDaGrade).toBe('padrao');
    expect(a.dias[0].linhas.length).toBeGreaterThan(0);
  });
});

describe('agenda: a peça que deixa de estar aprovada sai da agenda', () => {
  it('o PATCH de status (rascunho ou descartada) zera o slot; aprovar de novo não inventa um', async () => {
    const s = servico({ pecas: [peca('carrossel', 1, { agendadaPara: SP('2026-09-28', '12:00') }), peca('story', 1, { agendadaPara: SP('2026-09-28', '09:00') })] });
    const rotinas = new RotinaService(s.prisma, new AuditService(s.prisma), {} as never);
    await rotinas.editarPeca(ORG, s.pecas[0].id, PESSOA, { status: 'descartada' });
    expect(s.pecas[0]).toMatchObject({ status: 'descartada', agendadaPara: null });
    expect(s.auditoria.at(-1)).toMatchObject({ after: { status: 'descartada', saiuDaAgenda: true } });
    await rotinas.editarPeca(ORG, s.pecas[1].id, PESSOA, { status: 'aprovada' });
    expect(s.pecas[1].agendadaPara?.toISOString()).toBe(iso('2026-09-28', '09:00'));
    // A descartada aprovada de novo volta SEM data: o slot antigo não é recriado.
    await rotinas.editarPeca(ORG, s.pecas[0].id, PESSOA, { status: 'aprovada' });
    expect(s.pecas[0]).toMatchObject({ status: 'aprovada', agendadaPara: null });
    const a = await s.agenda.semana(ORG, '2026-09-28');
    expect(a.paraDistribuir).toEqual([expect.objectContaining({ episodioId: 'e1', aprovadasSemData: 1 })]);
    expect(a.dias[0].linhas.find((l) => l.formato === 'carrossel')?.peca).toBeNull();
  });
});

describe('agenda: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  it('os esquemas chegam antes do serviço; as rotas e as permissões — postada pede pauta.publicar', async () => {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => void chamadas.push({ metodo, args });
    const duble = {
      semana: anota('semana'), grade: anota('grade'), salvarGrade: anota('salvarGrade'),
      distribuir: anota('distribuir'), reagendar: anota('reagendar'), marcarPostada: anota('marcarPostada'),
    } as unknown as AgendaService;
    const c = new AgendaController(duble);
    await c.semana(usuario, undefined);
    await c.semana(usuario, '2026-09-28');
    await c.distribuir(usuario, 'e1', undefined);
    await c.postada(usuario, 'p1', { url: 'https://www.instagram.com/p/x/' });
    expect(chamadas).toEqual([
      { metodo: 'semana', args: [ORG, undefined] },
      { metodo: 'semana', args: [ORG, '2026-09-28'] },
      { metodo: 'distribuir', args: [ORG, 'e1', PESSOA, {}] },
      { metodo: 'marcarPostada', args: [ORG, 'p1', PESSOA, { url: 'https://www.instagram.com/p/x/' }] },
    ]);
    expect(() => c.semana(usuario, '28/09/2026')).toThrow();
    expect(() => c.reagendar(usuario, 'p1', { agendadaPara: 'amanhã' })).toThrow();
    expect(() => c.postada(usuario, 'p1', { url: 'http://x' })).toThrow();
    expect(() => c.salvarGrade(usuario, { texto: 'x', slots: [] })).toThrow();
    expect(chamadas).toHaveLength(4);

    expect(Reflect.getMetadata('path', AgendaController)).toBe('pauta');
    const proto = AgendaController.prototype as unknown as Record<string, object>;
    const rotas: Array<[string, string, string[]]> = [
      ['semana', 'agenda', ['pauta.ver']],
      ['grade', 'agenda/grade', ['pauta.ver']],
      ['salvarGrade', 'agenda/grade', ['pauta.editar']],
      ['distribuir', 'episodios/:id/agenda/distribuir', ['pauta.editar']],
      ['reagendar', 'pecas/:id/agenda', ['pauta.editar']],
      ['postada', 'pecas/:id/postada', ['pauta.publicar']],
    ];
    for (const [metodo, caminho, perms] of rotas) {
      expect(Reflect.getMetadata('path', proto[metodo]), metodo).toBe(caminho);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[metodo]), metodo).toEqual(perms);
    }
    const metodos = Object.getOwnPropertyNames(AgendaController.prototype).filter((m) => m !== 'constructor');
    expect(metodos.sort()).toEqual(rotas.map(([m]) => m).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada, um episódio e peças)');

const MARCA = `ag${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('agenda com banco: distribuir, reagendar e postar pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let agenda: AgendaService;
  let episodios: EpisodioService;
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    episodios = new EpisodioService(app, new AuditService(app));
    agenda = new AgendaService(app, new AuditService(app), new MemoriaService(app, {} as never), episodios);
    // Domingo, 06/01/2030: a distribuição começa na segunda 07/01.
    agenda.agora = () => new Date('2030-01-06T12:00:00.000Z');
    const o = await admin.org.create({ data: { name: `Agenda ${MARCA}`, slug: `ag-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaPeca.deleteMany({ where: { orgId } });
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('as aprovadas ganham slot no banco, uma muda de horário, outra é postada, e a semana mostra tudo', async () => {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: ITENS as never },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
    await admin.pautaEpisodio.update({ where: { id: e.id }, data: { status: 'derivacao' } });
    const criar = (formato: string, itemN: number, status: 'aprovada' | 'rascunho') =>
      admin.pautaPeca.create({
        data: {
          orgId, rodadaId: rodada.id, canal: 'instagram', formato, titulo: `${formato} ${itemN}`, corpo: `Legenda ${itemN}`, status,
          meta: { episodioId: e.id, itemId: `c${itemN}`, itemN, formato, imagens: [], avisos: [], transcricaoSha: 'x' },
        },
      });
    const car = await criar('carrossel', 1, 'aprovada');
    const cor = await criar('corte', 1, 'aprovada');
    const rasc = await criar('story', 1, 'rascunho');

    const r = await na(() => agenda.distribuir(orgId, e.id, 'pessoa', {}));
    expect(r.conta).toEqual({ alocadas: 2, jaAgendadas: 0, semVaga: 0 });
    const lidas = await admin.pautaPeca.findMany({ where: { orgId }, orderBy: { criadaEm: 'asc' } });
    expect(lidas.find((p) => p.id === car.id)?.agendadaPara?.toISOString()).toBe('2030-01-07T15:00:00.000Z');
    expect(lidas.find((p) => p.id === cor.id)?.agendadaPara?.toISOString()).toBe('2030-01-08T21:00:00.000Z');
    expect(lidas.find((p) => p.id === rasc.id)?.agendadaPara).toBeNull();

    await na(() => agenda.reagendar(orgId, car.id, 'pessoa', { agendadaPara: '2030-01-09T12:00:00-03:00' }));
    await na(() => agenda.marcarPostada(orgId, cor.id, 'pessoa', { url: 'https://www.instagram.com/reel/abc/' }));
    const postada = await admin.pautaPeca.findUnique({ where: { id: cor.id } });
    expect(postada).toMatchObject({ status: 'publicada', publicadaPor: 'pessoa', urlPublicada: 'https://www.instagram.com/reel/abc/', externalId: null });

    const semana = await na(() => agenda.semana(orgId, '2030-01-07'));
    const quarta = semana.dias.find((d) => d.dia === '2030-01-09')!;
    expect(quarta.linhas.find((l) => l.formato === 'carrossel')?.peca?.id).toBe(car.id);
    const terca = semana.dias.find((d) => d.dia === '2030-01-08')!;
    expect(terca.linhas.find((l) => l.formato === 'corte')?.peca).toMatchObject({ id: cor.id, postada: { manual: true } });

    const acoes = (await admin.auditLog.findMany({ where: { orgId }, select: { action: true } })).map((a) => a.action);
    expect(acoes).toEqual(expect.arrayContaining(['pauta.semana_distribuida', 'pauta.semana_reagendada', 'pauta.semana_postada']));
  }, 60_000);
});
