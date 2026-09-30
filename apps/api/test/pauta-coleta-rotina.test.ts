import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { AgentEstado, type PautaFonte, type PautaFonteTipo } from '@prisma/client';
import { PAUTA_HORAS_DA_CURADORIA, PAUTA_ORIGENS, PautaColetarFeedsSchema, PautaGerarCuradoriaSchema } from '@mktos/shared';

import { ColetaService } from '../src/pauta/coleta.service';
import { RodadaService } from '../src/pauta/rodada.service';
import type { VozService } from '../src/pauta/voz.service';
import { TOM_DA_CASA } from '../src/pauta/voz-da-pauta';
import { coletaPorOrigem } from '../src/pauta/origem-da-rodada';
import type { Candidato } from '../src/pauta/curadoria-da-rodada';
import type { RssService } from '../src/pauta/rss.service';
import type { ColetorGmailService } from '../src/pauta/coletor-gmail.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import {
  ExecutorDeColetaDaPauta,
  resumoDaColeta,
  resumoDaRodada,
} from '../src/routines/executores/pauta-coleta.executor';
import { lerNovaRotina, slugDoNome } from '../src/routines/nova-rotina';
import { RotinasService } from '../src/routines/rotinas.service';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import {
  AGENTE_DA_PAUTA,
  TIPO_PAUTA_COLETA,
  TIPO_PAUTA_RODADA,
  type ContextoDaRotina,
  type EstadoDoAgendador,
} from '../src/routines/rotina.tipos';
import { auditoriaFalsa, prismaDeRotinas, rotinaFalsa, type EstadoDoBancoFalso } from './prisma-de-rotinas';
import { semMarca } from './marca-de-teste';

// MC10: sem perfil, as peças recebem o tom da casa.
const vozDaCasa = { bloco: async () => TOM_DA_CASA } as unknown as VozService;

/*
 * A ROTINA DE QUINTA 22h QUE COLETA TUDO — MC5.
 *
 * Quatro camadas, sem banco e sem Nest:
 *   1. o executor `pauta.coleta` com dublês: coleta todas as origens, gera a
 *      rodada no modo "para curadoria" com a janela da semana, resume por
 *      origem, pula quando não há fonte e não esconde a janela vazia;
 *   2. a coleta da rodada aberta por tipo: uma fonte que falha não derruba as
 *      outras e a conta sai por origem;
 *   3. o `POST /rotinas`: a leitura pura do corpo e o `RotinasService.criar`
 *      sobre o dublê de rotinas;
 *   4. de ponta a ponta: a rotina criada com o padrão da tela dispara pelo
 *      tique de quinta às 22h e pelo "rodar agora", com o executor, a coleta e o
 *      `RodadaService` DE VERDADE, e a rodada fica aguardando a curadoria com as
 *      cinco letras — sem ninguém curar.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc05';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000005';

/** Quinta, 24/09/2026, 22:00 em São Paulo (sexta 01:00 UTC). */
const QUINTA_22H = new Date('2026-09-25T01:00:00Z');

const silencio = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {} };
beforeEach(() => Logger.overrideLogger(silencio));

// ---------------------------------------------------------------------------
// 1. O executor com dublês
// ---------------------------------------------------------------------------

type ContaDaColeta = { novas: number; fontes: number; erros: number; puladas: number };

function contexto(config: Record<string, unknown> = {}): ContextoDaRotina {
  return {
    orgId: ORG,
    rotinaId: 'rotina-1',
    slug: 'coleta-semanal',
    config,
    refExterna: null,
    origem: 'cron',
    correlationId: 'corr-1',
    agora: QUINTA_22H,
  };
}

function executorComDubles(opts: {
  fontes?: number;
  porOrigem?: Record<string, ContaDaColeta>;
  itens?: Partial<Candidato>[];
  erroDaRodada?: string | null;
  falhaAoGerar?: Error;
  modulos?: string[];
} = {}) {
  const chamadas: { contagem: unknown[]; coleta: unknown[][]; gerar: unknown[][] } = {
    contagem: [],
    coleta: [],
    gerar: [],
  };
  const porOrigem = opts.porOrigem ?? {
    R: { novas: 3, fontes: 2, erros: 0, puladas: 0 },
    N: { novas: 4, fontes: 1, erros: 0, puladas: 0 },
    C: { novas: 2, fontes: 2, erros: 1, puladas: 0 },
    L: { novas: 1, fontes: 1, erros: 0, puladas: 0 },
  };
  const total = Object.values(porOrigem).reduce(
    (t, c) => ({ novas: t.novas + c.novas, fontes: t.fontes + c.fontes, erros: t.erros + c.erros, puladas: t.puladas + c.puladas }),
    { novas: 0, fontes: 0, erros: 0, puladas: 0 },
  );
  const prisma = {
    org: { findUnique: async () => ({ modulos: opts.modulos ?? ['pauta'] }) },
    pautaFonte: {
      count: async (a: unknown) => {
        chamadas.contagem.push(a);
        return opts.fontes ?? 6;
      },
    },
  } as unknown as PrismaService;
  const rodadas = {
    coletarPorOrigem: async (...args: unknown[]) => {
      chamadas.coleta.push(args);
      return { total, porOrigem };
    },
    gerarParaCuradoria: async (...args: unknown[]) => {
      chamadas.gerar.push(args);
      if (opts.falhaAoGerar) throw opts.falhaAoGerar;
      return {
        id: 'abcdef12-3456-7890',
        status: 'aguardando_curadoria',
        itens: opts.itens ?? [
          { id: 'c1', titulo: 'a', url: 'u1', origem: 'W', sugerido: true },
          { id: 'c2', titulo: 'b', url: 'u2', origem: 'W', origens: ['W', 'R'] },
          { id: 'c3', titulo: 'c', url: 'u3', origem: 'N' },
          { id: 'c4', titulo: 'd', url: 'u4', origem: 'C' },
          { id: 'c5', titulo: 'e', url: 'u5', origem: 'L', semLinkPublico: true },
        ],
        erro: opts.erroDaRodada ?? null,
      };
    },
  } as unknown as RodadaService;
  const registro = new ExecutoresDeRotinaRegistry();
  const executor = new ExecutorDeColetaDaPauta(prisma, rodadas, registro);
  executor.onModuleInit();
  return { executor, registro, chamadas };
}

describe('coleta de quinta: o executor', () => {
  it('inscreve `pauta.coleta` no registro, e só uma vez', () => {
    const { registro, executor } = executorComDubles();
    expect(TIPO_PAUTA_COLETA).toBe('pauta.coleta');
    expect(registro.tem(TIPO_PAUTA_COLETA)).toBe(true);
    expect(registro.donoDe(TIPO_PAUTA_COLETA)).toBe('ExecutorDeColetaDaPauta');
    expect(() => executor.onModuleInit()).toThrow(/inscrito duas vezes/);
  });

  it('todas as origens: coleta como rotina, gera para curadoria com a semana e resume por origem', async () => {
    const { registro, chamadas } = executorComDubles();

    const r = await registro.executar(TIPO_PAUTA_COLETA, contexto());

    expect(chamadas.coleta).toEqual([[ORG, 'rotina', [...PAUTA_ORIGENS]]]);
    expect(chamadas.gerar).toEqual([
      [
        ORG,
        'rotina',
        {
          rotinaId: null,
          horas: PAUTA_HORAS_DA_CURADORIA,
          desde: new Date(QUINTA_22H.getTime() - 168 * 3_600_000),
          origens: [...PAUTA_ORIGENS],
        },
      ],
    ]);
    expect(PAUTA_HORAS_DA_CURADORIA).toBe(168);
    expect(r.status).toBe('ok');
    expect(r.resumo).toBe(
      'coleta: 10 nova(s) de 6 fonte(s) — N 4 nova(s)/1 fonte(s) · R 3 nova(s)/2 fonte(s) · ' +
        'C 2 nova(s)/2 fonte(s) (1 erro(s)) · L 1 nova(s)/1 fonte(s); ' +
        'rodada abcdef12 aguardando curadoria: 5 candidato(s) (W 2 · N 1 · R 1 · C 1 · L 1), 1 sugerido(s)',
    );
  });

  it('a fonte das cinco origens entra na contagem de "tem fonte?", o grupo inclusive', async () => {
    const { registro, chamadas } = executorComDubles();
    await registro.executar(TIPO_PAUTA_COLETA, contexto());
    expect(chamadas.contagem).toEqual([
      {
        where: {
          orgId: ORG,
          ativo: true,
          OR: [
            { tipo: 'manual', plataforma: 'whatsapp' },
            { tipo: 'busca' },
            { tipo: 'rss' },
            { tipo: 'perfil' },
            { tipo: 'gmail' },
          ],
        },
      },
    ]);
  });

  it('config.horas sobrescreve a janela e config.origens restringe coleta, contagem e rodada', async () => {
    const { registro, chamadas } = executorComDubles();
    await registro.executar(TIPO_PAUTA_COLETA, contexto({ horas: 72, origens: ['R', 'W'] }));
    expect(chamadas.coleta[0][2]).toEqual(['W', 'R']);
    expect(chamadas.gerar[0][2]).toEqual({
      rotinaId: null,
      horas: 72,
      desde: new Date(QUINTA_22H.getTime() - 72 * 3_600_000),
      origens: ['W', 'R'],
    });
    expect((chamadas.contagem[0] as { where: { OR: unknown[] } }).where.OR).toEqual([
      { tipo: 'manual', plataforma: 'whatsapp' },
      { tipo: 'rss' },
    ]);
  });

  it('fonte com erro não impede a rodada: o erro aparece na conta da origem e a rodada sai', async () => {
    const { registro, chamadas } = executorComDubles({
      porOrigem: {
        R: { novas: 0, fontes: 1, erros: 1, puladas: 0 },
        N: { novas: 0, fontes: 1, erros: 0, puladas: 1 },
      },
    });
    const r = await registro.executar(TIPO_PAUTA_COLETA, contexto());
    expect(r.status).toBe('ok');
    expect(chamadas.gerar).toHaveLength(1);
    expect(r.resumo).toContain('N 0 nova(s)/1 fonte(s) (1 pulada(s)) · R 0 nova(s)/1 fonte(s) (1 erro(s))');
  });

  it('sem fonte ativa nas origens: pulada, sem coletar e sem gerar', async () => {
    const { registro, chamadas } = executorComDubles({ fontes: 0 });
    const r = await registro.executar(TIPO_PAUTA_COLETA, contexto({ origens: ['C'] }));
    expect(r).toEqual({ status: 'pulada', resumo: 'nenhuma fonte ativa nas origens C — nada a coletar' });
    expect(chamadas.coleta).toHaveLength(0);
    expect(chamadas.gerar).toHaveLength(0);
  });

  it('empresa sem o módulo pauta: pulada, sem contar fonte, sem Apify e sem IA', async () => {
    const { registro, chamadas } = executorComDubles({ modulos: ['conteudo'] });
    const r = await registro.executar(TIPO_PAUTA_COLETA, contexto());
    expect(r).toEqual({ status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a coletar' });
    expect(chamadas.contagem).toHaveLength(0);
    expect(chamadas.coleta).toHaveLength(0);
    expect(chamadas.gerar).toHaveLength(0);
  });

  it('janela vazia não some calada: vira erro com a conta da coleta junto', async () => {
    const { registro } = executorComDubles({
      falhaAoGerar: new BadRequestException('Nenhum item coletado nas últimas 168h'),
    });
    await expect(registro.executar(TIPO_PAUTA_COLETA, contexto())).rejects.toThrow(
      /^coleta: 10 nova\(s\) de 6 fonte\(s\).*; rodada não gerada: Nenhum item coletado nas últimas 168h$/,
    );
  });

  it('config com origem desconhecida é erro de configuração, antes de tocar em qualquer fonte', async () => {
    const { registro, chamadas } = executorComDubles();
    await expect(registro.executar(TIPO_PAUTA_COLETA, contexto({ origens: ['Z'] }))).rejects.toThrow(
      /configuração da rotina: Origem desconhecida/,
    );
    expect(chamadas.contagem).toHaveLength(0);
  });

  it('a IA sem sugestão aparece no resumo — a lista sai do mesmo jeito', async () => {
    const { registro } = executorComDubles({ erroDaRodada: 'Sem sugestão da IA: falta a credencial' });
    const r = await registro.executar(TIPO_PAUTA_COLETA, contexto());
    expect(r.resumo).toMatch(/, 1 sugerido\(s\) — sem sugestão da IA$/);
  });

  it('os resumos são só contagem, e a rodada sem candidato legível conta zero', () => {
    expect(resumoDaColeta({ novas: 0, fontes: 0, erros: 0, puladas: 0 }, {})).toBe('coleta: 0 nova(s) de 0 fonte(s)');
    expect(resumoDaRodada({ id: '12345678-x', itens: [{ titulo: 'sem id' }], erro: null })).toBe(
      'rodada 12345678 aguardando curadoria: 0 candidato(s), 0 sugerido(s)',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. A coleta da rodada aberta por tipo
// ---------------------------------------------------------------------------

function fonte(p: Partial<PautaFonte> & { id: string; tipo: PautaFonteTipo }): PautaFonte {
  return {
    orgId: ORG,
    nome: p.id,
    url: p.tipo === 'rss' ? `https://${p.id}.exemplo/rss` : null,
    handle: null,
    plataforma: null,
    ativo: true,
    intervaloMin: 60,
    tetoRunsMes: 10,
    runsNoMes: 0,
    mesReferente: null,
    ultimaLeitura: null,
    ultimoErro: null,
    criadaEm: new Date('2026-09-01T00:00:00Z'),
    ...p,
  } as unknown as PautaFonte;
}

interface CapturaFalsa {
  id: string;
  orgId: string;
  fonteId: string | null;
  tipo: string;
  url: string | null;
  urlHash: string;
  titulo: string | null;
  nota: string | null;
  bruto: unknown;
  status: string;
  capturadoEm: Date;
  capturadoPor: string;
}

/** O banco da pauta: fontes, capturas, rodadas e auditoria. */
function bancoDaPauta(fontes: PautaFonte[], capturas: CapturaFalsa[] = []) {
  const gravadas: Array<Record<string, unknown>> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const casaFonte = (f: PautaFonte, w: { tipo?: unknown; plataforma?: unknown }) =>
    (w.tipo === undefined || f.tipo === w.tipo) && (w.plataforma === undefined || f.plataforma === w.plataforma);
  type OndeCaptura = { where: { orgId: string; capturadoEm: { gte: Date }; fonte: { tipo: string; plataforma?: string }; fonteId?: { in: string[] } } };
  const daJanela = ({ where }: OndeCaptura) =>
    capturas
      .filter((c) => c.orgId === where.orgId && c.capturadoEm >= where.capturadoEm.gte && (!where.fonteId || (c.fonteId !== null && where.fonteId.in.includes(c.fonteId))))
      .map((c) => ({ ...c, fonte: fontes.find((f) => f.id === c.fonteId) ?? null }))
      .filter((c) => c.fonte && casaFonte(c.fonte, where.fonte))
      .sort((a, b) => b.capturadoEm.getTime() - a.capturadoEm.getTime());
  let seq = 0;
  const prisma = {
    org: { findUnique: async () => ({ modulos: ['pauta'] }) },
    pautaFonte: {
      count: async ({ where }: { where: { orgId: string; ativo: boolean; OR: Array<{ tipo?: string; plataforma?: string }> } }) =>
        fontes.filter((f) => f.orgId === where.orgId && f.ativo === where.ativo && where.OR.some((w) => casaFonte(f, w))).length,
      findMany: async ({ where }: { where: { orgId: string; ativo?: boolean; tipo?: { in: string[] }; id?: { in: string[] } } }) =>
        fontes.filter((f) => f.orgId === where.orgId && (where.ativo === undefined || f.ativo === where.ativo) &&
          (!where.tipo || where.tipo.in.includes(f.tipo)) && (!where.id || where.id.in.includes(f.id))),
      update: async ({ where, data }: { where: { id: string }; data: Partial<PautaFonte> }) => {
        const f = fontes.find((x) => x.id === where.id)!;
        Object.assign(f, data);
        return f;
      },
    },
    pautaCaptura: {
      findUnique: async ({ where }: { where: { orgId_urlHash: { orgId: string; urlHash: string } } }) =>
        capturas.find((c) => c.orgId === where.orgId_urlHash.orgId && c.urlHash === where.orgId_urlHash.urlHash) ?? null,
      create: async ({ data }: { data: Omit<CapturaFalsa, 'id' | 'status' | 'capturadoEm'> }) => {
        const nova = { id: `cap-${++seq}`, status: 'rascunho', capturadoEm: new Date(), ...data } as CapturaFalsa;
        capturas.push(nova);
        return nova;
      },
      findMany: async (a: OndeCaptura & { take: number }) => daJanela(a).slice(0, a.take),
      count: async (a: OndeCaptura) => daJanela(a).length,
    },
    pautaReferencia: { findMany: async () => [] },
    pautaRodada: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `rodada-${++seq}-0000`, ...data };
        gravadas.push(r);
        return { ...r };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = gravadas.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;
  return { prisma, fontes, capturas, gravadas, auditoria };
}

/** A captura que o coletor de mentira grava, como os coletores de verdade gravam. */
function capturar(banco: ReturnType<typeof bancoDaPauta>, f: PautaFonte, n: number) {
  for (let i = 0; i < n; i++) {
    banco.capturas.push({
      id: `cap-${f.id}-${banco.capturas.length}`,
      orgId: f.orgId,
      fonteId: f.id,
      tipo: 'link',
      url: `https://${f.id}.exemplo/${banco.capturas.length}`,
      urlHash: `${f.id}-${banco.capturas.length}`,
      titulo: `${f.tipo} ${i + 1}`,
      nota: null,
      bruto: { resumo: 'r' },
      status: 'rascunho',
      capturadoEm: new Date(),
      capturadoPor: 'rotina',
    });
  }
  return { novas: n, repetidas: 0 };
}

function montarPauta(fontes: PautaFonte[], capturas: CapturaFalsa[] = [], opts: { falhar?: string[]; urlCompartilhada?: boolean; llmConfigurada?: boolean } = {}) {
  const banco = bancoDaPauta(fontes, capturas);
  const rss = {
    ler: async (url: string) => {
      if (opts.falhar?.some((id) => url.includes(id))) throw new Error('feed fora do ar');
      return [{ titulo: 'Notícia do feed', url: opts.urlCompartilhada ? 'https://noticia.exemplo/mesma-url' : `${url.replace('/rss', '')}/materia-1`, publicadoEm: null, resumo: 'r' }];
    },
  } as unknown as RssService;
  const gmail = {
    coletar: async (f: PautaFonte) => capturar(banco, f, 1),
  } as unknown as ColetorGmailService;
  const coleta = new ColetaService(banco.prisma, rss, gmail);
  const porFonte = (f: PautaFonte) => {
    if (opts.falhar?.includes(f.id)) throw new Error('Apify fora do ar');
    return capturar(banco, f, 2);
  };
  coleta.registrar('busca', async (f) => porFonte(f), 'teste');
  coleta.registrar('perfil', async (f) => porFonte(f), 'teste');
  const llm = {
    name: 'falso', model: 'falso-1', configured: opts.llmConfigurada ?? false,
    complete: async () => { throw new Error('Chamada de IA proibida neste ensaio'); },
  } as unknown as LlmProvider;
  const rodadas = new RodadaService(banco.prisma, new AuditService(banco.prisma), coleta, llm, vozDaCasa, semMarca);
  return { ...banco, coleta, rodadas };
}

const FONTES_DAS_CINCO = () => [
  fonte({ id: 'grupo', tipo: 'manual', plataforma: 'whatsapp' }),
  fonte({ id: 'feed-a', tipo: 'rss' }),
  fonte({ id: 'feed-b', tipo: 'rss' }),
  fonte({ id: 'busca-ia', tipo: 'busca', handle: 'ia para pme', plataforma: 'google' }),
  fonte({ id: 'creator-x', tipo: 'perfil', handle: 'alguem', plataforma: 'x' }),
  fonte({ id: 'news', tipo: 'gmail', handle: 'newsletters', plataforma: 'gmail' }),
];

/** O link que o grupo mandou na semana: chega pelo webhook, não pela coleta. */
const DO_GRUPO = (): CapturaFalsa => ({
  id: 'cap-grupo',
  orgId: ORG,
  fonteId: 'grupo',
  tipo: 'link',
  url: 'https://grupo.exemplo/achado',
  urlHash: 'grupo-1',
  titulo: null,
  nota: 'olha isso',
  bruto: {},
  status: 'rascunho',
  capturadoEm: new Date(Date.now() - 24 * 3_600_000),
  capturadoPor: 'whatsapp',
});

describe('coleta de quinta: a coleta aberta por tipo', () => {
  it('uma fonte que falha não derruba as outras, e a conta sai por tipo e por origem', async () => {
    const m = montarPauta(FONTES_DAS_CINCO(), [], { falhar: ['feed-b'] });

    const r = await m.coleta.coletarDaRodadaPorTipo(ORG, 'rotina');

    expect(r.total).toEqual({ novas: 6, fontes: 5, erros: 1, puladas: 0 });
    expect(r.porTipo).toEqual({
      rss: { novas: 1, fontes: 2, erros: 1, puladas: 0 },
      busca: { novas: 2, fontes: 1, erros: 0, puladas: 0 },
      perfil: { novas: 2, fontes: 1, erros: 0, puladas: 0 },
      gmail: { novas: 1, fontes: 1, erros: 0, puladas: 0 },
    });
    expect(m.fontes.find((f) => f.id === 'feed-b')!.ultimoErro).toBe('feed fora do ar');
    expect(coletaPorOrigem(r.porTipo)).toEqual({
      R: r.porTipo.rss,
      N: r.porTipo.busca,
      C: r.porTipo.perfil,
      L: r.porTipo.gmail,
    });
    // O total segue o mesmo de antes para quem só quer o total.
    expect(await montarPauta(FONTES_DAS_CINCO()).coleta.coletarDaRodada(ORG, 'rotina')).toEqual({
      novas: 7,
      fontes: 5,
      erros: 0,
      puladas: 0,
    });
  });

  it('coletarPorOrigem só percorre as origens pedidas, e W não se coleta', async () => {
    const m = montarPauta(FONTES_DAS_CINCO());
    const r = await m.rodadas.coletarPorOrigem(ORG, 'rotina', ['W', 'R']);
    expect(r.total).toEqual({ novas: 2, fontes: 2, erros: 0, puladas: 0 });
    expect(Object.keys(r.porOrigem)).toEqual(['R']);
    await expect(m.rodadas.coletarPorOrigem(ORG, 'rotina', ['Z'])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('P05a: seleção explícita de fontes RSS', () => {
  it('o corpo aceita IDs únicos e não aceita lista vazia, repetida ou origem alheia a RSS', () => {
    const id = 'f6f28730-4abc-4d11-8999-4119ab997701';
    expect(PautaColetarFeedsSchema.parse({ fonteIds: [id] })).toEqual({ fonteIds: [id] });
    expect(PautaColetarFeedsSchema.parse({})).toEqual({});
    expect(PautaColetarFeedsSchema.safeParse({ fonteIds: [] }).success).toBe(false);
    expect(PautaColetarFeedsSchema.safeParse({ fonteIds: [id, id] }).success).toBe(false);
    expect(PautaGerarCuradoriaSchema.safeParse({ fonteIds: [id], origens: ['N'] }).success).toBe(false);
  });

  it('coleta só o feed pedido e só suas capturas viram candidatas, sem chamar IA configurada', async () => {
    const m = montarPauta(FONTES_DAS_CINCO(), [], { llmConfigurada: true });
    const coleta = await m.rodadas.coletarFeeds(ORG, PESSOA, undefined, ['feed-b']);
    expect(coleta).toEqual({ novas: 1, fontes: 1, erros: 0, puladas: 0, repetidas: 0, fonteIds: ['feed-b'] });
    expect(m.capturas.map((c) => c.fonteId)).toEqual(['feed-b']);

    const rodada = await m.rodadas.gerarParaCuradoria(ORG, PESSOA, { fonteIds: ['feed-b'] });
    expect(rodada).toMatchObject({ status: 'aguardando_curadoria', fontesSelecionadas: [{ id: 'feed-b', nome: 'feed-b' }] });
    expect((m.gravadas[0].itens as Candidato[]).map((c) => c.fonte)).toEqual(['feed-b']);
    expect(m.gravadas[0].provider).toBeUndefined();
    expect(m.auditoria.at(-1)).toMatchObject({ after: { fonteIds: ['feed-b'] } });
  });

  it('rejeita fonte de outro tenant, inativa, de outro tipo, sem URL, desconhecida ou lista vazia antes de coletar', async () => {
    const casos = [
      fonte({ id: 'outra-org', tipo: 'rss', orgId: 'outro-tenant' }),
      fonte({ id: 'pausada', tipo: 'rss', ativo: false }),
      fonte({ id: 'busca', tipo: 'busca' }),
      fonte({ id: 'sem-url', tipo: 'rss', url: null }),
    ];
    const m = montarPauta(casos);
    for (const ids of [['outra-org'], ['pausada'], ['busca'], ['sem-url'], ['ausente'], []]) {
      await expect(m.rodadas.coletarFeeds(ORG, PESSOA, undefined, ids)).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.rodadas.gerarParaCuradoria(ORG, PESSOA, { fonteIds: ids })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(m.capturas).toHaveLength(0);
    expect(m.gravadas).toHaveLength(0);
  });

  it('mesma URL em dois feeds conta colisão, sem atribuir a captura antiga ao segundo', async () => {
    const m = montarPauta([fonte({ id: 'feed-a', tipo: 'rss' }), fonte({ id: 'feed-b', tipo: 'rss' })], [], { urlCompartilhada: true, llmConfigurada: true });
    expect(await m.rodadas.coletarFeeds(ORG, PESSOA, undefined, ['feed-a'])).toMatchObject({ novas: 1, fontes: 1 });
    const segunda = await m.rodadas.coletarFeeds(ORG, PESSOA, undefined, ['feed-b']);
    expect(segunda).toMatchObject({ novas: 0, fontes: 1, colisoes: 1 });
    expect(m.capturas).toHaveLength(1);
    expect(m.capturas[0].fonteId).toBe('feed-a');
    await expect(m.rodadas.gerarParaCuradoria(ORG, PESSOA, { fonteIds: ['feed-b'] })).rejects.toThrow(/Nenhum item coletado/);
    expect(m.gravadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. O POST /rotinas
// ---------------------------------------------------------------------------

const INSCRITOS = [TIPO_PAUTA_COLETA, TIPO_PAUTA_RODADA];
const CORPO = { nome: 'Coleta semanal da pauta', tipo: TIPO_PAUTA_COLETA, cron: '0 22 * * 4' };

function erroDe(corpo: unknown, inscritos: readonly string[] = INSCRITOS): string {
  const r = lerNovaRotina(corpo, inscritos);
  return 'erro' in r ? r.erro : '(aceito)';
}

describe('coleta de quinta: a leitura do POST /rotinas', () => {
  it('o mínimo: slug do nome, fuso de São Paulo, planejada e sem configuração', () => {
    expect(lerNovaRotina(CORPO, INSCRITOS)).toEqual({
      dados: {
        nome: 'Coleta semanal da pauta',
        slug: 'coleta-semanal-da-pauta',
        tipo: TIPO_PAUTA_COLETA,
        cron: '0 22 * * 4',
        tz: 'America/Sao_Paulo',
        estado: AgentEstado.planejado,
        config: {},
      },
    });
    expect(slugDoNome('  Coleta de Notícias — quinta 22h! ')).toBe('coleta-de-noticias-quinta-22h');
  });

  it('o completo: slug, fuso, estado e config da coleta, com as origens na ordem canônica', () => {
    const r = lerNovaRotina(
      { ...CORPO, slug: 'coleta-quinta', tz: 'America/Manaus', estado: 'rodando', config: { horas: 72, origens: ['L', 'W'] } },
      INSCRITOS,
    );
    expect(r).toMatchObject({
      dados: { slug: 'coleta-quinta', tz: 'America/Manaus', estado: 'rodando', config: { horas: 72, origens: ['W', 'L'] } },
    });
  });

  it('só tipo com executor inscrito, e a recusa diz quais existem', () => {
    expect(erroDe({ ...CORPO, tipo: 'vault.indexar' })).toBe(
      'O tipo "vault.indexar" não tem executor inscrito nesta instalação. Disponíveis: pauta.coleta, pauta.rodada.',
    );
    expect(erroDe(CORPO, [])).toMatch(/Disponíveis: \(nenhum\)/);
    expect(erroDe({ ...CORPO, tipo: undefined })).toBe('Informe o tipo da rotina.');
  });

  it('cron e fuso são conferidos como na tela de Pauta', () => {
    expect(erroDe({ ...CORPO, cron: '0 22 * *' })).toMatch(/^Cron inválido/);
    expect(erroDe({ ...CORPO, cron: '99 22 * * 4' })).toMatch(/^Cron inválido/);
    expect(erroDe({ ...CORPO, cron: '' })).toMatch(/^Informe o cron/);
    expect(erroDe({ ...CORPO, tz: 'Marte/Olympus' })).toBe('Fuso inválido: "Marte/Olympus".');
    expect(erroDe({ ...CORPO, tz: 42 })).toMatch(/^Fuso inválido/);
  });

  it('nome, slug e estado fora do formato são recusados', () => {
    expect(erroDe({ ...CORPO, nome: '   ' })).toBe('O nome tem de 1 a 120 caracteres.');
    expect(erroDe({ ...CORPO, nome: 'x'.repeat(121) })).toBe('O nome tem de 1 a 120 caracteres.');
    expect(erroDe({ ...CORPO, slug: 'Com Espaço' })).toMatch(/^O slug/);
    expect(erroDe({ ...CORPO, nome: '!!' })).toMatch(/^O slug/);
    expect(erroDe({ ...CORPO, estado: 'ligado' })).toMatch(/^Estado inválido/);
    expect(erroDe(null)).toMatch(/^Mande um objeto/);
    expect(erroDe([CORPO])).toMatch(/^Mande um objeto/);
  });

  it('a config é conferida pelo tipo: janela de 6 a 336h, origens conhecidas, nada além', () => {
    expect(erroDe({ ...CORPO, config: { horas: 5 } })).toMatch(/config.horas/);
    expect(erroDe({ ...CORPO, config: { horas: 337 } })).toMatch(/config.horas/);
    expect(erroDe({ ...CORPO, config: { horas: 24.5 } })).toMatch(/config.horas/);
    expect(erroDe({ ...CORPO, config: { origens: ['X'] } })).toMatch(/^config.origens: Origem desconhecida/);
    expect(erroDe({ ...CORPO, config: { origens: [] } })).toMatch(/^config.origens/);
    expect(erroDe({ ...CORPO, config: { coletarAntes: false } })).toMatch(/só aceita horas e origens/);
    expect(erroDe({ ...CORPO, config: 'horas=72' })).toBe('config é um objeto.');
    expect(erroDe({ ...CORPO, tipo: TIPO_PAUTA_RODADA, config: { horas: 72 } })).toBe(
      'O tipo "pauta.rodada" não recebe configuração.',
    );
  });
});

const AGENDADOR_DE_PE: EstadoDoAgendador = { ativo: true, pautaDesligada: false, descobertaCega: false };

function montarRotinas(estado: EstadoDoBancoFalso = { rotinas: [], pautaRotinas: [], execucoes: [] }) {
  const prisma = prismaDeRotinas(estado);
  const registro = new ExecutoresDeRotinaRegistry();
  const auditoria = auditoriaFalsa();
  const servico = new RotinasService(prisma, auditoria.servico, registro);
  const agendador = new RotinasScheduler(prisma, servico);
  return { estado, prisma, registro, auditoria, servico, agendador };
}

describe('coleta de quinta: RotinasService.criar', () => {
  it('grava a rotina manual rodando, com agente da pauta, reserva livre e a próxima quinta às 22h', async () => {
    const m = montarRotinas();
    m.registro.registrar({ [TIPO_PAUTA_COLETA]: async () => ({ status: 'ok', resumo: '' }) }, 'teste');

    const r = await m.servico.criar(ORG, { ...CORPO, estado: 'rodando' }, PESSOA);

    expect(m.estado.rotinas).toHaveLength(1);
    const linha = m.estado.rotinas[0];
    expect(linha).toMatchObject({
      orgId: ORG,
      slug: 'coleta-semanal-da-pauta',
      tipo: TIPO_PAUTA_COLETA,
      cron: '0 22 * * 4',
      tz: 'America/Sao_Paulo',
      ativo: true,
      estado: AgentEstado.rodando,
      origem: 'manual',
      refExterna: null,
      agenteSlug: AGENTE_DA_PAUTA,
      config: {},
    });
    expect(linha.reservadoAte.getTime()).toBe(0);
    // Quinta 22h em São Paulo é sexta 01:00 UTC.
    const proxima = linha.proximaExecucaoEm as Date;
    expect([proxima.getUTCDay(), proxima.getUTCHours(), proxima.getUTCMinutes()]).toEqual([5, 1, 0]);
    expect(r).toMatchObject({ slug: 'coleta-semanal-da-pauta', temExecutor: true, dispara: true, origem: 'manual' });
    expect(m.auditoria.linhas).toEqual([
      expect.objectContaining({
        orgId: ORG,
        actorId: PESSOA,
        actorType: 'user',
        action: 'rotina.criada',
        entityId: linha.id,
        after: expect.objectContaining({ tipo: TIPO_PAUTA_COLETA, estado: 'rodando', cron: '0 22 * * 4' }),
      }),
    ]);
  });

  it('sem estado nasce planejada: não anuncia próxima execução e o tique não a dispara', async () => {
    const m = montarRotinas();
    const rodou: string[] = [];
    m.registro.registrar({ [TIPO_PAUTA_COLETA]: async (c) => (rodou.push(c.rotinaId), { status: 'ok', resumo: '' }) }, 'teste');

    const r = await m.servico.criar(ORG, CORPO, PESSOA);
    await m.agendador.tick(QUINTA_22H);

    expect(r).toMatchObject({ estado: 'planejado', dispara: false, proximaExecucaoEm: null });
    expect(rodou).toEqual([]);
  });

  it('slug repetido na empresa é 409 com o nome; tipo sem executor é 400 e nada é gravado', async () => {
    const m = montarRotinas();
    m.registro.registrar({ [TIPO_PAUTA_COLETA]: async () => ({ status: 'ok', resumo: '' }) }, 'teste');
    await m.servico.criar(ORG, CORPO, PESSOA);

    await expect(m.servico.criar(ORG, CORPO, PESSOA)).rejects.toThrow(ConflictException);
    await expect(m.servico.criar(ORG, CORPO, PESSOA)).rejects.toThrow(/"coleta-semanal-da-pauta"/);
    await expect(m.servico.criar(ORG, { ...CORPO, slug: 'outra', tipo: 'nao.existe' }, PESSOA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.estado.rotinas).toHaveLength(1);
    // Outra empresa pode usar o mesmo nome.
    await m.servico.criar('outra-empresa', CORPO, PESSOA);
    expect(m.estado.rotinas).toHaveLength(2);
  });

  it('a lista diz à tela quais tipos têm executor', async () => {
    const m = montarRotinas();
    m.registro.registrar({ [TIPO_PAUTA_COLETA]: async () => ({ status: 'ok', resumo: '' }) }, 'teste');
    const lista = await m.servico.listar(ORG, AGENDADOR_DE_PE);
    expect(lista.tiposDisponiveis).toEqual([TIPO_PAUTA_COLETA]);
  });

  it('empresa sem o módulo pauta não cria a coleta, e a lista não oferece o tipo', async () => {
    const m = montarRotinas({ rotinas: [], pautaRotinas: [], execucoes: [], modulos: { [ORG]: ['conteudo'] } });
    m.registro.registrar(
      { [TIPO_PAUTA_COLETA]: async () => ({ status: 'ok', resumo: '' }), outra: async () => ({ status: 'ok', resumo: '' }) },
      'teste',
    );

    await expect(m.servico.criar(ORG, CORPO, PESSOA)).rejects.toThrow(/módulo "pauta", que esta empresa não contrata/);
    expect(m.estado.rotinas).toHaveLength(0);
    expect(m.auditoria.linhas).toHaveLength(0);
    expect((await m.servico.listar(ORG, AGENDADOR_DE_PE)).tiposDisponiveis).toEqual(['outra']);
    // O tipo sem módulo segue aceito.
    await m.servico.criar(ORG, { nome: 'Outra', tipo: 'outra', cron: '0 8 * * 1' }, PESSOA);
    expect(m.estado.rotinas).toHaveLength(1);
  });

  it('PAUTA_CRON=off também tira a coleta de quinta do tique — é rotina da pauta', async () => {
    const antes = process.env.PAUTA_CRON;
    process.env.PAUTA_CRON = 'off';
    try {
      const m = montarRotinas();
      m.estado.rotinas.push(
        rotinaFalsa({ id: 'r-coleta', orgId: ORG, tipo: TIPO_PAUTA_COLETA }),
        rotinaFalsa({ id: 'r-outra', orgId: ORG, tipo: 'outra' }),
      );
      const rodou: string[] = [];
      const ex = async (c: ContextoDaRotina) => (rodou.push(c.rotinaId), { status: 'ok' as const, resumo: '' });
      m.registro.registrar({ [TIPO_PAUTA_COLETA]: ex, outra: ex }, 'teste');
      await m.agendador.tick(QUINTA_22H);
      expect(rodou).toEqual(['r-outra']);
    } finally {
      if (antes === undefined) delete process.env.PAUTA_CRON;
      else process.env.PAUTA_CRON = antes;
    }
  });
});

// ---------------------------------------------------------------------------
// 4. De ponta a ponta: criar, disparar, e a rodada aguardando a curadoria
// ---------------------------------------------------------------------------

describe('coleta de quinta: de ponta a ponta', () => {
  let ambiente: { rotinas?: string; pauta?: string };
  beforeEach(() => {
    ambiente = { rotinas: process.env.ROTINAS_CRON, pauta: process.env.PAUTA_CRON };
    delete process.env.ROTINAS_CRON;
    delete process.env.PAUTA_CRON;
  });
  afterEach(() => {
    if (ambiente.rotinas === undefined) delete process.env.ROTINAS_CRON;
    else process.env.ROTINAS_CRON = ambiente.rotinas;
    if (ambiente.pauta === undefined) delete process.env.PAUTA_CRON;
    else process.env.PAUTA_CRON = ambiente.pauta;
  });

  function montarTudo(opts: { falhar?: string[] } = {}) {
    const pauta = montarPauta(FONTES_DAS_CINCO(), [DO_GRUPO()], opts);
    const rot = montarRotinas();
    new ExecutorDeColetaDaPauta(pauta.prisma, pauta.rodadas, rot.registro).onModuleInit();
    return { pauta, rot };
  }

  it('o tique de quinta 22h dispara a rotina criada com o padrão da tela, e a rodada fica aguardando curadoria com as cinco letras', async () => {
    const { pauta, rot } = montarTudo();
    await rot.servico.criar(ORG, { ...CORPO, tz: 'America/Sao_Paulo', estado: 'rodando' }, PESSOA);

    // Quarta às 22h não é a hora dela.
    await rot.agendador.tick(new Date('2026-09-24T01:00:00Z'));
    expect(pauta.gravadas).toHaveLength(0);

    await rot.agendador.tick(QUINTA_22H);

    expect(pauta.gravadas).toHaveLength(1);
    const rodada = pauta.gravadas[0];
    expect(rodada).toMatchObject({ orgId: ORG, rotinaId: null, status: 'aguardando_curadoria' });
    // A semana conta do disparo, não do fim da coleta.
    expect((rodada.janelaIni as Date).getTime()).toBe(QUINTA_22H.getTime() - 168 * 3_600_000);
    const itens = rodada.itens as Candidato[];
    expect(new Set(itens.map((i) => i.origem))).toEqual(new Set(['W', 'N', 'R', 'C', 'L']));
    // Sem curar: ninguém marcado, e sem IA ninguém sugerido — só o aviso.
    expect(itens.every((i) => i.marcado === false && i.sugerido === false)).toBe(true);
    expect(rodada.erro).toMatch(/^Sem sugestão da IA/);
    expect(pauta.auditoria.map((a) => a.action)).toContain('pauta.rodada_para_curadoria');

    const [execucao] = rot.estado.execucoes;
    expect(execucao).toMatchObject({ status: 'ok', origem: 'cron', erro: null });
    expect(execucao.resumo).toMatch(
      /^coleta: 7 nova\(s\) de 5 fonte\(s\) — N 2 nova\(s\)\/1 fonte\(s\) · R 2 nova\(s\)\/2 fonte\(s\) · C 2 nova\(s\)\/1 fonte\(s\) · L 1 nova\(s\)\/1 fonte\(s\); rodada rodada-\d aguardando curadoria: 8 candidato\(s\) \(W 1 · N 2 · R 2 · C 2 · L 1\), 0 sugerido\(s\) — sem sugestão da IA$/,
    );
    expect(rot.estado.rotinas[0]).toMatchObject({ execucoes: 1, falhas: 0 });
  });

  it('"rodar agora" passa pelo mesmo caminho, e a fonte que falha fica só na conta dela', async () => {
    const { pauta, rot } = montarTudo({ falhar: ['busca-ia'] });
    const criada = await rot.servico.criar(ORG, { ...CORPO, estado: 'rodando' }, PESSOA);

    const r = await rot.servico.rodarAgora(ORG, criada.id, PESSOA);

    expect(r).toMatchObject({ ok: true, status: 'ok' });
    expect(r.resumo).toContain('N 0 nova(s)/1 fonte(s) (1 erro(s))');
    expect(pauta.fontes.find((f) => f.id === 'busca-ia')!.ultimoErro).toBe('Apify fora do ar');
    expect(pauta.gravadas[0]).toMatchObject({ status: 'aguardando_curadoria' });
    expect(new Set((pauta.gravadas[0].itens as Candidato[]).map((i) => i.origem))).toEqual(new Set(['W', 'R', 'C', 'L']));
    expect(rot.estado.execucoes[0]).toMatchObject({ status: 'ok', origem: 'manual' });
  });
});
