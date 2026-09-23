import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ActorType, Prisma, type PautaFonte } from '@prisma/client';

import {
  DIAS_DA_JANELA_DA_BUSCA,
  RESULTADOS_POR_BUSCA,
  TETO_DE_RESULTADOS_POR_BUSCA,
  capturaDoResultado,
  comProcedenciaDaBusca,
  custoPorCaptura,
  lerConsulta,
  lerDataDoGoogle,
  resultadosDaBusca,
  resultadosPedidos,
} from '../src/pauta/busca-da-pauta';
import { hashDaCaptura, normalizarUrlDaCaptura, umaPorMateria } from '../src/pauta/url-da-captura';
import { RodadaService } from '../src/pauta/rodada.service';
import { ColetaService, TIPOS_DA_COLETA_DA_RODADA } from '../src/pauta/coleta.service';
import { PautaService } from '../src/pauta/pauta.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { ApifyService, type ApifyRun, type OpcoesDaBusca } from '../src/pauta/apify.service';
import type { RssService } from '../src/pauta/rss.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * BUSCA WEB DAS NOTÍCIAS DO NICHO — MC3.
 *
 * Três camadas, sem banco e sem Nest:
 *   1. a parte pura (`pauta/busca-da-pauta.ts`): a consulta que vira uma busca
 *      só, a data que o Google escreve de cinco jeitos, o dataset do actor que
 *      vira resultado orgânico deduplicado e dentro da semana;
 *   2. o `ApifyService` DE VERDADE com o `fetch` trocado: o actor e o input que
 *      saem para o Apify (Brasil, pt-BR, última semana, uma página);
 *   3. a coleta no `PautaService` com um dublê do Apify e um banco de mentira:
 *      capturas deduplicadas contra a tela e contra a coleta anterior, o custo
 *      do run, e o teto — que reserva o run antes de rodar e, estourado, pula
 *      com aviso na fonte sem derrubar a rodada. É o que o "pronto quando" mede.
 */

const ORG = '7c0f0a8e-3333-4a5a-9c1e-00000000mc03';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000003';
const AGORA = new Date('2026-09-23T15:00:00Z');
const DIA = 86_400_000;

const mesAtual = () => new Date().toISOString().slice(0, 7);
const diasAtras = (n: number) => new Date(Date.now() - n * DIA).toISOString();

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('busca da pauta: a consulta', () => {
  it('uma linha só: quebra de linha e espaço repetido viram um espaço', () => {
    expect(lerConsulta('  inteligência artificial\n\npequenas   empresas ')).toEqual({
      consulta: 'inteligência artificial pequenas empresas',
    });
  });

  it('operadores do Google passam como estão', () => {
    expect(lerConsulta('"agentes de IA" site:exame.com OR site:valor.globo.com -vaga')).toEqual({
      consulta: '"agentes de IA" site:exame.com OR site:valor.globo.com -vaga',
    });
  });

  it('vazia é erro legível', () => {
    expect(lerConsulta('   ')).toEqual({ erro: expect.stringContaining('exige a consulta') });
    expect(lerConsulta(null)).toHaveProperty('erro');
  });

  it('URL é recusada: passaria por cima do recorte de país, idioma e semana', () => {
    expect(lerConsulta('https://www.google.com/search?q=ia')).toEqual({ erro: expect.stringContaining('não um endereço') });
    expect(lerConsulta('www.google.com.br')).toHaveProperty('erro');
  });

  it('acima de 200 caracteres ou de 32 palavras é recusada', () => {
    expect(lerConsulta('a'.repeat(201))).toEqual({ erro: expect.stringContaining('200 caracteres') });
    expect(lerConsulta(Array.from({ length: 33 }, (_, i) => `p${i}`).join(' '))).toEqual({
      erro: expect.stringContaining('32 palavras'),
    });
  });

  it('o número de resultados fica entre 1 e o teto; sem pedido é uma página', () => {
    expect(resultadosPedidos(undefined)).toBe(RESULTADOS_POR_BUSCA);
    expect(resultadosPedidos(0)).toBe(1);
    expect(resultadosPedidos(500)).toBe(TETO_DE_RESULTADOS_POR_BUSCA);
    expect(resultadosPedidos(Number.NaN)).toBe(RESULTADOS_POR_BUSCA);
  });
});

describe('busca da pauta: a data do resultado', () => {
  it('ISO passa como está', () => {
    expect(lerDataDoGoogle('2026-09-20T10:00:00.000Z', AGORA)?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
  });

  it('relativa em português e em inglês', () => {
    expect(lerDataDoGoogle('há 3 dias', AGORA)?.getTime()).toBe(AGORA.getTime() - 3 * DIA);
    expect(lerDataDoGoogle('Há 5 horas', AGORA)?.getTime()).toBe(AGORA.getTime() - 5 * 3_600_000);
    expect(lerDataDoGoogle('há 2 meses', AGORA)?.getTime()).toBe(AGORA.getTime() - 60 * DIA);
    expect(lerDataDoGoogle('há 1 mês', AGORA)?.getTime()).toBe(AGORA.getTime() - 30 * DIA);
    expect(lerDataDoGoogle('1 month ago', AGORA)?.getTime()).toBe(AGORA.getTime() - 30 * DIA);
    expect(lerDataDoGoogle('há 1 semana', AGORA)?.getTime()).toBe(AGORA.getTime() - 7 * DIA);
    expect(lerDataDoGoogle('2 days ago', AGORA)?.getTime()).toBe(AGORA.getTime() - 2 * DIA);
    expect(lerDataDoGoogle('ontem', AGORA)?.getTime()).toBe(AGORA.getTime() - DIA);
  });

  it('absoluta como o Google escreve em português e em inglês', () => {
    expect(lerDataDoGoogle('22 de set. de 2026', AGORA)?.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(lerDataDoGoogle('3 de março de 2025', AGORA)?.toISOString()).toBe('2025-03-03T00:00:00.000Z');
    expect(lerDataDoGoogle('Sep 22, 2026', AGORA)?.toISOString()).toBe('2026-09-22T00:00:00.000Z');
  });

  it('o que não é data é null — nem tudo antes de um travessão é data', () => {
    expect(lerDataDoGoogle('OpenAI', AGORA)).toBeNull();
    expect(lerDataDoGoogle('há muito tempo', AGORA)).toBeNull();
    expect(lerDataDoGoogle('', AGORA)).toBeNull();
  });
});

/** O formato do dataset do actor: um item por página do Google. */
function paginaDoGoogle(organicos: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    searchQuery: { term: 'ia pequenas empresas', page: 1, countryCode: 'br', languageCode: 'pt-BR' },
    organicResults: organicos,
    paidResults: [{ title: 'Anúncio', url: 'https://anuncio.exemplo/compre', description: 'compre já' }],
    peopleAlsoAsk: [{ question: 'O que é IA?', url: 'https://pergunta.exemplo' }],
    ...extra,
  };
}

describe('busca da pauta: o dataset vira resultado', () => {
  it('só orgânico entra, na ordem do Google, com a data tirada da frente da descrição', () => {
    const { resultados, foraDaJanela } = resultadosDaBusca(
      [
        paginaDoGoogle([
          { title: 'Agentes chegam às PMEs', url: 'https://noticia.exemplo/agentes', description: 'há 2 dias — Ferramentas novas.', position: 1 },
          { title: 'Preço do modelo cai', url: 'https://outra.exemplo/preco', description: 'O preço caiu pela metade.', position: 2 },
        ]),
      ],
      AGORA,
    );

    expect(foraDaJanela).toBe(0);
    expect(resultados.map((r) => r.url)).toEqual(['https://noticia.exemplo/agentes', 'https://outra.exemplo/preco']);
    expect(resultados[0]).toMatchObject({
      titulo: 'Agentes chegam às PMEs',
      descricao: 'Ferramentas novas.',
      posicao: 1,
      publicadoEm: new Date(AGORA.getTime() - 2 * DIA),
    });
    // Sem data nenhuma passa: o Google já filtrou a semana.
    expect(resultados[1]).toMatchObject({ descricao: 'O preço caiu pela metade.', publicadoEm: null });
  });

  it('data mais velha que a semana é descartada e contada — no campo `date` ou na descrição', () => {
    const { resultados, foraDaJanela } = resultadosDaBusca(
      [
        paginaDoGoogle([
          { title: 'Velha pelo campo', url: 'https://a.exemplo/1', date: '2026-08-01T00:00:00Z', description: 'x' },
          { title: 'Velha pela descrição', url: 'https://a.exemplo/2', description: '10 de set. de 2026 — y' },
          { title: 'Na janela', url: 'https://a.exemplo/3', description: '18 de set. de 2026 — z' },
        ]),
      ],
      AGORA,
      DIAS_DA_JANELA_DA_BUSCA,
    );
    expect(foraDaJanela).toBe(2);
    expect(resultados.map((r) => r.titulo)).toEqual(['Na janela']);
  });

  it('"há 1 mês" na frente da descrição é data, e cai fora da semana', () => {
    const { resultados, foraDaJanela } = resultadosDaBusca(
      [paginaDoGoogle([{ title: 'Um mês', url: 'https://a.exemplo/mes', description: 'há 1 mês — Texto antigo.' }])],
      AGORA,
    );
    expect(foraDaJanela).toBe(1);
    expect(resultados).toEqual([]);
  });

  it('a mesma matéria duas vezes no run (UTM, www, barra final, outra página) vira um resultado', () => {
    const { resultados } = resultadosDaBusca(
      [
        paginaDoGoogle([
          { title: 'A', url: 'https://www.noticia.exemplo/a/?utm_source=google' },
          { title: 'A de novo', url: 'https://noticia.exemplo/a' },
        ]),
        paginaDoGoogle([{ title: 'A na página 2', url: 'https://noticia.exemplo/a#comentarios' }]),
      ],
      AGORA,
    );
    expect(resultados).toHaveLength(1);
    expect(resultados[0].titulo).toBe('A');
  });

  it('fica de fora: sem URL, URL que não é http(s), endereço interno do Google, item quebrado', () => {
    const { resultados } = resultadosDaBusca(
      [
        paginaDoGoogle([
          { title: 'sem url' },
          { title: 'ftp', url: 'ftp://arquivo.exemplo/x' },
          { title: 'js', url: 'javascript:alert(1)' },
          { title: 'google', url: 'https://www.google.com.br/search?q=ia&tbm=nws' },
          { title: 'redireciona', url: 'https://www.google.com/url?q=https://x.exemplo' },
          null as unknown as Record<string, unknown>,
          'texto solto' as unknown as Record<string, unknown>,
          { title: 'Blog do Google é notícia', url: 'https://blog.google/technology/ai/novidade' },
        ]),
        { organicResults: 'não é lista' },
        {},
      ],
      AGORA,
    );
    expect(resultados.map((r) => r.titulo)).toEqual(['Blog do Google é notícia']);
  });

  it('sem título usa o domínio; título com emoji cortado não parte o caractere', () => {
    const longo = `${'x'.repeat(299)}🚀 resto`;
    const { resultados } = resultadosDaBusca(
      [paginaDoGoogle([{ url: 'https://www.semtitulo.exemplo/p' }, { title: longo, url: 'https://b.exemplo/1' }])],
      AGORA,
    );
    expect(resultados[0].titulo).toBe('semtitulo.exemplo');
    expect(resultados[1].titulo).toBe('x'.repeat(299));
  });

  it('a captura guarda a URL do Google e usa a chave da tela; o bruto tem o que a curadoria da rodada lê', () => {
    const { resultados } = resultadosDaBusca(
      [paginaDoGoogle([{ title: 'T', url: 'https://www.noticia.exemplo/a?utm_medium=x', description: 'há 1 dia — Resumo.', position: 4 }])],
      AGORA,
    );
    const c = capturaDoResultado(resultados[0], 'ia pme');

    // A URL que vai ao link publicado é a do Google: há site que não abre sem `www.`.
    expect(c.url).toBe('https://www.noticia.exemplo/a?utm_medium=x');
    expect(c.urlHash).toBe(hashDaCaptura(normalizarUrlDaCaptura('https://noticia.exemplo/a/')));
    expect(c).toMatchObject({ titulo: 'T', nota: 'Resumo.' });
    expect(c.bruto).toEqual({
      resumo: 'Resumo.',
      publicadoEm: new Date(AGORA.getTime() - DIA).toISOString(),
      busca: { consulta: 'ia pme', posicao: 4 },
    });
  });

  it('o custo do run é rateado entre as capturas novas, em 4 casas', () => {
    expect(custoPorCaptura(0.01, 3)).toBe(0.0033);
    expect(custoPorCaptura(0.02, 0)).toBeNull();
    expect(custoPorCaptura(null, 3)).toBeNull();
  });

  it('virar ficha troca o bruto pela leitura do link, mas a consulta, o resumo e a data da busca ficam', () => {
    const daBusca = { resumo: 'Resumo.', publicadoEm: '2026-09-22T00:00:00.000Z', busca: { consulta: 'ia pme', posicao: 2 } };
    expect(comProcedenciaDaBusca(daBusca, { html: '<p>x</p>' })).toEqual({ html: '<p>x</p>', ...daBusca });
    // Quem não veio da busca segue como estava.
    expect(comProcedenciaDaBusca({ resumo: 'do feed', feed: 'F' }, { html: 'y' })).toEqual({ html: 'y' });
    expect(comProcedenciaDaBusca(null, { html: 'z' })).toEqual({ html: 'z' });
  });

  it('a curadoria vê uma captura por matéria: o feed com www e a busca sem, a mais nova fica', () => {
    const lista = [
      { id: 'busca', url: 'https://infomoney.com.br/negocios/ia-pmes' },
      { id: 'rss', url: 'https://www.infomoney.com.br/negocios/ia-pmes/' },
      { id: 'sem-url', url: null },
      { id: 'outra', url: 'https://outra.exemplo/x?utm_source=feed' },
    ];
    expect(umaPorMateria(lista).map((c) => c.id)).toEqual(['busca', 'sem-url', 'outra']);
  });
});

// ---------------------------------------------------------------------------
// 2. O que sai para o Apify
// ---------------------------------------------------------------------------

describe('busca da pauta: o actor do Google no Apify', () => {
  const tokenAntes = process.env.APIFY_TOKEN;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (tokenAntes === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = tokenAntes;
  });

  it('roda o google-search-scraper com Brasil, pt-BR, a semana e uma página só', async () => {
    process.env.APIFY_TOKEN = 'token-de-teste';
    const pedidos: Array<{ url: string; corpo: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      pedidos.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('/actor-runs/')) {
        return new Response(JSON.stringify({ data: { usageTotalUsd: 0.0042 } }), { status: 200 });
      }
      return new Response(JSON.stringify([paginaDoGoogle([])]), {
        status: 200,
        headers: { 'x-apify-run-id': 'run-busca' },
      });
    });

    const r = await new ApifyService().buscarNoGoogle('ia\npequenas   empresas', { resultados: 500, dias: 7 });

    expect(pedidos[0].url).toContain('/acts/apify~google-search-scraper/run-sync-get-dataset-items');
    expect(pedidos[0].corpo).toEqual({
      queries: 'ia pequenas empresas',
      resultsPerPage: 100,
      maxPagesPerQuery: 1,
      countryCode: 'br',
      languageCode: 'pt-BR',
      quickDateRange: 'd7',
      mobileResults: false,
    });
    expect(r).toMatchObject({ runId: 'run-busca', custoUsd: 0.0042 });
  });

  it('sem APIFY_TOKEN não sai requisição', async () => {
    delete process.env.APIFY_TOKEN;
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    await expect(new ApifyService().buscarNoGoogle('ia', { resultados: 10, dias: 7 })).rejects.toThrow(/APIFY_TOKEN ausente/);
    expect(fetchFalso).not.toHaveBeenCalled();
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
    id: 'f-busca',
    orgId: ORG,
    tipo: 'busca',
    nome: 'IA para PMEs',
    url: null,
    handle: 'inteligência artificial pequenas empresas',
    plataforma: 'google',
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
  let corridaNaProximaEscrita = false;

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
      updateMany: async ({
        where,
        data,
      }: {
        where: OndeDaFonte;
        data: { runsNoMes: number | { increment: number }; mesReferente?: string };
      }) => {
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
        if (corridaNaProximaEscrita) {
          corridaNaProximaEscrita = false;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'teste' });
        }
        if (capturas.some((x) => x.orgId === data.orgId && x.urlHash === data.urlHash)) {
          throw new Error('violou @@unique([orgId, urlHash]) — a deduplicação falhou');
        }
        const c: CapturaGravada = { ...data, id: `captura-${++seq}` };
        capturas.push(c);
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

  return {
    prisma: prisma as unknown as PrismaService,
    fontes,
    capturas,
    auditoria,
    correrNaProximaEscrita: () => {
      corridaNaProximaEscrita = true;
    },
  };
}

const RESULTADOS_DA_SEMANA = [
  paginaDoGoogle([
    { title: 'Agentes chegam às PMEs', url: 'https://noticia.exemplo/agentes?utm_source=google', description: 'há 2 dias — Ferramentas novas.', position: 1 },
    { title: 'Preço do modelo cai', url: 'https://outra.exemplo/preco', description: 'O preço caiu pela metade.', position: 2 },
    { title: 'Matéria velha', url: 'https://velha.exemplo/x', date: diasAtras(40), description: 'antiga', position: 3 },
  ]),
];

/** O dublê do Apify: conta as chamadas e devolve o dataset que o teste mandar. */
function apifyFalso(opcoes: { configurado?: boolean; itens?: Array<Record<string, unknown>>; custoUsd?: number | null } = {}) {
  const chamadas: Array<{ consulta: string; opcoes: OpcoesDaBusca }> = [];
  let falha: Error | null = null;
  let itens = opcoes.itens ?? RESULTADOS_DA_SEMANA;
  const duble = {
    configured: opcoes.configurado ?? true,
    buscarNoGoogle: async (consulta: string, o: OpcoesDaBusca): Promise<ApifyRun> => {
      chamadas.push({ consulta, opcoes: o });
      if (falha) throw falha;
      return { runId: `run-${chamadas.length}`, items: itens, custoUsd: opcoes.custoUsd === undefined ? 0.004 : opcoes.custoUsd };
    },
    scrapePerfil: async () => {
      throw new Error('perfil não entra nesta fatia');
    },
  };
  return {
    apify: duble,
    chamadas,
    falhar: (e: Error | null) => (falha = e),
    trocarItens: (novos: Array<Record<string, unknown>>) => (itens = novos),
  };
}

function montar(opcoesDoApify: Parameters<typeof apifyFalso>[0] = {}) {
  const banco = bancoDeMentira();
  const feeds: string[] = [];
  const rss = {
    ler: async (url: string) => {
      feeds.push(url);
      return [{ titulo: 'Notícia do feed', url: 'https://feed.exemplo/materia', publicadoEm: null, resumo: 'r' }];
    },
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
  return { ...banco, ...falso, coleta, svc, feeds };
}

describe('busca da pauta: a coleta', () => {
  it('cada resultado orgânico da semana vira captura com título, link e a descrição na nota', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));

    const r = await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(r).toEqual({ ok: true, novas: 2, repetidas: 0 });
    expect(m.chamadas).toEqual([
      { consulta: 'inteligência artificial pequenas empresas', opcoes: { resultados: 12, dias: DIAS_DA_JANELA_DA_BUSCA } },
    ]);
    expect(m.capturas.map((c) => [c.titulo, c.url, c.nota])).toEqual([
      ['Agentes chegam às PMEs', 'https://noticia.exemplo/agentes?utm_source=google', 'Ferramentas novas.'],
      ['Preço do modelo cai', 'https://outra.exemplo/preco', 'O preço caiu pela metade.'],
    ]);
    expect(m.capturas[0]).toMatchObject({ tipo: 'link', fonteId: 'f-busca', apifyRunId: 'run-1', capturadoPor: PESSOA });
    expect(m.fontes[0]).toMatchObject({ runsNoMes: 1, mesReferente: mesAtual(), ultimoErro: null });
    expect(m.fontes[0].ultimaLeitura).toBeInstanceOf(Date);
    expect(m.coleta.temColetor('busca')).toBe(true);
  });

  it('coletar de novo não duplica: a mesma notícia na semana seguinte é repetida, e o run conta', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));

    await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);
    const r = await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(r).toEqual({ ok: true, novas: 0, repetidas: 2 });
    expect(m.capturas).toHaveLength(2);
    expect(m.fontes[0].runsNoMes).toBe(2);
  });

  it('o link já colado na tela ou no grupo é a mesma captura: a chave é a da tela', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));
    await m.svc.capturar(ORG, PESSOA, { tipo: 'link', url: 'https://www.noticia.exemplo/agentes/' });

    const r = await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(r).toMatchObject({ novas: 1, repetidas: 1 });
    expect(m.capturas.filter((c) => c.url === 'https://noticia.exemplo/agentes')).toHaveLength(1);
  });

  it('corrida com outra coleta (P2002) conta como repetida em vez de derrubar a busca', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));
    m.correrNaProximaEscrita();

    const r = await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(r).toMatchObject({ novas: 1, repetidas: 1 });
  });

  it('o custo do run é rateado nas capturas novas e o total fica no RASTRO, com a rotina como sistema', async () => {
    const m = montar({ custoUsd: 0.005 });
    m.fontes.push(novaFonte({}));

    await m.coleta.coletar(m.fontes[0], 'rotina');

    expect(m.capturas.map((c) => c.custoUsd)).toEqual([0.0025, 0.0025]);
    expect(m.auditoria).toHaveLength(1);
    expect(m.auditoria[0]).toMatchObject({
      action: 'pauta.coleta_busca',
      actorType: ActorType.system,
      actorId: 'rotina',
      entityId: 'f-busca',
      after: {
        consulta: 'inteligência artificial pequenas empresas',
        runId: 'run-1',
        custoUsd: 0.005,
        capturas: m.capturas.map((c) => c.id),
        repetidas: 0,
        foraDaJanela: 1,
      },
    });
  });

  it('run sem nada novo ainda deixa o gasto no RASTRO', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}));
    m.trocarItens([paginaDoGoogle([])]);

    expect(await m.svc.coletarFonte(ORG, 'f-busca', PESSOA)).toMatchObject({ novas: 0, repetidas: 0 });
    expect(m.auditoria).toHaveLength(1);
    expect(m.auditoria[0]).toMatchObject({ action: 'pauta.coleta_busca', after: { capturas: [], custoUsd: 0.004 } });
  });
});

describe('busca da pauta: o teto de runs do mês', () => {
  it('teto atingido pula a busca SEM chamar o Apify, com aviso na fonte e sem virar erro', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 2, runsNoMes: 2, mesReferente: mesAtual() }));

    const r = await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(r).toEqual({ ok: true, novas: 0, repetidas: 0, aviso: expect.stringContaining('Teto de 2 execuções/mês') });
    expect(m.chamadas).toHaveLength(0);
    expect(m.fontes[0].runsNoMes).toBe(2);
    expect(m.fontes[0].ultimoErro).toMatch(/a busca foi pulada/);
    // Não leu nada: o Radar não pode mostrar "última leitura agora".
    expect(m.fontes[0].ultimaLeitura).toBeNull();
  });

  it('as coletas param exatamente no teto: 3 cliques com teto 2 são 2 runs', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 2 }));

    for (let i = 0; i < 3; i++) await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(m.chamadas).toHaveLength(2);
    expect(m.fontes[0].runsNoMes).toBe(2);
  });

  it('a rotina e o botão ao mesmo tempo no último run: só um chega ao Apify', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 3, runsNoMes: 2, mesReferente: mesAtual() }));
    // Os dois leram a fonte com 2/3 antes de qualquer um reservar.
    const lida = { ...m.fontes[0] };

    const [a, b] = await Promise.all([m.coleta.coletar(lida, 'rotina'), m.coleta.coletar({ ...lida }, PESSOA)]);

    expect(m.chamadas).toHaveLength(1);
    expect(m.fontes[0].runsNoMes).toBe(3);
    expect([a.aviso, b.aviso].filter(Boolean)).toHaveLength(1);
  });

  it('a virada do mês zera o contador: o mês passado cheio não trava o mês novo', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 2, runsNoMes: 2, mesReferente: '2026-01' }));

    await m.svc.coletarFonte(ORG, 'f-busca', PESSOA);

    expect(m.chamadas).toHaveLength(1);
    expect(m.fontes[0]).toMatchObject({ runsNoMes: 1, mesReferente: mesAtual() });
  });

  it('teto zero é fonte desligada para o Apify', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 0 }));

    expect(await m.svc.coletarFonte(ORG, 'f-busca', PESSOA)).toMatchObject({ novas: 0, aviso: expect.any(String) });
    expect(m.chamadas).toHaveLength(0);
  });

  it('o Apify que falha já gastou o run: conta, e o erro fica na fonte', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ tetoRunsMes: 5 }));
    m.falhar(new Error('Apify respondeu HTTP 502 ao rodar apify~google-search-scraper.'));

    await expect(m.svc.coletarFonte(ORG, 'f-busca', PESSOA)).rejects.toThrow('HTTP 502');

    expect(m.fontes[0].runsNoMes).toBe(1);
    expect(m.fontes[0].ultimoErro).toMatch(/HTTP 502/);
  });

  it('sem APIFY_TOKEN é erro na fonte e o teto não gasta o que não rodou', async () => {
    const m = montar({ configurado: false });
    m.fontes.push(novaFonte({}));

    await expect(m.svc.coletarFonte(ORG, 'f-busca', PESSOA)).rejects.toThrow(/APIFY_TOKEN/);

    expect(m.chamadas).toHaveLength(0);
    expect(m.fontes[0]).toMatchObject({ runsNoMes: 0, mesReferente: null, ultimoErro: expect.stringContaining('APIFY_TOKEN') });
  });

  it('consulta inválida gravada à mão não chega ao Apify', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ handle: 'https://www.google.com/search?q=ia' }));
    await expect(m.svc.coletarFonte(ORG, 'f-busca', PESSOA)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.chamadas).toHaveLength(0);
    expect(m.fontes[0].runsNoMes).toBe(0);
  });
});

describe('busca da pauta: a rodada e o cadastro', () => {
  it('a rodada coleta a busca junto com o feed', async () => {
    const m = montar();
    m.fontes.push(novaFonte({}), novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null }));

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(TIPOS_DA_COLETA_DA_RODADA).toContain('busca');
    expect(r).toEqual({ novas: 3, fontes: 2, erros: 0, puladas: 0 });
    expect(m.capturas.filter((c) => c.fonteId === 'f-busca')).toHaveLength(2);
  });

  it('teto estourado não derruba a rodada: o feed entra, a busca é pulada com aviso', async () => {
    const m = montar();
    const busca = novaFonte({ tetoRunsMes: 1, runsNoMes: 1, mesReferente: mesAtual() });
    m.fontes.push(busca, novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null }));

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(r).toEqual({ novas: 1, fontes: 2, erros: 0, puladas: 1 });
    expect(m.chamadas).toHaveLength(0);
    expect(busca.ultimoErro).toMatch(/Teto de 1 execuções\/mês/);
  });

  it('a busca salva de antes do MC3, sem consulta, é pulada com aviso e não suja a conta de erros', async () => {
    const m = montar();
    const antiga = novaFonte({ id: 'f-antiga', handle: null, plataforma: null });
    m.fontes.push(antiga, novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null }));

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(r).toEqual({ novas: 1, fontes: 2, erros: 0, puladas: 1 });
    expect(m.chamadas).toHaveLength(0);
    expect(antiga).toMatchObject({ runsNoMes: 0, ultimaLeitura: null, ultimoErro: expect.stringMatching(/sem consulta/) });
  });

  it('a curadoria da rodada manda ao prompt a mesma matéria uma vez só, vinda do feed e da busca', async () => {
    const hora = (h: number) => new Date(Date.now() - h * 3_600_000);
    const capturas = [
      { id: 'c1', titulo: 'IA nas PMEs', url: 'https://infomoney.com.br/negocios/ia-pmes', bruto: {}, capturadoEm: hora(1), fonte: { nome: 'IA para PMEs' } },
      { id: 'c2', titulo: 'IA nas PMEs', url: 'https://www.infomoney.com.br/negocios/ia-pmes/', bruto: {}, capturadoEm: hora(2), fonte: { nome: 'InfoMoney' } },
      { id: 'c3', titulo: 'Outra', url: 'https://outra.exemplo/1', bruto: {}, capturadoEm: hora(3), fonte: { nome: 'InfoMoney' } },
      { id: 'c4', titulo: 'Mais uma', url: 'https://mais.exemplo/2', bruto: {}, capturadoEm: hora(4), fonte: { nome: 'InfoMoney' } },
    ];
    const prompts: string[] = [];
    const prisma = {
      pautaCaptura: { findMany: async () => capturas },
      pautaReferencia: { findMany: async () => [] },
      pautaRodada: {
        create: async () => ({ id: 'rodada-1', titulo: 'Rodada' }),
        update: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rodada-1', ...data }),
      },
      auditLog: { create: async ({ data }: { data: unknown }) => data },
    } as unknown as PrismaService;
    const llm = {
      name: 'falso',
      model: 'falso',
      configured: true,
      complete: async ({ user }: { user: string }) => {
        prompts.push(user);
        return JSON.stringify({ titulo: 'T', itens: [{ titulo: 'IA nas PMEs', url: capturas[0].url }], corpo: '' });
      },
    } as unknown as LlmProvider;
    const rodadas = new RodadaService(prisma, new AuditService(prisma), {} as never, llm);

    await rodadas.gerar(ORG, PESSOA);

    expect(prompts).toHaveLength(1);
    expect(prompts[0].match(/IA nas PMEs/g)).toHaveLength(1);
    expect(prompts[0]).toContain('[3] Mais uma');
  });

  it('cadastrar a busca grava a consulta em uma linha no handle, sem url, plataforma google', async () => {
    const m = montar();
    await m.svc.criarFonte(ORG, PESSOA, {
      tipo: 'busca', nome: 'IA', handle: ' agentes de IA\n PMEs ', url: 'https://ignorada.exemplo',
      ativo: true, intervaloMin: 720, tetoRunsMes: 8,
    });
    expect(m.fontes[0]).toMatchObject({ tipo: 'busca', handle: 'agentes de IA PMEs', url: null, plataforma: 'google', tetoRunsMes: 8 });
    expect(m.auditoria[0]).toMatchObject({ action: 'pauta.fonte_criada', after: { consulta: 'agentes de IA PMEs' } });
  });

  it('cadastro recusa consulta vazia ou URL; trocar a consulta passa pela mesma validação', async () => {
    const m = montar();
    const base = { tipo: 'busca' as const, nome: 'IA', ativo: true, intervaloMin: 720, tetoRunsMes: 30 };
    await expect(m.svc.criarFonte(ORG, PESSOA, { ...base, handle: '' })).rejects.toThrow(/exige a consulta/);
    await expect(m.svc.criarFonte(ORG, PESSOA, { ...base, handle: 'https://google.com/search?q=ia' })).rejects.toThrow(
      /não um endereço/,
    );

    m.fontes.push(novaFonte({}));
    await expect(m.svc.atualizarFonte(ORG, 'f-busca', PESSOA, { handle: 'www.exemplo.com' })).rejects.toThrow(/não um endereço/);
    await m.svc.atualizarFonte(ORG, 'f-busca', PESSOA, { handle: 'modelos   abertos' });
    expect(m.fontes[0].handle).toBe('modelos abertos');
  });

  it('sair da busca sem mandar handle não leva a consulta para o @perfil; a plataforma google sai junto', async () => {
    const m = montar();
    m.fontes.push(novaFonte({ handle: 'x'.repeat(61) }));
    await expect(m.svc.atualizarFonte(ORG, 'f-busca', PESSOA, { tipo: 'perfil' })).rejects.toThrow(/no máximo 60/);
    expect(m.fontes[0].tipo).toBe('busca');

    await m.svc.atualizarFonte(ORG, 'f-busca', PESSOA, { tipo: 'perfil', handle: 'alguem' });
    expect(m.fontes[0]).toMatchObject({ tipo: 'perfil', handle: 'alguem', plataforma: null });
  });

  it('o teto maior do handle é só da busca: perfil com handle comprido é recusado', async () => {
    const m = montar();
    await expect(
      m.svc.criarFonte(ORG, PESSOA, {
        tipo: 'perfil', nome: 'P', handle: 'x'.repeat(61), ativo: true, intervaloMin: 720, tetoRunsMes: 30,
      }),
    ).rejects.toThrow(/no máximo 60/);
    expect(m.fontes).toHaveLength(0);
  });
});
