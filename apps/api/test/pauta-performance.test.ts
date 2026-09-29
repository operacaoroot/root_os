import { beforeAll, describe, expect, it } from 'vitest';
import {
  PAUTA_PISO_DE_POSTS_DO_INDICE,
  chaveDaPerformance,
  mesDaChaveDaPerformance,
  chaveDaEstrategia,
} from '@mktos/shared';
import { comoConectar, montarSnapshot, type PostParaMedir } from '../src/pauta/performance-da-pauta';
import { PerformanceService } from '../src/pauta/performance.service';
import type { GraphDeInsights } from '../src/pauta/graph-de-insights';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';

/*
 * MK5 — a performance da casa. A régua é a MESMA da MK2: a mediana do próprio
 * perfil e o índice de cada post contra ela. O que esta suíte guarda, além
 * disso: post sem número NÃO some da lista, e sem Instagram conectado a tela
 * instrui em vez de estourar.
 */

const ORG = 'org-1';
const PESSOA = 'user-1';
const MES = '2026-09';
const COLETADO = new Date('2026-10-01T09:00:00.000Z');

const numeros = (n: number) => ({
  visualizacoes: n * 1000,
  curtidas: n * 100,
  comentarios: n * 10,
  salvamentos: n * 5,
  compartilhamentos: n,
});

function post(n: number, extras: Partial<PostParaMedir> = {}): PostParaMedir {
  return {
    pecaId: `p${n}`,
    titulo: `Post ${n}`,
    formato: 'carrossel',
    publicadaEm: `2026-09-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    urlPublicada: `https://instagram.com/p/${n}`,
    externalId: `ig-${n}`,
    numeros: numeros(n),
    erro: null,
    ...extras,
  };
}

// ---------------------------------------------------------------------------

describe('o snapshot do mês', () => {
  const seis = [1, 2, 3, 4, 5, 6].map((n) => post(n));

  it('mede cada post contra a mediana da própria casa e ordena do que mais rendeu', () => {
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: 4200, posts: seis });
    expect(s.metricaDeReferencia).toBe('visualizacoes');
    expect(s.medianas.visualizacoes).toBe(3500);
    expect(s.posts[0].titulo).toBe('Post 6');
    expect(s.posts[0].indices.visualizacoes).toBe(1.71);
    expect(s.seguidores).toBe(4200);
    expect(s.medidos).toBe(6);
    expect(s.publicados).toBe(6);
  });

  it('guarda QUANDO a fotografia foi tirada — é o que torna dois meses comparáveis', () => {
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: seis });
    expect(s.coletadoEm).toBe('2026-10-01T09:00:00.000Z');
  });

  it(`com menos de ${PAUTA_PISO_DE_POSTS_DO_INDICE} medidos, o índice não aparece`, () => {
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: seis.slice(0, 3) });
    expect(s.metricaDeReferencia).toBeNull();
    expect(s.posts.every((p) => p.indices.visualizacoes === null)).toBe(true);
    expect(s.avisos[0]).toContain(`a partir de ${PAUTA_PISO_DE_POSTS_DO_INDICE}`);
  });

  it('post SEM número fica na lista, com o motivo, e vai para o fim', () => {
    const comFalha = [...seis, post(7, { numeros: null, erro: 'A Graph recusou este post: 400' })];
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: comFalha });
    expect(s.publicados).toBe(7);
    expect(s.medidos).toBe(6);
    const sem = s.posts.find((p) => p.pecaId === 'p7')!;
    expect(sem.semNumero).toContain('A Graph recusou');
    expect(s.posts[s.posts.length - 1].pecaId).toBe('p7');
    expect(s.avisos.some((a) => a.includes('1 post(s) sem número'))).toBe(true);
  });

  it('post publicado à mão, sem id na rede, diz isso em vez de "erro"', () => {
    const s = montarSnapshot({
      mes: MES,
      coletadoEm: COLETADO,
      seguidores: null,
      posts: [...seis, post(7, { externalId: null, numeros: null })],
    });
    expect(s.posts.find((p) => p.pecaId === 'p7')!.semNumero).toContain('Publicada à mão');
  });

  it('mês sem peça publicada, e mês em que nada trouxe número, dizem cada um o seu', () => {
    expect(montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: [] }).avisos[0]).toContain(
      'Nenhuma peça publicada',
    );
    const mudos = seis.map((p) => ({ ...p, numeros: null }));
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: mudos });
    expect(s.avisos[0]).toContain('Nenhum post trouxe número');
    expect(s.metricaDeReferencia).toBeNull();
  });

  it('um viral não move a régua: ele estoura e o resto segue na média', () => {
    const comViral = [...seis, post(7, { numeros: { ...numeros(1), visualizacoes: 500_000 } })];
    const s = montarSnapshot({ mes: MES, coletadoEm: COLETADO, seguidores: null, posts: comViral });
    expect(s.posts[0].faixa).toBe('estourou');
    expect(s.posts.filter((p) => p.faixa === 'na-media').length).toBeGreaterThan(0);
  });

  it('a chave do mês vai e volta, e não se confunde com a da estratégia', () => {
    expect(mesDaChaveDaPerformance(chaveDaPerformance(MES))).toBe(MES);
    expect(mesDaChaveDaPerformance(chaveDaEstrategia(MES))).toBeNull();
  });
});

describe('sem Instagram conectado, a tela instrui', () => {
  it('diz onde conectar, e não devolve erro', () => {
    const texto = comoConectar(null);
    expect(texto).toContain('não está conectado');
    expect(texto).toContain('aba Semana');
  });

  it('com conta conectada, não há o que instruir', () => {
    expect(comoConectar({ externalId: 'ig-1', escopos: ['instagram_business_basic'] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

function montar(opts: { conectado?: boolean; leitura?: unknown; retida?: boolean; falhaNoPost?: boolean } = {}) {
  const pedidos: Array<Record<string, unknown>> = [];
  const notas = new Map<string, { id: string; chave: string; body: string; arquivadoEm: null }>();

  const pecas = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `p${n}`,
    titulo: `Post ${n}`,
    formato: 'carrossel',
    publicadaEm: new Date(`2026-09-0${n}T12:00:00.000Z`),
    urlPublicada: `https://instagram.com/p/${n}`,
    externalId: `ig-${n}`,
  }));

  const prisma = {
    pautaPeca: { findMany: async () => pecas },
    bioConexao: {
      findFirst: async () =>
        opts.conectado === false
          ? null
          : { externalId: 'ig-conta', handle: '@root', escopos: 'instagram_business_basic', status: 'ativa', tokenCifrado: 'x.y.z' },
    },
    auditLog: { create: async () => ({}) },
  } as unknown as PrismaService;

  const memoria = {
    porChave: async (_o: string, c: string) => notas.get(c) ?? null,
    listar: async () => ({ itens: [...notas.values()], total: notas.size, comVetor: 0 }),
    criar: async (_o: string, e: Record<string, unknown>) => {
      const n = { id: 'n1', chave: String(e.chave), body: String(e.body), arquivadoEm: null as null };
      notas.set(n.chave, n);
      return n;
    },
    alterar: async (_o: string, _id: string, e: Record<string, unknown>) => {
      const n = [...notas.values()][0];
      n.body = String(e.body);
      return n;
    },
  } as unknown as MemoriaService;

  const efeitosInscritos: string[] = [];
  const efeitos = {
    registrar: (mapa: Record<string, unknown>) => efeitosInscritos.push(...Object.keys(mapa)),
  } as unknown as EfeitosRegistry;

  const porta = {
    executar: async (p: Record<string, unknown>) => {
      pedidos.push(p);
      if (opts.retida) return { status: 'aguardando_aprovacao' };
      return (
        opts.leitura ?? {
          seguidores: 4200,
          numeros: pecas.map((p, i) => ({
            externalId: p.externalId,
            ...numeros(i + 1),
            erro: opts.falhaNoPost && i === 0 ? 'A Graph recusou este post: 400' : null,
          })),
        }
      );
    },
  } as unknown as PortaDoOperador;

  const chamadasGraph: string[] = [];
  const graph: GraphDeInsights = {
    seguidores: async () => {
      chamadasGraph.push('seguidores');
      return 4200;
    },
    numerosDo: async (_t: string, id: string) => {
      chamadasGraph.push(id);
      return { externalId: id, ...numeros(1) };
    },
  };

  const audit = { log: async () => ({}) } as unknown as AuditService;
  return {
    pedidos,
    notas,
    efeitosInscritos,
    chamadasGraph,
    graph,
    svc: new PerformanceService(prisma, audit, memoria, efeitos, porta, graph),
  };
}

describe('o serviço: coletar com dublê da Meta', () => {
  it('inscreve o efeito da capacidade de leitura, e não a dispara direto', () => {
    const { svc, efeitosInscritos } = montar();
    svc.onModuleInit();
    expect(efeitosInscritos).toEqual(['social.instagram.midia']);
  });

  it('a leitura vai PELA PORTA, com a capacidade e os ids dos posts', async () => {
    const { svc, pedidos } = montar();
    await svc.coletar(ORG, PESSOA, MES);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].capabilityId).toBe('social.instagram.midia');
    expect(pedidos[0].orgId).toBe(ORG);
    expect((pedidos[0].args as { midiaIds: string[] }).midiaIds).toHaveLength(6);
  });

  it('o snapshot fica gravado na nota do mês e volta no painel', async () => {
    const { svc, notas } = montar();
    const p = await svc.coletar(ORG, PESSOA, MES);
    expect([...notas.keys()]).toEqual([chaveDaPerformance(MES)]);
    expect(p.snapshot?.medidos).toBe(6);
    expect(p.snapshot?.seguidores).toBe(4200);
    expect(p.snapshot?.metricaDeReferencia).toBe('visualizacoes');
    expect(p.meses).toEqual([MES]);
  });

  it('um post que a Graph recusa não derruba o mês', async () => {
    const { svc } = montar({ falhaNoPost: true });
    const p = await svc.coletar(ORG, PESSOA, MES);
    expect(p.snapshot?.publicados).toBe(6);
    expect(p.snapshot?.medidos).toBe(5);
    expect(p.snapshot?.posts.some((x) => x.semNumero?.includes('recusou'))).toBe(true);
  });

  it('sem conta conectada, coletar recusa com a instrução — e o painel também', async () => {
    const { svc, pedidos } = montar({ conectado: false });
    await expect(svc.coletar(ORG, PESSOA, MES)).rejects.toThrow(/não está conectado/);
    expect(pedidos).toHaveLength(0);
    const p = await svc.painel(ORG, MES);
    expect(p.conectado).toBe(false);
    expect(p.comoConectar).toContain('aba Semana');
    expect(p.snapshot).toBeNull();
  });

  it('porta que retém a leitura não grava snapshot pela metade', async () => {
    const { svc, notas } = montar({ retida: true });
    await expect(svc.coletar(ORG, PESSOA, MES)).rejects.toThrow(/reteve/);
    expect(notas.size).toBe(0);
  });
});

describe('o efeito, com o dublê da Graph', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('lê os seguidores e cada post, e a falha de um vira motivo na linha dele', async () => {
    const { svc, graph, chamadasGraph } = montar();
    // O efeito é privado de propósito (só a porta o dispara); aqui ele é
    // alcançado pelo mapa que o serviço inscreve, que é o mesmo caminho.
    const capturado: Record<string, (a: Record<string, unknown>, org: string) => Promise<unknown>> = {};
    (svc as unknown as { efeitos: { registrar: unknown } }).efeitos = {
      registrar: (m: Record<string, (a: Record<string, unknown>, o: string) => Promise<unknown>>) =>
        Object.assign(capturado, m),
    };
    svc.onModuleInit();

    const { cifrar } = await import('../src/common/crypto');
    const prisma = (svc as unknown as { prisma: { bioConexao: { findFirst: () => Promise<unknown> } } }).prisma;
    prisma.bioConexao.findFirst = async () => ({
      externalId: 'ig-conta',
      handle: '@root',
      escopos: 'instagram_business_basic',
      status: 'ativa',
      tokenCifrado: cifrar('token-de-teste'),
    });

    const r = (await capturado['social.instagram.midia']({ midiaIds: ['ig-1', 'ig-2'] }, ORG)) as {
      seguidores: number | null;
      numeros: Array<{ externalId: string; erro: string | null }>;
    };
    expect(r.seguidores).toBe(4200);
    expect(r.numeros.map((n) => n.externalId)).toEqual(['ig-1', 'ig-2']);
    expect(chamadasGraph).toEqual(['seguidores', 'ig-1', 'ig-2']);
    expect(graph).toBeDefined();
  });
});
