import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ActorType, Prisma, type PautaFonte } from '@prisma/client';
import { PAUTA_ORIGENS, origemDaFonte, type PautaPerfilPlataforma } from '@mktos/shared';

import {
  brutoDoPost,
  comProcedenciaDoPerfil,
  lerDataDoPost,
  lerHandleDoPerfil,
  plataformaDoPerfil,
  postDoItem,
  postsDoPerfil,
  procedenciaDoPerfil,
  textoDoPost,
} from '../src/pauta/perfil-da-pauta';
import {
  ORIGENS_ANTES_DO_MC4,
  comOrigem,
  filtroDasOrigens,
  insumoDaRodada,
  lerOrigensDaRodada,
  linhaDoInsumo,
  tiposDaColetaDasOrigens,
  umaPorMateriaDoInsumo,
  type CapturaDoInsumo,
} from '../src/pauta/origem-da-rodada';
import { ApifyService, type ApifyRun } from '../src/pauta/apify.service';
import { ColetaService, TIPOS_DA_COLETA_DA_RODADA } from '../src/pauta/coleta.service';
import { PautaService } from '../src/pauta/pauta.service';
import { RodadaService } from '../src/pauta/rodada.service';
import type { VozService } from '../src/pauta/voz.service';
import { TOM_DA_CASA } from '../src/pauta/voz-da-pauta';
import { RotinaService } from '../src/pauta/rotina.service';
import { ExecutorDePauta } from '../src/routines/executores/pauta.executor';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { TIPO_PAUTA_RODADA } from '../src/routines/rotina.tipos';
import type { RssService } from '../src/pauta/rss.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

// MC10: sem perfil, as peças recebem o tom da casa.
const vozDaCasa = { bloco: async () => TOM_DA_CASA } as unknown as VozService;

/*
 * CREATORS NO X E NO YOUTUBE, DENTRO DA RODADA — MC4.
 *
 * Quatro camadas, sem banco e sem Nest:
 *   1. a parte pura do perfil (`pauta/perfil-da-pauta.ts`): a plataforma, o @
 *      tirado da URL colada, e o item de cada actor que vira o mesmo
 *      `{url, titulo, texto, publicadoEm}`;
 *   2. o `ApifyService` DE VERDADE com o `fetch` trocado: o actor e o input que
 *      saem para o Apify em cada plataforma;
 *   3. a coleta no `PautaService` com um dublê do Apify: capturas com o post no
 *      bruto, o teto reservado antes do run e pulado com aviso, e o perfil na
 *      coleta da rodada;
 *   4. a origem de cada item (`pauta/origem-da-rodada.ts` + `origemDaFonte` do
 *      shared) e o `gerar()` DE VERDADE lendo todas as origens, com a rotina
 *      antiga ainda disponível por `origens: ['R', 'N']`.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc04';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000004';

const mesAtual = () => new Date().toISOString().slice(0, 7);

// ---------------------------------------------------------------------------
// 1. A parte pura do perfil
// ---------------------------------------------------------------------------

describe('perfil da pauta: plataforma e @', () => {
  it('sem plataforma é Instagram (a única antes do MC4); twitter é o X; o resto é recusado', () => {
    expect(plataformaDoPerfil(null)).toBe('instagram');
    expect(plataformaDoPerfil('')).toBe('instagram');
    expect(plataformaDoPerfil(' YouTube ')).toBe('youtube');
    expect(plataformaDoPerfil('Twitter')).toBe('x');
    expect(plataformaDoPerfil('linkedin')).toBeNull();
    expect(plataformaDoPerfil('google')).toBeNull();
  });

  it('o @ sai limpo do @, do espaço e da URL colada do perfil', () => {
    expect(lerHandleDoPerfil('x', ' @OpenAI ')).toEqual({ handle: 'OpenAI' });
    expect(lerHandleDoPerfil('x', 'https://x.com/sama?s=20')).toEqual({ handle: 'sama' });
    expect(lerHandleDoPerfil('x', 'https://twitter.com/sama/status/1')).toEqual({ handle: 'sama' });
    expect(lerHandleDoPerfil('youtube', 'https://www.youtube.com/@canaldoia/videos')).toEqual({ handle: 'canaldoia' });
    expect(lerHandleDoPerfil('youtube', 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({
      handle: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    });
    expect(lerHandleDoPerfil('instagram', 'www.instagram.com/blank.school/')).toEqual({ handle: 'blank.school' });
    expect(lerHandleDoPerfil('tiktok', 'https://www.tiktok.com/@criador.br')).toEqual({ handle: 'criador.br' });
  });

  it('link de post, página da rede, endereço de outra rede ou /user/ do YouTube não viram @', () => {
    expect(lerHandleDoPerfil('youtube', 'https://www.youtube.com/watch?v=abc')).toEqual({ erro: expect.stringContaining('não de um perfil') });
    expect(lerHandleDoPerfil('youtube', 'https://www.youtube.com/shorts/abc')).toHaveProperty('erro');
    expect(lerHandleDoPerfil('youtube', 'https://www.youtube.com/user/GoogleDevelopers')).toEqual({
      erro: expect.stringContaining('/user/ ou /c/'),
    });
    expect(lerHandleDoPerfil('instagram', 'https://www.instagram.com/p/C0abc/')).toHaveProperty('erro');
    expect(lerHandleDoPerfil('instagram', 'https://www.instagram.com/reel/C0abc/')).toHaveProperty('erro');
    expect(lerHandleDoPerfil('x', 'https://x.com/i/lists/123')).toHaveProperty('erro');
    expect(lerHandleDoPerfil('x', 'https://www.instagram.com/fulano/')).toEqual({ erro: expect.stringContaining('instagram.com, não do X') });
    expect(lerHandleDoPerfil('x', 'https://mobile.twitter.com/sama')).toEqual({ handle: 'sama' });
  });

  it('@ vazio, com espaço ou fora da regra da plataforma é erro legível', () => {
    expect(lerHandleDoPerfil('x', '  ')).toEqual({ erro: expect.stringContaining('exige o @') });
    expect(lerHandleDoPerfil('x', 'nome com espaço')).toEqual({ erro: expect.stringContaining('não é um @ válido no X') });
    expect(lerHandleDoPerfil('x', 'blank.school')).toHaveProperty('erro');
    expect(lerHandleDoPerfil('x', 'a'.repeat(16))).toHaveProperty('erro');
    expect(lerHandleDoPerfil('youtube', 'ab')).toHaveProperty('erro');
  });
});

describe('perfil da pauta: o item de cada actor vira post', () => {
  it('Instagram: legenda, primeira linha como título, timestamp', () => {
    const post = postDoItem('instagram', {
      url: 'https://www.instagram.com/p/AAA/',
      caption: '\n  Agentes chegaram\nsegunda linha',
      timestamp: '2026-09-21T10:00:00.000Z',
    });
    expect(post).toEqual({
      url: 'https://www.instagram.com/p/AAA/',
      titulo: 'Agentes chegaram',
      texto: 'Agentes chegaram\nsegunda linha',
      publicadoEm: new Date('2026-09-21T10:00:00.000Z'),
    });
  });

  it('TikTok: webVideoUrl, text e createTimeISO (ou createTime em segundos)', () => {
    expect(
      postDoItem('tiktok', { webVideoUrl: 'https://www.tiktok.com/@c/video/1', text: 'IA no caixa', createTimeISO: '2026-09-20T12:00:00.000Z' }),
    ).toMatchObject({ url: 'https://www.tiktok.com/@c/video/1', titulo: 'IA no caixa', publicadoEm: new Date('2026-09-20T12:00:00.000Z') });
    expect(postDoItem('tiktok', { webVideoUrl: 'https://www.tiktok.com/@c/video/2', text: 'x', createTime: 1_790_000_000 })?.publicadoEm).toEqual(
      new Date(1_790_000_000_000),
    );
  });

  it('X: fullText antes de text, url ou twitterUrl, createdAt no formato do Twitter', () => {
    const post = postDoItem('x', {
      type: 'tweet',
      twitterUrl: 'https://twitter.com/sama/status/42',
      text: 'curto…',
      fullText: 'O modelo novo saiu hoje.\nPreço caiu pela metade.',
      createdAt: 'Tue Sep 22 14:03:11 +0000 2026',
      likeCount: 900,
    });
    expect(post).toEqual({
      url: 'https://twitter.com/sama/status/42',
      titulo: 'O modelo novo saiu hoje.',
      texto: 'O modelo novo saiu hoje.\nPreço caiu pela metade.',
      publicadoEm: new Date('2026-09-22T14:03:11.000Z'),
    });
  });

  it('YouTube: title como título, text (descrição) como texto, date', () => {
    expect(
      postDoItem('youtube', {
        url: 'https://www.youtube.com/watch?v=abc',
        title: '  Como usar agentes   no financeiro ',
        text: 'Neste vídeo…',
        date: '2026-09-19T00:00:00.000Z',
        viewCount: 1200,
      }),
    ).toEqual({
      url: 'https://www.youtube.com/watch?v=abc',
      titulo: 'Como usar agentes no financeiro',
      texto: 'Neste vídeo…',
      publicadoEm: new Date('2026-09-19T00:00:00.000Z'),
    });
  });

  it('não é post: o marcador noResults do X, sem URL, URL que não é http(s)', () => {
    expect(postDoItem('x', { noResults: true })).toBeNull();
    expect(postDoItem('youtube', { title: 'sem url' })).toBeNull();
    expect(postDoItem('instagram', { url: 'javascript:alert(1)', caption: 'x' })).toBeNull();
  });

  it('sem texto o título diz a plataforma; título com emoji na fronteira não parte o caractere', () => {
    expect(postDoItem('x', { url: 'https://x.com/a/status/1' })?.titulo).toBe('Post de X');
    const titulo = postDoItem('instagram', { url: 'https://www.instagram.com/p/B/', caption: `${'a'.repeat(119)}😀 resto` })!.titulo;
    expect(titulo).toBe('a'.repeat(119));
  });

  it('data que não é data vira null', () => {
    expect(lerDataDoPost('ontem à tarde')).toBeNull();
    expect(lerDataDoPost(undefined)).toBeNull();
    expect(lerDataDoPost(0)).toBeNull();
  });

  it('a mesma URL duas vezes no run vira um post só', () => {
    const posts = postsDoPerfil('x', [
      { url: 'https://x.com/a/status/1', text: 'um' },
      { noResults: true },
      { url: 'https://x.com/a/status/1', text: 'repetido' },
      { url: 'https://x.com/a/status/2', text: 'dois' },
    ]);
    expect(posts.map((p) => p.post.texto)).toEqual(['um', 'dois']);
  });

  it('o bruto guarda o item cru, o resumo e a data que a rodada lê, e a procedência', () => {
    const item = { url: 'https://x.com/a/status/1', fullText: 'Texto do post', likeCount: 3 };
    const post = postDoItem('x', item)!;
    const bruto = brutoDoPost(post, item, 'x', 'sama');
    expect(bruto).toMatchObject({
      likeCount: 3,
      resumo: 'Texto do post',
      publicadoEm: null,
      perfil: { plataforma: 'x', handle: 'sama', texto: 'Texto do post' },
    });
    expect(procedenciaDoPerfil(bruto)).toEqual({ plataforma: 'x', handle: 'sama', texto: 'Texto do post' });
    expect(procedenciaDoPerfil({ perfil: { plataforma: 'linkedin', handle: 'x' } })).toBeNull();
    expect(textoDoPost(bruto)).toBe('Autor: @sama (X)\n\nTexto do post');
  });

  it('virar ficha troca o bruto, mas o resumo, a data e a procedência do perfil ficam', () => {
    const antes = { resumo: 'r', publicadoEm: '2026-09-22T00:00:00.000Z', perfil: { plataforma: 'instagram', handle: 'a', texto: 't' } };
    expect(comProcedenciaDoPerfil(antes, { caption: 'nova leitura' })).toEqual({ caption: 'nova leitura', ...antes });
    expect(comProcedenciaDoPerfil({ resumo: 'do feed' }, { html: 'x' })).toEqual({ html: 'x' });
  });
});

// ---------------------------------------------------------------------------
// 2. O ApifyService de verdade, com o fetch trocado
// ---------------------------------------------------------------------------

describe('perfil da pauta: o actor de cada plataforma no Apify', () => {
  const tokenAntes = process.env.APIFY_TOKEN;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (tokenAntes === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = tokenAntes;
  });

  function pedidosDoApify() {
    process.env.APIFY_TOKEN = 'token-de-teste';
    const pedidos: Array<{ url: string; corpo: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      pedidos.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('/actor-runs/')) return new Response(JSON.stringify({ data: { usageTotalUsd: 0.01 } }), { status: 200 });
      return new Response('[]', { status: 200, headers: { 'x-apify-run-id': 'run-perfil' } });
    });
    return pedidos;
  }

  it('X roda o tweet-scraper com o @ e os mais recentes', async () => {
    const pedidos = pedidosDoApify();
    const r = await new ApifyService().scrapePerfil('@sama', 12, 'x');
    expect(pedidos[0].url).toContain('/acts/apidojo~tweet-scraper/run-sync-get-dataset-items');
    expect(pedidos[0].corpo).toEqual({ twitterHandles: ['sama'], maxItems: 12, sort: 'Latest' });
    expect(r).toMatchObject({ runId: 'run-perfil', custoUsd: 0.01 });
  });

  it('YouTube roda o youtube-scraper na aba de vídeos do canal, sem shorts nem lives, no teto de 50', async () => {
    const pedidos = pedidosDoApify();
    await new ApifyService().scrapePerfil('canaldoia', 500, 'youtube');
    await new ApifyService().scrapePerfil('UC_x5XG1OV2P6uZZ5FSM9Ttw', 5, 'youtube');
    expect(pedidos[0].url).toContain('/acts/streamers~youtube-scraper/');
    expect(pedidos[0].corpo).toEqual({
      startUrls: [{ url: 'https://www.youtube.com/@canaldoia/videos' }],
      maxResults: 50,
      maxResultsShorts: 0,
      maxResultStreams: 0,
    });
    expect(pedidos[2].corpo).toMatchObject({
      startUrls: [{ url: 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos' }],
      maxResults: 5,
    });
  });

  it('sem plataforma segue o Instagram de antes; TikTok vai por profiles', async () => {
    const pedidos = pedidosDoApify();
    await new ApifyService().scrapePerfil('blank.school', 12);
    await new ApifyService().scrapePerfil('criador', 3, 'tiktok');
    expect(pedidos[0].url).toContain('/acts/apify~instagram-scraper/');
    expect(pedidos[0].corpo).toEqual({
      directUrls: ['https://www.instagram.com/blank.school/'],
      resultsType: 'posts',
      resultsLimit: 12,
      addParentData: false,
    });
    expect(pedidos[2].url).toContain('/acts/clockworks~tiktok-scraper/');
    expect(pedidos[2].corpo).toMatchObject({ profiles: ['criador'], resultsPerPage: 3, shouldDownloadVideos: false });
  });

  it('o link avulso do X ou do YouTube continua no crawler da web, não no actor do perfil', async () => {
    const pedidos = pedidosDoApify();
    await new ApifyService().scrapeUrl('https://x.com/sama/status/1');
    await new ApifyService().scrapeUrl('https://youtu.be/abc');
    expect(pedidos[0].url).toContain('/acts/apify~website-content-crawler/');
    expect(pedidos[2].url).toContain('/acts/apify~website-content-crawler/');
    expect(ApifyService.plataformaDaUrl('https://www.youtube.com/watch?v=abc')).toBe('youtube');
  });
});

// ---------------------------------------------------------------------------
// 3. A coleta no PautaService
// ---------------------------------------------------------------------------

interface CapturaGravada {
  id: string;
  orgId: string;
  fonteId: string | null;
  tipo: string;
  url: string | null;
  urlHash: string;
  titulo: string | null;
  nota: string | null;
  bruto: unknown;
  capturadoPor: string | null;
  apifyRunId?: string | null;
  custoUsd?: number | null;
}

function novaFonte(dados: Partial<PautaFonte>): PautaFonte {
  return {
    id: 'f-perfil',
    orgId: ORG,
    tipo: 'perfil',
    nome: 'Sam no X',
    url: null,
    handle: 'sama',
    plataforma: 'x',
    ativo: true,
    intervaloMin: 720,
    tetoRunsMes: 30,
    runsNoMes: 0,
    mesReferente: null,
    ultimaLeitura: null,
    ultimoErro: null,
    criadaEm: new Date('2026-09-01T00:00:00Z'),
    ...dados,
  } as PautaFonte;
}

type OndeDaFonte = {
  id: string;
  mesReferente?: string | { not: string };
  runsNoMes?: { lt: number };
  OR?: Array<{ mesReferente: null | { not: string } }>;
};

function casa(f: PautaFonte, where: OndeDaFonte): boolean {
  if (f.id !== where.id) return false;
  const mes = (m: OndeDaFonte['mesReferente'] | null) =>
    m === null ? f.mesReferente === null : typeof m === 'string' ? f.mesReferente === m : f.mesReferente !== null && f.mesReferente !== m!.not;
  if (where.OR && !where.OR.some((o) => mes(o.mesReferente))) return false;
  if (where.mesReferente !== undefined && !mes(where.mesReferente)) return false;
  if (where.runsNoMes && !(f.runsNoMes < where.runsNoMes.lt)) return false;
  return true;
}

function bancoDeMentira() {
  const fontes: PautaFonte[] = [];
  const capturas: CapturaGravada[] = [];
  const auditoria: Array<Record<string, unknown>> = [];
  let seq = 0;

  const prisma = {
    pautaFonte: {
      findMany: async ({ where }: { where: { orgId: string; ativo: boolean; tipo: { in: string[] } } }) =>
        fontes.filter((f) => f.orgId === where.orgId && f.ativo === where.ativo && where.tipo.in.includes(f.tipo)),
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) =>
        fontes.find((f) => f.id === where.id && f.orgId === where.orgId) ?? null,
      create: async ({ data }: { data: Partial<PautaFonte> }) => {
        const f = novaFonte({ ...data, id: `fonte-${++seq}` });
        fontes.push(f);
        return f;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PautaFonte> }) => {
        const f = fontes.find((x) => x.id === where.id)!;
        Object.assign(f, data);
        return f;
      },
      updateMany: async ({ where, data }: { where: OndeDaFonte; data: { runsNoMes: number | { increment: number }; mesReferente?: string } }) => {
        const alvo = fontes.filter((f) => casa(f, where));
        for (const f of alvo) {
          f.runsNoMes = typeof data.runsNoMes === 'number' ? data.runsNoMes : f.runsNoMes + data.runsNoMes.increment;
          if (data.mesReferente !== undefined) f.mesReferente = data.mesReferente;
        }
        return { count: alvo.length };
      },
    },
    pautaCaptura: {
      findUnique: async ({ where }: { where: { orgId_urlHash: { orgId: string; urlHash: string } } }) => {
        const { orgId, urlHash } = where.orgId_urlHash;
        const c = capturas.find((x) => x.orgId === orgId && x.urlHash === urlHash);
        return c ? { id: c.id, referencia: null } : null;
      },
      create: async ({ data }: { data: Omit<CapturaGravada, 'id'> }) => {
        if (capturas.some((x) => x.orgId === data.orgId && x.urlHash === data.urlHash)) {
          throw new Error('violou @@unique([orgId, urlHash]) — a deduplicação falhou');
        }
        const c: CapturaGravada = { ...data, id: `captura-${++seq}` };
        capturas.push(c);
        return c;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CapturaGravada> }) => {
        const c = capturas.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return c;
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<CapturaGravada> }) => {
        const alvo = capturas.filter((c) => where.id.in.includes(c.id));
        for (const c of alvo) Object.assign(c, data);
        return { count: alvo.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, fontes, capturas, auditoria };
}

const POSTS_DO_X = [
  { type: 'tweet', url: 'https://x.com/sama/status/1', fullText: 'O modelo novo saiu.\nDetalhes no blog.', createdAt: 'Tue Sep 22 14:03:11 +0000 2026' },
  { type: 'tweet', url: 'https://x.com/sama/status/2', text: 'Preço caiu.', createdAt: 'Mon Sep 21 09:00:00 +0000 2026' },
  { noResults: true },
];

const VIDEOS_DO_YOUTUBE = [
  { url: 'https://www.youtube.com/watch?v=abc', title: 'Agentes no financeiro', text: 'Descrição', date: '2026-09-20T00:00:00.000Z' },
];

/** O dublê do Apify: conta as chamadas e devolve o dataset da plataforma pedida. */
function apifyFalso(opcoes: { configurado?: boolean; custoUsd?: number | null } = {}) {
  const chamadas: Array<{ handle: string; limite: number; plataforma: PautaPerfilPlataforma }> = [];
  let falha: Error | null = null;
  const duble = {
    configured: opcoes.configurado ?? true,
    scrapePerfil: async (handle: string, limite: number, plataforma: PautaPerfilPlataforma): Promise<ApifyRun> => {
      chamadas.push({ handle, limite, plataforma });
      if (falha) throw falha;
      const items = plataforma === 'youtube' ? VIDEOS_DO_YOUTUBE : POSTS_DO_X;
      return { runId: `run-${chamadas.length}`, items, custoUsd: opcoes.custoUsd === undefined ? 0.01 : opcoes.custoUsd };
    },
    buscarNoGoogle: async () => {
      throw new Error('busca não entra nesta fatia');
    },
  };
  return { apify: duble, chamadas, falhar: (e: Error | null) => (falha = e) };
}

function montar(opcoesDoApify: Parameters<typeof apifyFalso>[0] = {}) {
  const banco = bancoDeMentira();
  const rss = {
    ler: async () => [{ titulo: 'Notícia do feed', url: 'https://feed.exemplo/materia', publicadoEm: null, resumo: 'r' }],
  } as unknown as RssService;
  const coleta = new ColetaService(banco.prisma, rss, {} as never);
  const falso = apifyFalso(opcoesDoApify);
  const svc = new PautaService(
    banco.prisma,
    new AuditService(banco.prisma),
    falso.apify as never,
    {} as never,
    { configured: false } as never,
    coleta,
  );
  svc.onModuleInit();
  return { ...banco, ...falso, coleta, svc };
}

describe('perfil da pauta: a coleta', () => {
  it('cada post do X vira captura com título, o post no bruto, o run e o custo rateado', async () => {
    const m = montar({ custoUsd: 0.01 });
    m.fontes.push(novaFonte({}));

    const r = await m.svc.coletarFonte(ORG, 'f-perfil', PESSOA);

    expect(r).toEqual({ ok: true, novas: 2, repetidas: 0 });
    expect(m.chamadas).toEqual([{ handle: 'sama', limite: 12, plataforma: 'x' }]);
    expect(m.capturas[0]).toMatchObject({
      fonteId: 'f-perfil',
      tipo: 'link',
      url: 'https://x.com/sama/status/1',
      titulo: 'O modelo novo saiu.',
      apifyRunId: 'run-1',
      custoUsd: 0.005,
      bruto: {
        resumo: 'O modelo novo saiu.\nDetalhes no blog.',
        publicadoEm: '2026-09-22T14:03:11.000Z',
        perfil: { plataforma: 'x', handle: 'sama' },
      },
    });
    const rastro = m.auditoria.find((a) => a.action === 'pauta.coleta_perfil');
    expect(rastro).toMatchObject({ entityId: 'f-perfil', after: { plataforma: 'x', handle: 'sama', runId: 'run-1', custoUsd: 0.01 } });
  });

  it('o canal do YouTube vira captura; coletar de novo não duplica, e o run conta', async () => {
    const m = montar();
    const f = novaFonte({ id: 'f-yt', nome: 'Canal', handle: 'canaldoia', plataforma: 'youtube' });
    m.fontes.push(f);

    await m.svc.coletarFonte(ORG, 'f-yt', PESSOA);
    const r = await m.svc.coletarFonte(ORG, 'f-yt', PESSOA);

    expect(r).toEqual({ ok: true, novas: 0, repetidas: 1 });
    expect(m.capturas).toHaveLength(1);
    expect(m.capturas[0]).toMatchObject({ url: 'https://youtube.com/watch?v=abc', titulo: 'Agentes no financeiro' });
    expect(f).toMatchObject({ runsNoMes: 2, mesReferente: mesAtual(), ultimoErro: null });
  });

  it('o perfil de antes do MC4, sem plataforma e com @ no handle, segue no Instagram', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ id: 'f-ig', handle: '@blank.school', plataforma: null }));
    await m.svc.coletarFonte(ORG, 'f-ig', PESSOA);
    expect(m.chamadas[0]).toMatchObject({ handle: 'blank.school', plataforma: 'instagram' });
  });

  it('teto atingido pula o perfil SEM chamar o Apify, com aviso na fonte e sem virar erro', async () => {
    const m = montar();
    const f = novaFonte({ tetoRunsMes: 2, runsNoMes: 2, mesReferente: mesAtual() });
    m.fontes.push(f);

    const r = await m.svc.coletarFonte(ORG, 'f-perfil', PESSOA);

    expect(r).toEqual({ ok: true, novas: 0, repetidas: 0, aviso: expect.stringContaining('Teto de 2 execuções/mês') });
    expect(m.chamadas).toHaveLength(0);
    expect(f).toMatchObject({ runsNoMes: 2, ultimaLeitura: null, ultimoErro: expect.stringMatching(/o perfil foi pulado/) });
  });

  it('o Apify que falha já gastou o run: conta, e o erro fica na fonte', async () => {
    const m = montar();
    const f = novaFonte({});
    m.fontes.push(f);
    m.falhar(new Error('Apify caiu'));

    await expect(m.svc.coletarFonte(ORG, 'f-perfil', PESSOA)).rejects.toThrow('Apify caiu');
    expect(f).toMatchObject({ runsNoMes: 1, ultimoErro: 'Apify caiu' });
  });

  it('sem APIFY_TOKEN, plataforma que não é coletada ou @ inválido: erro na fonte, sem Apify e sem gastar o teto', async () => {
    const semToken = montar({ configurado: false });
    semToken.fontes.push(novaFonte({}));
    await expect(semToken.svc.coletarFonte(ORG, 'f-perfil', PESSOA)).rejects.toThrow(/APIFY_TOKEN/);
    expect(semToken.fontes[0].runsNoMes).toBe(0);

    const m = montar();
    m.fontes.push(novaFonte({ id: 'f-li', plataforma: 'linkedin' }), novaFonte({ id: 'f-ruim', handle: 'nome com espaço' }));
    await expect(m.svc.coletarFonte(ORG, 'f-li', PESSOA)).rejects.toThrow(/não é coletada/);
    await expect(m.svc.coletarFonte(ORG, 'f-ruim', PESSOA)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.chamadas).toHaveLength(0);
    expect(m.fontes.map((f) => f.runsNoMes)).toEqual([0, 0]);
  });

  it('a rodada coleta os perfis junto com o feed; teto estourado é pulado sem contar erro', async () => {
    const m = montar();
    m.fontes.push(
      novaFonte({}),
      novaFonte({ id: 'f-yt', handle: 'canaldoia', plataforma: 'youtube', tetoRunsMes: 1, runsNoMes: 1, mesReferente: mesAtual() }),
      novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null, plataforma: null }),
    );

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(TIPOS_DA_COLETA_DA_RODADA).toContain('perfil');
    expect(r).toEqual({ novas: 3, fontes: 3, erros: 0, puladas: 1 });
    expect(m.chamadas.map((c) => c.plataforma)).toEqual(['x']);
    expect(m.auditoria.find((a) => a.action === 'pauta.coleta_perfil')).toMatchObject({
      actorType: ActorType.system,
      actorId: 'rotina',
    });
    // A rotina não é pessoa: nenhum post entra no RASTRO como captura colada por alguém.
    expect(m.auditoria.filter((a) => a.actorType !== ActorType.system)).toEqual([]);
    expect(m.capturas.find((c) => c.fonteId === 'f-perfil')).toMatchObject({ capturadoPor: 'rotina' });
  });

  it("a rotina de feed e busca (origens ['R', 'N']) coleta o feed e não gasta run com perfil", async () => {
    const m = montar();
    m.fontes.push(
      novaFonte({}),
      novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null, plataforma: null }),
    );
    const rodadas = new RodadaService(m.prisma, new AuditService(m.prisma), m.coleta, {} as LlmProvider, vozDaCasa);

    const r = await rodadas.coletarFeeds(ORG, 'rotina', ['R', 'N']);

    expect(r).toEqual({ novas: 1, fontes: 1, erros: 0, puladas: 0 });
    expect(m.chamadas).toHaveLength(0);
    expect(m.fontes[0].runsNoMes).toBe(0);
    expect(tiposDaColetaDasOrigens(['W', 'N', 'R', 'C', 'L'])).toEqual(['busca', 'rss', 'perfil', 'gmail']);
    expect(await rodadas.coletarFeeds(ORG, 'rotina', ['W'])).toEqual({ novas: 0, fontes: 0, erros: 0, puladas: 0 });
    await expect(rodadas.coletarFeeds(ORG, 'rotina', ['Z'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o mesmo post gravado por outra coleta ao mesmo tempo (P2002) conta como repetido, e o resto do run entra', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));
    type Criar = (args: unknown) => Promise<unknown>;
    const tabela = m.prisma.pautaCaptura as unknown as { create: Criar };
    const criar = tabela.create;
    let primeira = true;
    tabela.create = async (args) => {
      if (primeira) {
        primeira = false;
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'teste' });
      }
      return criar(args);
    };

    const r = await m.svc.coletarFonte(ORG, 'f-perfil', PESSOA);

    expect(r).toEqual({ ok: true, novas: 1, repetidas: 1 });
    expect(m.capturas.map((c) => c.url)).toEqual(['https://x.com/sama/status/2']);
    expect(m.fontes[0].ultimoErro).toBeNull();
    expect(m.auditoria.find((a) => a.action === 'pauta.coleta_perfil')).toMatchObject({ after: { repetidas: 1 } });
  });

  it('processar o post do X usa o texto guardado na coleta, sem abrir o link', async () => {
    const m = montar();
    const abrir = vi.fn(async () => {
      throw new Error('não era para abrir o x.com');
    });
    vi.stubGlobal('fetch', abrir);
    try {
      const item = POSTS_DO_X[0];
      const bruto = brutoDoPost(postDoItem('x', item)!, item, 'x', 'sama');
      const coleta = await (m.svc as unknown as {
        coletar: (c: { id: string; url: string | null; bruto: unknown }) => Promise<{ texto: string; bruto: unknown }>;
      }).coletar({ id: 'c1', url: 'https://x.com/sama/status/1', bruto });

      expect(coleta.texto).toContain('Autor: @sama (X)');
      expect(coleta.texto).toContain('O modelo novo saiu.');
      expect(coleta.bruto).toBe(bruto);
      expect(abrir).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('perfil da pauta: o cadastro no Radar', () => {
  const base = { tipo: 'perfil' as const, nome: 'Creator', ativo: true, intervaloMin: 720, tetoRunsMes: 8 };

  it('perfil do X ou do YouTube grava a plataforma e o @ tirado da URL colada', async () => {
    const m = montar();
    await m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'Twitter', handle: 'https://x.com/sama' });
    await m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'youtube', handle: '@canaldoia' });
    await m.svc.criarFonte(ORG, PESSOA, { ...base, handle: '@blank.school' });
    expect(m.fontes.map((f) => [f.plataforma, f.handle])).toEqual([
      ['x', 'sama'],
      ['youtube', 'canaldoia'],
      ['instagram', 'blank.school'],
    ]);
  });

  it('o teto de 60 caracteres vale para o @, não para a URL colada', async () => {
    const m = montar();
    const colado = 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos';
    expect(colado.length).toBeGreaterThan(60);
    await m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'youtube', handle: colado });
    await m.svc.atualizarFonte(ORG, m.fontes[0].id, PESSOA, { handle: `${colado}?view=0&sort=dd&shelf_id=1` });
    expect(m.fontes[0]).toMatchObject({ plataforma: 'youtube', handle: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
  });

  it('plataforma que não é coletada, ou @ fora da regra dela, é recusado', async () => {
    const m = montar();
    await expect(m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'linkedin', handle: 'alguem' })).rejects.toThrow(
      /instagram, tiktok, x e youtube/,
    );
    await expect(m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'x', handle: 'blank.school' })).rejects.toThrow(
      /não é um @ válido no X/,
    );
    await expect(m.svc.criarFonte(ORG, PESSOA, { ...base, plataforma: 'x' })).rejects.toThrow(/exige handle/);
    expect(m.fontes).toHaveLength(0);
  });

  it('trocar a plataforma confere o @ gravado contra a regra da nova; pausar não confere nada', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ id: 'f-ig', handle: 'blank.school', plataforma: 'instagram' }));
    await expect(m.svc.atualizarFonte(ORG, 'f-ig', PESSOA, { plataforma: 'x' })).rejects.toThrow(/não é um @ válido no X/);
    await m.svc.atualizarFonte(ORG, 'f-ig', PESSOA, { plataforma: 'youtube' });
    expect(m.fontes[0]).toMatchObject({ plataforma: 'youtube', handle: 'blank.school' });
    await m.svc.atualizarFonte(ORG, 'f-ig', PESSOA, { handle: 'https://www.youtube.com/@outro' });
    expect(m.fontes[0]).toMatchObject({ plataforma: 'youtube', handle: 'outro' });
    await m.svc.atualizarFonte(ORG, 'f-ig', PESSOA, { ativo: false });
    expect(m.fontes[0]).toMatchObject({ ativo: false, handle: 'outro' });
  });
});

// ---------------------------------------------------------------------------
// 4. A origem de cada item e a rodada
// ---------------------------------------------------------------------------

describe('rodada: o rótulo de origem', () => {
  it('W grupo de WhatsApp, N busca, R feed, C creator, L newsletter', () => {
    expect(origemDaFonte({ tipo: 'manual', plataforma: 'whatsapp' })).toBe('W');
    expect(origemDaFonte({ tipo: 'busca', plataforma: 'google' })).toBe('N');
    expect(origemDaFonte({ tipo: 'rss' })).toBe('R');
    expect(origemDaFonte({ tipo: 'perfil', plataforma: 'youtube' })).toBe('C');
    expect(origemDaFonte({ tipo: 'perfil', plataforma: null })).toBe('C');
    expect(origemDaFonte({ tipo: 'gmail', plataforma: 'gmail' })).toBe('L');
  });

  it('manual que não é o grupo, ou captura sem fonte, não é insumo de rodada', () => {
    expect(origemDaFonte({ tipo: 'manual', plataforma: null })).toBeNull();
    expect(origemDaFonte(null)).toBeNull();
  });

  it('as origens pedidas: ausente é todas; repetida e fora de ordem é arrumada; vazia ou desconhecida é erro', () => {
    expect(lerOrigensDaRodada(undefined)).toEqual({ origens: [...PAUTA_ORIGENS] });
    expect(lerOrigensDaRodada(['R', 'N', 'R'])).toEqual({ origens: ['N', 'R'] });
    expect(lerOrigensDaRodada([])).toHaveProperty('erro');
    expect(lerOrigensDaRodada(['X'])).toEqual({ erro: expect.stringContaining('Origem desconhecida: "X"') });
    expect(lerOrigensDaRodada('R')).toHaveProperty('erro');
  });

  it('cada origem vira o filtro da fonte; W é só o grupo de links', () => {
    expect(filtroDasOrigens(['W', 'N', 'R', 'C', 'L'])).toEqual([
      { tipo: 'manual', plataforma: 'whatsapp' },
      { tipo: 'busca' },
      { tipo: 'rss' },
      { tipo: 'perfil' },
      { tipo: 'gmail' },
    ]);
    expect(filtroDasOrigens(ORIGENS_ANTES_DO_MC4)).toEqual([{ tipo: 'rss' }, { tipo: 'busca' }]);
  });

  const GRUPO = { nome: 'Grupo de links (WhatsApp)', tipo: 'manual' as const, plataforma: 'whatsapp', handle: null };
  const BUSCA = { nome: 'IA para PMEs', tipo: 'busca' as const, plataforma: 'google', handle: 'ia pme' };
  const CREATOR = { nome: 'Sam', tipo: 'perfil' as const, plataforma: 'x', handle: 'sama' };
  const NEWS = { nome: 'Newsletters', tipo: 'gmail' as const, plataforma: 'gmail', handle: 'newsletters' };
  const permalink = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

  it('a linha do prompt leva a letra e a fonte; creator mostra o @; newsletter vai sem URL', () => {
    const creator = linhaDoInsumo(
      { titulo: 'Modelo novo', url: 'https://x.com/sama/status/1', bruto: { resumo: 'r', publicadoEm: '2026-09-22T14:00:00Z' }, fonte: CREATOR },
      2,
    );
    expect(creator).toBe(
      '[2] Modelo novo\n    origem: C · fonte: Sam (@sama · x) · 2026-09-22\n    url: https://x.com/sama/status/1\n    resumo: r',
    );
    const news = linhaDoInsumo({ titulo: 'The Batch', url: permalink('n1'), bruto: {}, fonte: NEWS }, 3);
    expect(news).toContain('origem: L');
    expect(news).not.toContain('mail.google.com');
  });

  it('a mesma matéria do grupo e da busca é uma só; newsletters diferentes não se fundem', () => {
    const capturas: CapturaDoInsumo[] = [
      { titulo: 'A', url: 'https://www.noticia.exemplo/a/', bruto: {}, fonte: GRUPO },
      { titulo: 'A', url: 'https://noticia.exemplo/a?utm_source=google', bruto: {}, fonte: BUSCA },
      { titulo: 'N1', url: permalink('n1'), bruto: {}, fonte: NEWS },
      { titulo: 'N2', url: permalink('n2'), bruto: {}, fonte: NEWS },
    ];
    const unicas = umaPorMateriaDoInsumo(capturas);
    expect(unicas.map((c) => c.titulo)).toEqual(['A', 'N1', 'N2']);
    // A matéria que veio do grupo e da busca guarda as duas letras, e a linha do prompt mostra as duas.
    expect(unicas[0].origens).toEqual(['W', 'N']);
    expect(linhaDoInsumo(unicas[0], 1)).toContain('origem: W+N · fonte: Grupo de links (WhatsApp)');
    expect(comOrigem([{ titulo: 'A', url: 'https://noticia.exemplo/a' }], unicas)).toEqual([
      { titulo: 'A', url: 'https://noticia.exemplo/a', origem: 'W' },
    ]);
  });

  it('o link do grupo chega ao prompt com o texto da mensagem, que o grupo grava em `nota`', () => {
    const linha = linhaDoInsumo(
      { titulo: null, url: 'https://noticia.exemplo/g', nota: 'olha isso: agentes no varejo', bruto: null, fonte: GRUPO },
      1,
    );
    expect(linha).toContain('origem: W');
    expect(linha).toContain('resumo: olha isso: agentes no varejo');
  });

  it('a origem que a IA escreve no item é descartada: vale só a da captura', () => {
    const capturas: CapturaDoInsumo[] = [{ titulo: 'B', url: 'https://x.com/sama/status/1', bruto: {}, fonte: CREATOR }];
    const itens = comOrigem(
      [
        { titulo: 'Inventada', url: 'https://inventada.exemplo/y', origem: 'rss' },
        { titulo: 'B', url: 'https://x.com/sama/status/1', origem: { hack: true } },
        { titulo: 'L falsa', url: 'https://outra.exemplo/z', origem: 'L' },
      ],
      capturas,
    );
    expect(itens).toEqual([
      { titulo: 'Inventada', url: 'https://inventada.exemplo/y' },
      { titulo: 'B', url: 'https://x.com/sama/status/1', origem: 'C' },
      { titulo: 'L falsa', url: 'https://outra.exemplo/z' },
    ]);
  });

  it('insumo: o lote novo de creators não tira do corte o link antigo do grupo; post velho de creator fica de fora', () => {
    const agora = Date.now();
    const janelaIni = new Date(agora - 72 * 3_600_000);
    const creators = Array.from({ length: 70 }, (_, i) => ({
      titulo: `Post ${i}`,
      url: `https://x.com/sama/status/${i}`,
      bruto: { publicadoEm: new Date(agora - 3_600_000).toISOString() },
      fonte: CREATOR,
      capturadoEm: new Date(agora - i * 1000),
    }));
    const velho = {
      titulo: 'Vídeo de março',
      url: 'https://youtube.com/watch?v=velho',
      bruto: { publicadoEm: '2026-03-01T00:00:00.000Z' },
      fonte: { ...CREATOR, plataforma: 'youtube' },
      capturadoEm: new Date(agora),
    };
    const grupo = { titulo: null, url: 'https://noticia.exemplo/semana', bruto: null, fonte: GRUPO, capturadoEm: new Date(agora - 60 * 3_600_000) };

    const insumo = insumoDaRodada<CapturaDoInsumo & { capturadoEm: Date }>([[grupo], [velho, ...creators]], { janelaIni, teto: 60 });

    expect(insumo).toHaveLength(60);
    expect(insumo.map((c) => c.url)).toContain('https://noticia.exemplo/semana');
    expect(insumo.map((c) => c.url)).not.toContain('https://youtube.com/watch?v=velho');
    expect(insumo.at(-1)?.url).toBe('https://noticia.exemplo/semana');
  });

  it('o item escolhido ganha a origem da captura; newsletter escolhida sai; URL que não casa segue sem origem', () => {
    const capturas: CapturaDoInsumo[] = [
      { titulo: 'A', url: 'https://noticia.exemplo/a', bruto: {}, fonte: GRUPO },
      { titulo: 'B', url: 'https://x.com/sama/status/1', bruto: {}, fonte: CREATOR },
      { titulo: 'N1', url: permalink('n1'), bruto: {}, fonte: NEWS },
    ];
    const itens = comOrigem(
      [
        { titulo: 'A', url: 'https://www.noticia.exemplo/a/' },
        { titulo: 'B', url: 'https://x.com/sama/status/1' },
        { titulo: 'N1', url: permalink('n1') },
        { titulo: 'Z', url: 'https://outra.exemplo/z' },
      ],
      capturas,
    );
    expect(itens).toEqual([
      { titulo: 'A', url: 'https://www.noticia.exemplo/a/', origem: 'W' },
      { titulo: 'B', url: 'https://x.com/sama/status/1', origem: 'C' },
      { titulo: 'Z', url: 'https://outra.exemplo/z' },
    ]);
  });
});

describe('rodada: gerar() lê todas as origens', () => {
  const hora = (h: number) => new Date(Date.now() - h * 3_600_000);
  const CAPTURAS = [
    { id: 'c1', titulo: 'Link do grupo', url: 'https://noticia.exemplo/grupo', bruto: {}, capturadoEm: hora(1), fonte: { nome: 'Grupo', tipo: 'manual', plataforma: 'whatsapp', handle: null } },
    { id: 'c2', titulo: 'Achado da busca', url: 'https://busca.exemplo/1', bruto: { resumo: 'desc' }, capturadoEm: hora(2), fonte: { nome: 'IA PME', tipo: 'busca', plataforma: 'google', handle: 'ia' } },
    { id: 'c3', titulo: 'Matéria do feed', url: 'https://feed.exemplo/1', bruto: {}, capturadoEm: hora(3), fonte: { nome: 'InfoMoney', tipo: 'rss', plataforma: null, handle: null } },
    { id: 'c6', titulo: 'Outra do feed', url: 'https://feed.exemplo/2', bruto: {}, capturadoEm: hora(6), fonte: { nome: 'InfoMoney', tipo: 'rss', plataforma: null, handle: null } },
    { id: 'c4', titulo: 'Vídeo do creator', url: 'https://youtube.com/watch?v=abc', bruto: { resumo: 'desc' }, capturadoEm: hora(4), fonte: { nome: 'Canal', tipo: 'perfil', plataforma: 'youtube', handle: 'canaldoia' } },
    { id: 'c5', titulo: 'The Batch', url: 'https://mail.google.com/mail/u/0/#all/n1', bruto: { resumo: 'news' }, capturadoEm: hora(5), fonte: { nome: 'Newsletters', tipo: 'gmail', plataforma: 'gmail', handle: 'newsletters' } },
  ];

  function rodadaFalsa(escolha: Array<{ titulo: string; url: string }>) {
    const consultas: Array<Record<string, unknown>> = [];
    const prompts: string[] = [];
    const gravadas: Array<Record<string, unknown>> = [];
    const criadas: unknown[] = [];
    const prisma = {
      pautaCaptura: {
        findMany: async ({ where, take }: { where: { fonte: { tipo: string; plataforma?: string } }; take: number }) => {
          consultas.push(where);
          return CAPTURAS.filter(
            (c) => c.fonte.tipo === where.fonte.tipo && (!where.fonte.plataforma || c.fonte.plataforma === where.fonte.plataforma),
          ).slice(0, take);
        },
      },
      pautaReferencia: { findMany: async () => [] },
      pautaRodada: {
        create: async ({ data }: { data: unknown }) => {
          criadas.push(data);
          return { id: 'rodada-1', titulo: 'Rodada' };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          gravadas.push(data);
          return { id: 'rodada-1', ...data };
        },
      },
      auditLog: { create: async ({ data }: { data: unknown }) => data },
    } as unknown as PrismaService;
    const llm = {
      name: 'falso',
      model: 'falso',
      configured: true,
      complete: async ({ user }: { user: string }) => {
        prompts.push(user);
        return JSON.stringify({ titulo: 'T', itens: escolha, corpo: 'c' });
      },
    } as unknown as LlmProvider;
    const rodadas = new RodadaService(prisma, new AuditService(prisma), {} as never, llm, vozDaCasa);
    return { rodadas, consultas, prompts, gravadas, criadas };
  }

  it('sem origens pedidas, a consulta pega as cinco e o prompt mostra a letra de cada item', async () => {
    const r = rodadaFalsa([
      { titulo: 'Vídeo do creator', url: 'https://youtube.com/watch?v=abc' },
      { titulo: 'Link do grupo', url: 'https://noticia.exemplo/grupo' },
    ]);

    await r.rodadas.gerar(ORG, PESSOA);

    // Uma consulta por origem: nenhuma disputa o corte com as outras.
    expect(r.consultas.map((c) => c.fonte)).toEqual(filtroDasOrigens(PAUTA_ORIGENS));
    for (const c of r.consultas) expect(c).toMatchObject({ orgId: ORG, status: { in: ['rascunho', 'ficha'] } });
    for (const letra of PAUTA_ORIGENS) expect(r.prompts[0]).toContain(`origem: ${letra} ·`);
    expect(r.prompts[0]).toContain('fonte: Canal (@canaldoia · youtube)');
    expect(r.prompts[0]).not.toContain('mail.google.com');
    expect(r.gravadas.at(-1)).toMatchObject({
      status: 'curada',
      itens: [
        { titulo: 'Vídeo do creator', url: 'https://youtube.com/watch?v=abc', origem: 'C' },
        { titulo: 'Link do grupo', url: 'https://noticia.exemplo/grupo', origem: 'W' },
      ],
    });
  });

  it('a newsletter que a IA escolher mesmo assim não vira item: o link é da caixa de entrada', async () => {
    const r = rodadaFalsa([
      { titulo: 'The Batch', url: 'https://mail.google.com/mail/u/0/#all/n1' },
      { titulo: 'Matéria do feed', url: 'https://feed.exemplo/1' },
    ]);
    await r.rodadas.gerar(ORG, PESSOA);
    expect(r.gravadas.at(-1)?.itens).toEqual([{ titulo: 'Matéria do feed', url: 'https://feed.exemplo/1', origem: 'R' }]);
  });

  it("a rodada de antes continua disponível: origens ['R', 'N'] consulta só o feed e a busca", async () => {
    const r = rodadaFalsa([{ titulo: 'Matéria do feed', url: 'https://feed.exemplo/1' }]);
    await r.rodadas.gerar(ORG, PESSOA, { origens: ['R', 'N'] });
    expect(r.consultas.map((c) => c.fonte)).toEqual([{ tipo: 'busca' }, { tipo: 'rss' }]);
  });

  it('origem desconhecida é recusada antes de criar a rodada e de chamar a IA', async () => {
    const r = rodadaFalsa([]);
    await expect(r.rodadas.gerar(ORG, PESSOA, { origens: ['Z'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(r.consultas).toHaveLength(0);
    expect(r.criadas).toHaveLength(0);
    expect(r.prompts).toHaveLength(0);
  });

  it('a rotina da pauta passa as origens da config; sem elas, gerar recebe undefined (todas)', async () => {
    const chamadas: Array<Record<string, unknown>> = [];
    const coletas: unknown[] = [];
    const rodadas = {
      coletarFeeds: async (_org: string, _ator: string, origens: unknown) => {
        coletas.push(origens);
        return { novas: 0, fontes: 0, erros: 0, puladas: 0 };
      },
      gerar: async (_org: string, _ator: string, opts: Record<string, unknown>) => {
        chamadas.push(opts);
        return { id: 'rodada-de-teste' };
      },
    } as unknown as RodadaService;
    const registro = new ExecutoresDeRotinaRegistry();
    new ExecutorDePauta({} as PrismaService, rodadas, registro).onModuleInit();
    const ctx = (config: Record<string, unknown>) => ({
      orgId: ORG,
      rotinaId: 'r1',
      slug: 'pauta-diaria',
      config,
      refExterna: null,
      origem: 'cron' as const,
      correlationId: 'c',
      agora: new Date(),
    });

    await registro.executar(TIPO_PAUTA_RODADA, ctx({ horas: 72, coletarAntes: false }));
    await registro.executar(TIPO_PAUTA_RODADA, ctx({ horas: 48, coletarAntes: false, origens: ['R', 'N'] }));
    await registro.executar(TIPO_PAUTA_RODADA, ctx({ horas: 48, coletarAntes: true, origens: ['R', 'N'] }));

    expect(chamadas).toEqual([
      { rotinaId: null, horas: 72, origens: undefined },
      { rotinaId: null, horas: 48, origens: ['R', 'N'] },
      { rotinaId: null, horas: 48, origens: ['R', 'N'] },
    ]);
    // A coleta antes da curadoria também recebe as origens: ['R', 'N'] não coleta perfil.
    expect(coletas).toEqual([['R', 'N']]);
  });

  it('a rotina da tela de Pauta guarda as origens na config e as manda no "rodar agora"', async () => {
    const linhas: Array<Record<string, unknown>> = [];
    const opcoes: Array<Record<string, unknown>> = [];
    const prisma = {
      pautaRotina: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const r = { id: 'rot-1', proximoRun: null, ...data };
          linhas.push(r);
          return r;
        },
        findFirst: async () => linhas[0] ?? null,
        update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(linhas[0], data),
      },
      auditLog: { create: async ({ data }: { data: unknown }) => data },
    } as unknown as PrismaService;
    const coletas: unknown[] = [];
    const rodadas = {
      coletarFeeds: async (_o: string, _a: string, origens: unknown) => {
        coletas.push(origens);
        return { novas: 0, fontes: 0, erros: 0, puladas: 0 };
      },
      gerar: async (_o: string, _a: string, opts: Record<string, unknown>) => {
        opcoes.push(opts);
        return { id: 'rodada-xyz' };
      },
    } as unknown as RodadaService;
    const rotinas = new RotinaService(prisma, new AuditService(prisma), rodadas);

    await rotinas.criar(ORG, PESSOA, {
      slug: 'antiga', nome: 'Antiga', cron: '0 7 * * *', tz: 'America/Sao_Paulo', ativo: true, horas: 72,
      coletarAntes: false, origens: ['R', 'N'],
    });
    await rotinas.atualizar(ORG, 'rot-1', PESSOA, { horas: 96, coletarAntes: true });
    await rotinas.rodarAgora(ORG, 'rot-1', PESSOA);

    expect(linhas[0].config).toEqual({ horas: 96, coletarAntes: true, origens: ['R', 'N'] });
    expect(coletas).toEqual([['R', 'N']]);
    expect(opcoes).toEqual([{ rotinaId: 'rot-1', horas: 96, origens: ['R', 'N'] }]);
  });
});
