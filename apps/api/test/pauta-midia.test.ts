import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  PAUTA_EPISODIO_STATUS,
  PAUTA_STATUS_PENDENTES_DE_MIDIA,
  PAUTA_TETO_DA_TRANSCRICAO,
  PAUTA_TETO_DE_SEGMENTOS,
  PautaMidiaSchema,
  PautaTranscricaoSchema,
  midiaDoEpisodio,
  tempoDoVideo,
  textoDaTranscricao,
  type PautaEpisodioStatus,
} from '@mktos/shared';

import {
  ehPendenteDeMidia,
  motivoParaNaoReceberMidia,
  motivoParaNaoReceberTranscricao,
  nomeDoArquivo,
  pendenteDeMidia,
  resumoDaMidia,
  transcricaoForaDoVideo,
} from '../src/pauta/midia-do-episodio';
import { MidiaService } from '../src/pauta/midia.service';
import { shaDaTranscricao } from '../src/pauta/newsletter-do-episodio';
import { MidiaController } from '../src/pauta/midia.controller';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { EpisodioService } from '../src/pauta/episodio.service';
import { AuditService } from '../src/audit/audit.service';
import type { RoteiroService } from '../src/pauta/roteiro.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A ESTAÇÃO DE MÍDIA NO MAC — MC9, o lado do OS.
 *
 * O Mac edita e transcreve; o OS recebe só o leve. Cinco camadas:
 *   1. a parte pura: quem recebe mídia e transcrição em que status, a
 *      transcrição que passa do fim do vídeo (é a do bruto), o resumo que vai
 *      ao RASTRO sem a pasta do Mac, e a linha da fila;
 *   2. os contratos: os esquemas da mídia e da transcrição, com a ordem, os
 *      tempos e os tetos conferidos;
 *   3. o `MidiaService` DE VERDADE com um prisma de mentira: a fila, a mídia
 *      levando à edição (e descartando a transcrição velha), a transcrição
 *      levando ao pacote, as recusas e a corrida entre dois envios;
 *   4. o controller montado à mão e a ORDEM dos controllers no módulo
 *      (`pendentes-midia` antes do `:id` do episódio);
 *   5. com banco: do gravado ao pacote pela sessão da empresa, com o RASTRO.
 * As funções do Mac (silêncio, palavra de corte, whisper) estão em
 * `root-midia.test.ts`.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc09';
const OUTRA = '7c0f0a8e-4444-4a5a-9c1e-0000000outra';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000009';
const RODADA = '3f1e2d3c-0000-4000-8000-0000000000b1';

const MIDIA = {
  arquivoBruto: '/Users/pedro/Movies/OBS/2026-09-24 20-00-00.mp4',
  arquivoFinal: '/Users/pedro/Movies/OBS/ep-03-final.mp4',
  duracaoSeg: 540.5,
  duracaoBrutoSeg: 610,
  cortes: [
    { inicio: 0, fim: 4.2, motivo: 'silencio' as const },
    { inicio: 100, fim: 160, motivo: 'palavra-de-corte' as const },
    { inicio: 300, fim: 305.3, motivo: 'silencio' as const },
  ],
  palavraDeCorte: 'root, corta',
  editor: 'ffmpeg' as const,
};

const SEGMENTOS = [
  { inicio: 0, fim: 4.5, texto: 'Bom dia, esta é a semana 39.' },
  { inicio: 4.5, fim: 9, texto: 'A primeira notícia é sobre o Pix automático.' },
  { inicio: 9, fim: 540, texto: 'E fecha em alta.' },
];

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('mídia: quem recebe o quê', () => {
  it('a fila do Mac é gravação e edição, e só elas', () => {
    expect(PAUTA_STATUS_PENDENTES_DE_MIDIA).toEqual(['gravacao', 'edicao']);
    expect(PAUTA_EPISODIO_STATUS.filter(ehPendenteDeMidia)).toEqual(['gravacao', 'edicao']);
  });

  it('a mídia entra na gravação e na edição; no roteiro pede para gravar; depois da edição, para voltar o status', () => {
    expect(motivoParaNaoReceberMidia('gravacao')).toBeNull();
    expect(motivoParaNaoReceberMidia('edicao')).toBeNull();
    expect(motivoParaNaoReceberMidia('roteiro')).toMatch(/grave antes/);
    for (const s of ['pacote', 'derivacao', 'agendado', 'concluido'] as const) {
      expect(motivoParaNaoReceberMidia(s)).toMatch(/Volte o status até Edição/);
    }
  });

  it('a transcrição só entra na edição e com a mídia já lá', () => {
    const midia = { ...MIDIA, recebidaEm: '2026-09-24T23:00:00.000Z' };
    expect(motivoParaNaoReceberTranscricao('edicao', midia)).toBeNull();
    expect(motivoParaNaoReceberTranscricao('edicao', null)).toMatch(/a mídia não chegou/);
    expect(motivoParaNaoReceberTranscricao('gravacao', null)).toMatch(/Mande a mídia antes/);
    expect(motivoParaNaoReceberTranscricao('roteiro', null)).toMatch(/não há vídeo/);
    expect(motivoParaNaoReceberTranscricao('pacote', midia)).toMatch(/Volte o status até Edição/);
  });

  it('a transcrição que passa do fim do vídeo final é a do bruto — recusada com o porquê', () => {
    expect(transcricaoForaDoVideo(SEGMENTOS, 540.5)).toBeNull();
    expect(transcricaoForaDoVideo([{ inicio: 0, fim: 541.9, texto: 'x' }], 540.5)).toBeNull();
    expect(transcricaoForaDoVideo([{ inicio: 0, fim: 610, texto: 'x' }], 540.5)).toBe(
      'A transcrição vai até 10:10, mas o vídeo final tem 9:00. Transcreva o arquivo FINAL (a do bruto tem os tempos de antes dos cortes).',
    );
  });

  it('o RASTRO leva o nome do arquivo, não a pasta do Mac, e a conta dos cortes por motivo', () => {
    expect(nomeDoArquivo('/Users/pedro/Movies/OBS/a b.mp4')).toBe('a b.mp4');
    expect(nomeDoArquivo('C:\\videos\\x.mp4')).toBe('x.mp4');
    const r = resumoDaMidia(PautaMidiaSchema.parse(MIDIA));
    expect(r).toEqual({
      arquivoBruto: '2026-09-24 20-00-00.mp4',
      arquivoFinal: 'ep-03-final.mp4',
      duracaoSeg: 540.5,
      duracaoBrutoSeg: 610,
      cortes: 3,
      porMotivo: { silencio: 2, 'palavra-de-corte': 1 },
      removidoSeg: 69.5,
      palavraDeCorte: 'root, corta',
      editor: 'ffmpeg',
    });
    expect(JSON.stringify(r)).not.toContain('/Users/');
  });

  it('a linha da fila diz o que falta e a palavra que vale (episódio > empresa > padrão)', () => {
    const base = { id: 'e1', numero: 3, titulo: 'Semana 39', palavraDeCorte: null, atualizadoEm: new Date('2026-09-24T10:00:00Z') };
    expect(pendenteDeMidia({ ...base, status: 'gravacao', midia: {} }, null)).toEqual({
      id: 'e1', numero: 3, apelido: 'ep-03', titulo: 'Semana 39', status: 'gravacao',
      palavraDeCorte: 'root, corta', falta: 'midia', arquivoFinal: null, atualizadoEm: '2026-09-24T10:00:00.000Z',
    });
    const comMidia = { ...MIDIA, recebidaEm: '2026-09-24T11:00:00.000Z' };
    const edicao = pendenteDeMidia({ ...base, status: 'edicao', midia: comMidia }, 'ops');
    expect(edicao).toMatchObject({ falta: 'transcricao', palavraDeCorte: 'ops', arquivoFinal: MIDIA.arquivoFinal });
    expect(pendenteDeMidia({ ...base, status: 'edicao', midia: {}, palavraDeCorte: 'do ep' }, 'ops')).toMatchObject({
      falta: 'midia',
      palavraDeCorte: 'do ep',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('mídia: o esquema da mídia', () => {
  it('aceita o que o Mac manda, com os padrões de editor, cortes e palavra', () => {
    expect(PautaMidiaSchema.parse(MIDIA)).toEqual(MIDIA);
    expect(PautaMidiaSchema.parse({ arquivoBruto: 'b.mp4', arquivoFinal: 'f.mp4', duracaoSeg: 10 })).toEqual({
      arquivoBruto: 'b.mp4', arquivoFinal: 'f.mp4', duracaoSeg: 10, cortes: [], palavraDeCorte: null, editor: 'ffmpeg',
    });
  });

  it('corte fora de ordem, sobreposto ou invertido é recusado, com o número do corte', () => {
    const fora = PautaMidiaSchema.safeParse({ ...MIDIA, cortes: [MIDIA.cortes[1], MIDIA.cortes[0]] });
    expect(fora.success).toBe(false);
    expect(fora.error?.issues[0]).toMatchObject({ path: ['cortes', 1, 'inicio'], message: expect.stringContaining('corte 2') });
    const sobreposto = [{ inicio: 0, fim: 5, motivo: 'silencio' }, { inicio: 4, fim: 6, motivo: 'silencio' }];
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, cortes: sobreposto }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, cortes: [{ inicio: 5, fim: 5, motivo: 'silencio' }] }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, cortes: [{ inicio: 1, fim: 2, motivo: 'tesoura' }] }).success).toBe(false);
  });

  it('o corte que passa do bruto e o final mais longo que o bruto são recusados', () => {
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, cortes: [{ inicio: 600, fim: 700, motivo: 'silencio' }] }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, duracaoSeg: 700 }).success).toBe(false);
  });

  it('caminho com quebra de linha, vazio ou longo, e duração zero, negativa ou absurda são recusados', () => {
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, arquivoFinal: 'a.mp4\n# injeção' }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, arquivoFinal: '   ' }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, arquivoFinal: `/${'x'.repeat(500)}` }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, duracaoSeg: 0 }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, duracaoSeg: -1 }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, duracaoSeg: 5 * 3600, duracaoBrutoSeg: undefined }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, duracaoSeg: Number.NaN }).success).toBe(false);
  });

  it('a mídia guardada volta tipada; vazia, de antes do MC9 ou sem data de chegada volta nula', () => {
    const guardada = { ...PautaMidiaSchema.parse(MIDIA), recebidaEm: '2026-09-24T23:00:00.000Z' };
    expect(midiaDoEpisodio(guardada)).toEqual(guardada);
    expect(midiaDoEpisodio({})).toBeNull();
    expect(midiaDoEpisodio([])).toBeNull();
    expect(midiaDoEpisodio({ ...MIDIA })).toBeNull();
    expect(midiaDoEpisodio({ arquivoFinal: 'x', recebidaEm: 'agora' })).toBeNull();
  });
});

describe('mídia: o esquema da transcrição', () => {
  it('aceita segmentos em ordem, aparando o texto; segmento de duração zero vale', () => {
    const t = PautaTranscricaoSchema.parse({
      segmentos: [...SEGMENTOS, { inicio: 540, fim: 540, texto: '  tchau  ' }],
      idioma: 'pt',
      modelo: 'ggml-large-v3-turbo.bin',
    });
    expect(t.segmentos[3]).toEqual({ inicio: 540, fim: 540, texto: 'tchau' });
  });

  it('fora de ordem, sobreposto além de 10 ms ou terminando antes de começar é recusado', () => {
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [SEGMENTOS[1], SEGMENTOS[0]] }).success).toBe(false);
    expect(
      PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 2, texto: 'a' }, { inicio: 1.5, fim: 3, texto: 'b' }] }).success,
    ).toBe(false);
    expect(
      PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 2, texto: 'a' }, { inicio: 1.995, fim: 3, texto: 'b' }] }).success,
    ).toBe(true);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 3, fim: 2, texto: 'a' }] }).success).toBe(false);
  });

  it('sem segmento, segmento sem texto, texto longo e tempo negativo são recusados', () => {
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [] }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({}).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 1, texto: '   ' }] }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 1, texto: 'x'.repeat(2001) }] }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: -1, fim: 1, texto: 'x' }] }).success).toBe(false);
  });

  it('caractere de controle no idioma, no modelo, no texto e na palavra é 400 — o NUL viraria 500 no Postgres', () => {
    const ok = { segmentos: [{ inicio: 0, fim: 1, texto: 'linha um\n\tlinha dois' }], idioma: 'pt', modelo: 'ggml-small.bin' };
    expect(PautaTranscricaoSchema.safeParse(ok).success).toBe(true);
    expect(PautaTranscricaoSchema.safeParse({ ...ok, modelo: 'ggml\u0000x' }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ ...ok, idioma: 'p\u0000t' }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ ...ok, idioma: 'pt\nx' }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 1, texto: 'a\u0000b' }] }).success).toBe(false);
    expect(PautaTranscricaoSchema.safeParse({ segmentos: [{ inicio: 0, fim: 1, texto: 'a\u001bb' }] }).success).toBe(false);
    expect(PautaMidiaSchema.safeParse({ ...MIDIA, palavraDeCorte: 'root\u0000corta' }).success).toBe(false);
  });

  it('os tetos: segmentos demais e texto total demais são recusados', () => {
    const muitos = Array.from({ length: PAUTA_TETO_DE_SEGMENTOS + 1 }, (_, i) => ({ inicio: i, fim: i + 1, texto: 'a' }));
    expect(PautaTranscricaoSchema.safeParse({ segmentos: muitos }).success).toBe(false);
    const n = Math.ceil(PAUTA_TETO_DA_TRANSCRICAO / 2000) + 1;
    const longos = Array.from({ length: n }, (_, i) => ({ inicio: i, fim: i + 1, texto: 'y'.repeat(2000) }));
    const r = PautaTranscricaoSchema.safeParse({ segmentos: longos });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/o teto é/);
  });

  it('o texto corrido junta os segmentos com um espaço; o tempo sai como o vídeo mostra', () => {
    expect(textoDaTranscricao([{ texto: ' Bom  dia. ' }, { texto: '' }, { texto: 'Semana\n39.' }])).toBe('Bom dia. Semana 39.');
    expect(tempoDoVideo(0)).toBe('0:00');
    expect(tempoDoVideo(65.9)).toBe('1:05');
    expect(tempoDoVideo(3723)).toBe('1:02:03');
    expect(tempoDoVideo(Number.NaN)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------
// 3. O serviço com um prisma de mentira
// ---------------------------------------------------------------------------

type Ep = {
  id: string; orgId: string; rodadaId: string; numero: number; titulo: string; status: PautaEpisodioStatus;
  roteiro: string; palavraDeCorte: string | null; descricao: string; midia: unknown; transcricao: unknown;
  transcricaoTexto: string; titulos: unknown; thumbs: unknown; bioPageId: string | null; criadoPor: string | null;
  criadoEm: Date; atualizadoEm: Date;
};

function ep(over: Partial<Ep> = {}): Ep {
  const t = new Date('2026-09-24T12:00:00.000Z');
  return {
    id: 'e1', orgId: ORG, rodadaId: RODADA, numero: 3, titulo: 'Semana 39', status: 'gravacao', roteiro: '# ep-03',
    palavraDeCorte: null, descricao: '', midia: {}, transcricao: [], transcricaoTexto: '', titulos: [], thumbs: [],
    bioPageId: null, criadoPor: PESSOA, criadoEm: t, atualizadoEm: t, ...over,
  };
}

type PecaFalsa = { id: string; orgId: string; rodadaId: string; canal: string; formato: string; status: string; meta: Record<string, unknown>; agendadaPara: Date | null };

function servico(opts: { episodios?: Ep[]; daEmpresa?: string | null; antesDeGravar?: (lista: Ep[]) => void; pecas?: PecaFalsa[] } = {}) {
  const lista = opts.episodios ?? [ep()];
  const pecas = opts.pecas ?? [];
  const travas: string[] = [];
  const rodada = { titulo: 'Semana 39', itens: [{ titulo: 'A', url: 'https://a.exemplo' }], janelaIni: new Date(), janelaFim: new Date() };
  const auditoria: Array<Record<string, unknown>> = [];
  const condicionais: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const listagens: Array<Record<string, unknown>> = [];
  const leiturasDaMemoria: string[] = [];
  let relogio = Date.parse('2026-09-24T12:00:00.000Z');

  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = lista.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? { ...e, rodada } : null;
      },
      findMany: async (args: { where: { orgId: string; status: { in: string[] } } }) => {
        listagens.push(args);
        return lista.filter((e) => e.orgId === args.where.orgId && args.where.status.in.includes(e.status));
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        condicionais.push({ where, data });
        opts.antesDeGravar?.(lista);
        const alvo = lista.filter((e) =>
          Object.entries(where).every(([k, v]) => {
            const atual = (e as Record<string, unknown>)[k];
            return v instanceof Date && atual instanceof Date ? v.getTime() === atual.getTime() : atual === v;
          }),
        );
        for (const e of alvo) Object.assign(e, data, { atualizadoEm: new Date((relogio += 1000)) });
        return { count: alvo.length };
      },
    },
    pautaPeca: {
      findMany: async ({ where }: { where: { orgId: string; rodadaId: string; canal: string; formato: { in: string[] }; status: { in: string[] } } }) =>
        structuredClone(
          pecas.filter(
            (p) =>
              p.orgId === where.orgId &&
              p.rodadaId === where.rodadaId &&
              p.canal === where.canal &&
              where.formato.in.includes(p.formato) &&
              where.status.in.includes(p.status),
          ),
        ),
      updateMany: async ({ where, data }: { where: { id: string; orgId: string; status: string }; data: Partial<PecaFalsa> }) => {
        const alvo = pecas.filter((p) => p.id === where.id && p.orgId === where.orgId && p.status === where.status);
        for (const p of alvo) Object.assign(p, structuredClone(data));
        return { count: alvo.length };
      },
    },
    $executeRaw: async (_partes: TemplateStringsArray, ...valores: unknown[]) => {
      travas.push(String(valores[0]));
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  const roteiros = {
    palavraDaEmpresa: async (orgId: string) => {
      leiturasDaMemoria.push(orgId);
      return opts.daEmpresa ?? null;
    },
  } as unknown as RoteiroService;

  const audit = new AuditService(prisma);
  return {
    midia: new MidiaService(prisma, audit, new EpisodioService(prisma, audit), roteiros),
    lista,
    pecas,
    travas,
    auditoria,
    condicionais,
    listagens,
    leiturasDaMemoria,
  };
}

describe('mídia: a fila do Mac', () => {
  it('pede gravação e edição da empresa, do mais antigo, no teto de 50, com a palavra que vale', async () => {
    const s = servico({
      episodios: [
        ep({ id: 'e1', numero: 3 }),
        ep({ id: 'e2', numero: 4, status: 'edicao', midia: { ...MIDIA, recebidaEm: '2026-09-24T13:00:00.000Z' }, palavraDeCorte: 'ops' }),
        ep({ id: 'e3', numero: 5, status: 'roteiro' }),
        ep({ id: 'e4', numero: 2, status: 'pacote' }),
        ep({ id: 'x', orgId: OUTRA, numero: 1 }),
      ],
      daEmpresa: 'da casa',
    });
    const r = await s.midia.pendentes(ORG);
    expect(s.listagens[0]).toMatchObject({
      where: { orgId: ORG, status: { in: ['gravacao', 'edicao'] } },
      orderBy: { numero: 'asc' },
      take: 50,
    });
    expect(r.items.map((e) => [e.apelido, e.falta, e.palavraDeCorte])).toEqual([
      ['ep-03', 'midia', 'da casa'],
      ['ep-04', 'transcricao', 'ops'],
    ]);
    expect(s.leiturasDaMemoria).toEqual([ORG]);
    expect(r.source.tool).toBe('banco-interno');
  });

  it('fila vazia não lê a memória', async () => {
    const s = servico({ episodios: [ep({ status: 'pacote' })] });
    expect((await s.midia.pendentes(ORG)).items).toEqual([]);
    expect(s.leiturasDaMemoria).toEqual([]);
  });
});

describe('mídia: registrar a mídia editada', () => {
  it('da gravação vai para a edição, com escrita condicionada ao status e à versão lidos, e audita o resumo', async () => {
    const s = servico();
    const d = await s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse(MIDIA));
    expect(d.status).toBe('edicao');
    expect(d.midia).toMatchObject({ arquivoFinal: MIDIA.arquivoFinal, duracaoSeg: 540.5, recebidaEm: expect.any(String) });
    expect(s.condicionais[0].where).toEqual({ id: 'e1', orgId: ORG, status: 'gravacao', atualizadoEm: new Date('2026-09-24T12:00:00.000Z') });
    expect(s.auditoria[0]).toMatchObject({
      orgId: ORG,
      actorId: PESSOA,
      action: 'pauta.episodio_midia',
      entityType: 'pauta_episodio',
      entityId: 'e1',
      before: { status: 'gravacao', tinhaMidia: false },
      after: { status: 'edicao', arquivoFinal: 'ep-03-final.mp4', cortes: 3, removidoSeg: 69.5, transcricaoDescartada: false, pacoteDescartado: false },
    });
  });

  it('na edição substitui a mídia de antes e descarta a transcrição, que era do vídeo anterior', async () => {
    const s = servico({
      episodios: [ep({ status: 'edicao', midia: { ...MIDIA, recebidaEm: 'ontem' }, transcricao: SEGMENTOS, transcricaoTexto: 'velho' })],
    });
    const d = await s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse({ ...MIDIA, duracaoSeg: 500 }));
    expect(d.status).toBe('edicao');
    expect(d.transcricao).toEqual([]);
    expect(d.transcricaoTexto).toBe('');
    expect(d.midia).toMatchObject({ duracaoSeg: 500 });
    expect(s.auditoria[0]).toMatchObject({ after: { transcricaoDescartada: true } });
  });

  it('descarta também o pacote do YouTube, cujos capítulos e frames eram do vídeo anterior', async () => {
    const s = servico({
      episodios: [
        ep({
          status: 'edicao',
          midia: { ...MIDIA, recebidaEm: 'ontem' },
          transcricao: SEGMENTOS,
          titulos: [{ texto: 'Título velho do corte antigo', angulo: 'a', escolhido: true }],
          descricao: 'Capítulos\n00:00 Abertura\n00:31 Velho',
          thumbs: [{ n: 1, texto: 'Frame velho', destaque: 'velho', tempoSeg: 31, imagem: null }],
        }),
      ],
    });
    const d = await s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse({ ...MIDIA, duracaoSeg: 500 }));
    expect(d.titulos).toEqual([]);
    expect(d.descricao).toBe('');
    expect(d.thumbs).toEqual([]);
    expect(s.condicionais[0].data).toMatchObject({ titulos: [], descricao: '', thumbs: [] });
    expect(s.auditoria[0]).toMatchObject({ after: { transcricaoDescartada: true, pacoteDescartado: true } });
  });

  it('no roteiro e depois da edição é 400 sem escrever', async () => {
    for (const status of ['roteiro', 'pacote', 'concluido'] as const) {
      const s = servico({ episodios: [ep({ status })] });
      await expect(s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse(MIDIA))).rejects.toBeInstanceOf(BadRequestException);
      expect(s.condicionais).toEqual([]);
      expect(s.auditoria).toEqual([]);
    }
  });

  it('episódio de outra empresa é 404', async () => {
    const s = servico();
    await expect(s.midia.registrarMidia(OUTRA, 'e1', PESSOA, PautaMidiaSchema.parse(MIDIA))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mudou entre a leitura e a escrita (outro envio, outra aba): 409 e nada auditado', async () => {
    const s = servico({ antesDeGravar: (l) => (l[0].atualizadoEm = new Date('2026-09-24T12:30:00.000Z')) });
    await expect(s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse(MIDIA))).rejects.toBeInstanceOf(ConflictException);
    expect(s.lista[0].status).toBe('gravacao');
    expect(s.auditoria).toEqual([]);
  });
});

describe('mídia refeita: as peças da semana voltam ao rascunho', () => {
  const SHA_VELHO = shaDaTranscricao(SEGMENTOS);
  const peca = (over: Partial<PecaFalsa> & { id: string }): PecaFalsa => {
    const p = base(over);
    return { ...p, meta: { formato: p.formato, ...p.meta } };
  };
  const base = (over: Partial<PecaFalsa> & { id: string }): PecaFalsa => ({
    orgId: ORG,
    rodadaId: RODADA,
    canal: 'instagram',
    formato: 'corte',
    status: 'aprovada',
    agendadaPara: new Date('2026-09-29T21:00:00.000Z'),
    meta: {
      episodioId: 'e1',
      itemId: 'c2',
      transcricaoSha: SHA_VELHO,
      inicio: 312,
      fim: 371,
      imagens: [{ n: 1, chave: 'k' }],
      video: { arquivo: '/Users/p/ep-03-m2-corte.mp4', duracaoSeg: 59, bytes: 1 },
    },
    ...over,
  });

  it('a mídia nova tira da agenda e do render toda peça não postada do episódio, na mesma transação e sob o cadeado da semana', async () => {
    const s = servico({
      episodios: [ep({ status: 'edicao', midia: { ...MIDIA, recebidaEm: 'ontem' }, transcricao: SEGMENTOS })],
      pecas: [
        peca({ id: 'corte' }),
        peca({ id: 'story', formato: 'story', status: 'rascunho' }),
        peca({ id: 'postada', formato: 'carrossel', status: 'publicada' }),
        peca({ id: 'outro-ep', meta: { episodioId: 'e9', itemId: 'c2', transcricaoSha: SHA_VELHO, imagens: [], video: null } }),
        peca({ id: 'antiga', meta: { canal: 'derivacao-antiga' } }),
      ],
    });
    await s.midia.registrarMidia(ORG, 'e1', PESSOA, PautaMidiaSchema.parse({ ...MIDIA, duracaoSeg: 500 }));

    const por = (id: string) => s.pecas.find((p) => p.id === id)!;
    for (const id of ['corte', 'story']) {
      expect(por(id)).toMatchObject({ status: 'rascunho', agendadaPara: null, meta: { imagens: [], video: null, inicio: 312, transcricaoSha: SHA_VELHO } });
    }
    expect(por('postada').status).toBe('publicada');
    expect(por('outro-ep')).toMatchObject({ status: 'aprovada', meta: { video: null } });
    expect(por('outro-ep').agendadaPara).not.toBeNull();
    expect(por('antiga').status).toBe('aprovada');
    expect(s.travas).toEqual(['pauta-semana:e1']);
    expect(s.auditoria[0]).toMatchObject({ after: { pecasAoRascunho: ['corte', 'story'] } });
  });

  it('a transcrição reenviada sem mídia nova: só a peça de outra fala volta ao rascunho', async () => {
    const outra = [{ inicio: 0, fim: 10, texto: 'Outra fala.' }];
    const s = servico({
      episodios: [ep({ status: 'edicao', midia: { ...PautaMidiaSchema.parse(MIDIA), recebidaEm: '2026-09-24T12:00:00.000Z' } })],
      pecas: [peca({ id: 'velha' }), peca({ id: 'da-mesma', meta: { episodioId: 'e1', itemId: 'c3', transcricaoSha: shaDaTranscricao(outra), imagens: [], video: null } })],
    });
    await s.midia.registrarTranscricao(ORG, 'e1', PESSOA, PautaTranscricaoSchema.parse({ segmentos: outra }));
    expect(s.pecas.find((p) => p.id === 'velha')).toMatchObject({ status: 'rascunho', agendadaPara: null });
    expect(s.pecas.find((p) => p.id === 'da-mesma')?.status).toBe('aprovada');
    expect(s.auditoria[0]).toMatchObject({ after: { pecasAoRascunho: ['velha'] } });
  });
});

describe('mídia: registrar a transcrição', () => {
  const comMidia = () => ep({ status: 'edicao', midia: { ...PautaMidiaSchema.parse(MIDIA), recebidaEm: '2026-09-24T12:00:00.000Z' } });

  it('grava os segmentos e o texto corrido e vai para o pacote, auditando a conta', async () => {
    const s = servico({ episodios: [comMidia()] });
    const d = await s.midia.registrarTranscricao(ORG, 'e1', PESSOA, PautaTranscricaoSchema.parse({ segmentos: SEGMENTOS, idioma: 'pt', modelo: 'ggml-small.bin' }));
    expect(d.status).toBe('pacote');
    expect(d.transcricao).toEqual(SEGMENTOS);
    expect(d.transcricaoTexto).toBe('Bom dia, esta é a semana 39. A primeira notícia é sobre o Pix automático. E fecha em alta.');
    expect(s.condicionais[0].where).toMatchObject({ status: 'edicao', atualizadoEm: new Date('2026-09-24T12:00:00.000Z') });
    expect(s.auditoria[0]).toMatchObject({
      action: 'pauta.episodio_transcricao',
      before: { status: 'edicao' },
      after: { status: 'pacote', segmentos: 3, fimSeg: 540, duracaoSeg: 540.5, idioma: 'pt', modelo: 'ggml-small.bin' },
    });
  });

  it('na gravação (sem mídia), na edição sem mídia e depois da edição é 400 sem escrever', async () => {
    for (const e of [ep(), ep({ status: 'edicao' }), ep({ status: 'pacote', midia: comMidia().midia })]) {
      const s = servico({ episodios: [e] });
      await expect(
        s.midia.registrarTranscricao(ORG, 'e1', PESSOA, PautaTranscricaoSchema.parse({ segmentos: SEGMENTOS })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s.condicionais).toEqual([]);
    }
  });

  it('a transcrição do bruto (passa do fim do vídeo final) é 400 com o porquê', async () => {
    const s = servico({ episodios: [comMidia()] });
    const doBruto = PautaTranscricaoSchema.parse({ segmentos: [...SEGMENTOS.slice(0, 2), { inicio: 9, fim: 609, texto: 'longo' }] });
    await expect(s.midia.registrarTranscricao(ORG, 'e1', PESSOA, doBruto)).rejects.toThrow(/Transcreva o arquivo FINAL/);
    expect(s.lista[0].status).toBe('edicao');
  });

  it('a mídia trocada no meio (outro envio): 409 e o episódio fica na edição', async () => {
    const s = servico({ episodios: [comMidia()], antesDeGravar: (l) => (l[0].atualizadoEm = new Date('2026-09-24T12:30:00.000Z')) });
    await expect(
      s.midia.registrarTranscricao(ORG, 'e1', PESSOA, PautaTranscricaoSchema.parse({ segmentos: SEGMENTOS })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(s.lista[0].status).toBe('edicao');
  });

  it('episódio de outra empresa é 404', async () => {
    const s = servico({ episodios: [comMidia()] });
    await expect(
      s.midia.registrarTranscricao(OUTRA, 'e1', PESSOA, PautaTranscricaoSchema.parse({ segmentos: SEGMENTOS })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// 4. O controller e a ordem das rotas
// ---------------------------------------------------------------------------

describe('mídia: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  function controller() {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return {};
    };
    const duble = {
      pendentes: anota('pendentes'),
      registrarMidia: anota('registrarMidia'),
      registrarTranscricao: anota('registrarTranscricao'),
    } as unknown as MidiaService;
    return { c: new MidiaController(duble), chamadas };
  }

  it('a fila, a mídia e a transcrição chegam ao serviço com a empresa e a pessoa do token, já validadas', async () => {
    const { c, chamadas } = controller();
    await c.pendentes(usuario);
    await c.registrarMidia(usuario, 'e1', { arquivoBruto: 'b.mp4', arquivoFinal: 'f.mp4', duracaoSeg: 3 });
    await c.registrarTranscricao(usuario, 'e1', { segmentos: [{ inicio: 0, fim: 1, texto: ' oi ' }] });
    expect(chamadas).toEqual([
      { metodo: 'pendentes', args: [ORG] },
      {
        metodo: 'registrarMidia',
        args: [ORG, 'e1', PESSOA, { arquivoBruto: 'b.mp4', arquivoFinal: 'f.mp4', duracaoSeg: 3, cortes: [], palavraDeCorte: null, editor: 'ffmpeg' }],
      },
      { metodo: 'registrarTranscricao', args: [ORG, 'e1', PESSOA, { segmentos: [{ inicio: 0, fim: 1, texto: 'oi' }] }] },
    ]);
  });

  it('corpo vazio ou fora do esquema é recusado antes do serviço', () => {
    const { c, chamadas } = controller();
    expect(() => c.registrarMidia(usuario, 'e1', undefined)).toThrow();
    expect(() => c.registrarTranscricao(usuario, 'e1', { segmentos: [{ inicio: 2, fim: 1, texto: 'x' }] })).toThrow();
    expect(chamadas).toEqual([]);
  });

  it('as três rotas exigem pauta.editar e ficam sob /pauta/episodios', () => {
    expect(Reflect.getMetadata('path', MidiaController)).toBe('pauta/episodios');
    const proto = MidiaController.prototype as unknown as Record<string, object>;
    for (const [metodo, caminho] of [['pendentes', 'pendentes-midia'], ['registrarMidia', ':id/midia'], ['registrarTranscricao', ':id/transcricao']]) {
      expect(Reflect.getMetadata('path', proto[metodo])).toBe(caminho);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[metodo])).toEqual(['pauta.editar']);
    }
  });

  it('no módulo, o controller da mídia vem ANTES do do episódio — senão o `GET :id` engole `pendentes-midia`', () => {
    const modulo = readFileSync(join(__dirname, '../src/pauta/pauta.module.ts'), 'utf8');
    const lista = modulo.match(/controllers:\s*\[([^\]]*)\]/)?.[1] ?? '';
    const ordem = lista.split(',').map((c) => c.trim());
    expect(ordem).toContain('MidiaController');
    expect(ordem.indexOf('MidiaController')).toBeLessThan(ordem.indexOf('EpisodioController'));
  });
});

// ---------------------------------------------------------------------------
// 5. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada e um episódio)');

const MARCA = `md${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('mídia com banco: do gravado ao pacote pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let midia: MidiaService;
  let episodios: EpisodioService;
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const audit = new AuditService(app);
    episodios = new EpisodioService(app, audit);
    const roteiros = { palavraDaEmpresa: async () => null } as unknown as RoteiroService;
    midia = new MidiaService(app, audit, episodios, roteiros);
    const o = await admin.org.create({ data: { name: `Mídia ${MARCA}`, slug: `md-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('gravado entra na fila, a mídia leva à edição, a transcrição ao pacote, e o RASTRO registra as duas', async () => {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: [{ titulo: 'Um', url: 'https://um.exemplo' }] },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
    expect((await na(() => midia.pendentes(orgId))).items).toEqual([]);
    await na(() => episodios.mudarStatus(orgId, e.id, 'pessoa', 'gravacao'));

    const fila = await na(() => midia.pendentes(orgId));
    expect(fila.items.map((i) => [i.apelido, i.falta, i.palavraDeCorte])).toEqual([[e.apelido, 'midia', 'root, corta']]);

    const editado = await na(() => midia.registrarMidia(orgId, e.id, 'pessoa', PautaMidiaSchema.parse(MIDIA)));
    expect(editado.status).toBe('edicao');
    expect((await na(() => midia.pendentes(orgId))).items[0].falta).toBe('transcricao');

    const pronto = await na(() => midia.registrarTranscricao(orgId, e.id, 'pessoa', PautaTranscricaoSchema.parse({ segmentos: SEGMENTOS, idioma: 'pt' })));
    expect(pronto.status).toBe('pacote');
    expect(pronto.transcricao).toEqual(SEGMENTOS);
    expect((await na(() => midia.pendentes(orgId))).items).toEqual([]);

    const linha = await admin.pautaEpisodio.findUnique({ where: { id: e.id } });
    expect(linha?.transcricaoTexto).toContain('Pix automático');
    expect(midiaDoEpisodio(linha?.midia)?.cortes).toHaveLength(3);
    const rastro = await admin.auditLog.findMany({ where: { orgId, entityId: e.id }, orderBy: { createdAt: 'asc' } });
    expect(rastro.map((r) => r.action)).toEqual([
      'pauta.episodio_criado',
      'pauta.episodio_status',
      'pauta.episodio_midia',
      'pauta.episodio_transcricao',
    ]);
  }, 60_000);
});
