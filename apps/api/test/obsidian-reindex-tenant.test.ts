import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorType, ContextSource, PrismaClient } from '@prisma/client';
import { comContexto } from '../src/common/contexto-execucao';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { ObsidianController } from '../src/obsidian/obsidian.controller';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ROOT-05c — A REINDEXAÇÃO DA VAULT, PONTA A PONTA, COM A EMPRESA DA CASA DE VERDADE.
 *
 *   · C2: só a empresa da casa reindexa. Outra empresa, com `obsidian.editar` e
 *     `admin.usuarios`, ouve 403 pelas DUAS portas (`POST /knowledge/reindex` e
 *     o verbo `sincronizar` de `/integrations/obsidian/sincronizacao`), com o
 *     fornecedor fora do ar ou no ar, e não recebe nota nenhuma da vault no
 *     índice nem na memória. O que já era dela (o espelho do onboarding) fica,
 *     e continua achável por texto. A casa segue reindexando pelas mesmas portas.
 *   · R2: numa volta em que um lote do índice falha, a fila genérica da memória
 *     não paga de novo as notas da vault (sonda S3 da ROOT-05ab-REV: eram 35 de
 *     60); a nota digitada na tela é vetorizada na mesma volta; a nota que ficou
 *     sem vetor recebe o do índice na volta seguinte.
 *   · V1 pela vault (sonda S1): nota editada numa volta com o fornecedor em 503
 *     fica sem vetor em vez de ficar com o do texto velho, e a volta seguinte
 *     lhe dá o vetor do texto atual.
 *
 * A EMPRESA DA CASA É A DO SLUG `root`, ÚNICO NO BANCO, e outras suítes também
 * a usam (a das rotas públicas cria a `root` quando ela falta, e as de onboarding
 * gravam nela). Esta suíte acha ou cria a casa, nunca a apaga, e deixa todo dado
 * seu sob o prefixo `r05c-`; recusa rodar se a casa já tiver índice ou memória de
 * outra origem, porque a reindexação substituiria o índice dela.
 *
 * Serviço real (`ObsidianService`, `MemoriaService`, `IntegrationsService`,
 * `ObsidianController`) contra Postgres com pgvector. Fixtures: a vault é uma
 * pasta temporária, o fornecedor é um dublê de `fetch`, e o interruptor de
 * conector e a auditoria de `IntegrationsService` são dublês que deixam passar.
 * A URL do fornecedor aponta para uma porta fechada em 127.0.0.1.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (a empresa da casa, índice da vault, memória e rastro)');

/** O slug de `SLUG_DA_CASA` em `obsidian.service.ts`; o primeiro caso confere. */
const SLUG_DA_CASA = 'root';
const PREFIXO = 'r05c-';
const DIM = 1536;
/**
 * Prazo por caso e por gancho. A suíte inteira roda em paralelo no mesmo banco: sob carga, o caso
 * das 60 notas passou dos 5 s padrão e o `beforeAll` dos 10 s. O caso que estoura continua rodando
 * por trás do seguinte e mexe na mesma casa.
 */
const TEMPO = 60_000;
const MARCA = `${PREFIXO}${randomUUID().slice(0, 8)}`;
const B = `org-reindex-b-${MARCA}`;
const T0 = new Date('2026-09-30T12:00:00Z');
const T1 = new Date('2026-10-01T12:00:00Z');
const VARIAVEIS = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OBSIDIAN_FONTE', 'OBSIDIAN_VAULT_PATH'] as const;
const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};
const pastas: string[] = [];

function vetorDe(texto: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: DIM }, (_, i) => (((h >>> (i % 24)) + i * 7) % 997) / 1024);
}

function mesmo(a: number[] | null, b: number[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
}

/** O fornecedor: `plano(n)` devolve o status do pedido n (1, 2, …); nulo é 200. */
function fornecedor(plano: (n: number) => number | null = () => null) {
  const pedidos: Array<{ n: number; status: number; textos: string[] }> = [];
  const buscar = async (entrada: Parameters<typeof fetch>[0], opcoes?: Parameters<typeof fetch>[1]) => {
    const textos = ((await new Request(entrada, opcoes).json()) as { input: string[] }).input;
    const n = pedidos.length + 1;
    const status = plano(n) ?? 200;
    pedidos.push({ n, status, textos });
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'falha programada' } }), { status });
    return new Response(JSON.stringify({ data: textos.map((t, index) => ({ index, embedding: vetorDe(t) })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { pedidos, buscar };
}

function escrever(raiz: string, nota: { caminho: string; texto: string; mtime: Date }) {
  const arquivo = path.join(raiz, nota.caminho);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, nota.texto);
  utimesSync(arquivo, nota.mtime, nota.mtime);
}

/** Uma vault temporária com as notas em `r05c-<marca>/`, apontada pelo ambiente. */
function criarVault(notas: Array<{ nome: string; texto: string; mtime?: Date }>) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'r05c-vault-'));
  pastas.push(raiz);
  for (const n of notas) escrever(raiz, { caminho: `${MARCA}/${n.nome}`, texto: n.texto, mtime: n.mtime ?? T0 });
  process.env.OBSIDIAN_VAULT_PATH = raiz;
  return {
    raiz,
    editar: (nome: string, texto: string, mtime: Date) => escrever(raiz, { caminho: `${MARCA}/${nome}`, texto, mtime }),
  };
}

async function desfecho<T>(p: Promise<T>): Promise<{ ok: T } | { erro: string; status?: number }> {
  return p.then(
    (ok) => ({ ok }),
    (e: { message: string; getStatus?: () => number }) => ({ erro: e.message, status: e.getStatus?.() }),
  );
}

beforeEach(() => {
  for (const v of VARIAVEIS) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
  process.env.OPENAI_API_KEY = 'sk-teste-nao-e-chave';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const v of VARIAVEIS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe.skipIf(!URL)('reindexar a vault: só a casa, uma vez por texto, vetor do texto atual', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;
  let CASA = '';

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto(
      { orgId, actorType: ActorType.user, actorId: `pessoa-${orgId}`, correlationId: `r05c-${MARCA}`, origem: 'script' },
      fn,
    );

  /** O serviço com o contrato, a rota `/knowledge` e a rota `/integrations` de verdade em volta. */
  function montar() {
    const contrato = new RegistroDeConectores();
    vi.spyOn(contrato['log'], 'log').mockImplementation(() => undefined);
    const svc = new ObsidianService(prisma as never, new ConectoresConfiguradosRegistry(), contrato, memoria as never);
    vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);
    vi.spyOn(svc['log'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(memoria['log'], 'warn').mockImplementation(() => undefined);
    // Sem `onModuleInit`, que agendaria o relógio de 30 min; o descritor é registrado à mão.
    contrato.registrar(
      (svc as unknown as { descritorDoContrato(): Parameters<RegistroDeConectores['registrar']>[0] }).descritorDoContrato(),
      'ObsidianService',
    );
    const integracoes = new IntegrationsService(
      prisma as never,
      { log: async () => undefined } as never,
      { exigirLigado: async () => undefined, desligados: async () => new Map() } as never,
      new ConectoresConfiguradosRegistry(),
      contrato,
    );
    const rota = new ObsidianController(svc);
    const pessoa = (orgId: string): JwtUser => ({
      sub: `pessoa-${orgId}`,
      orgId,
      email: `admin@${orgId}.local`,
      name: 'Admin',
      roles: ['admin_master'],
      permissions: ['admin.usuarios', 'obsidian.editar', 'obsidian.ver'],
    });
    const portas = {
      knowledge: (orgId: string) => naEmpresa(orgId, () => rota.reindex(pessoa(orgId))),
      sincronizacao: (orgId: string) =>
        naEmpresa(orgId, () => integracoes.sincronizar(orgId, 'obsidian', `pessoa-${orgId}`, pessoa(orgId).permissions)),
    };
    return { svc, portas };
  }

  const vetorNoBanco = async (tabela: 'ContextItem' | 'KnowledgeNote', id: string): Promise<number[] | null> => {
    const [l] = await prisma.$queryRawUnsafe<Array<{ v: string | null }>>(
      `SELECT embedding::text AS v FROM "${tabela}" WHERE id = $1`,
      id,
    );
    return l?.v ? l.v.replace(/^\[|\]$/g, '').split(',').map(Number) : null;
  };

  const itemDaVault = (nome: string) =>
    prisma.contextItem.findFirstOrThrow({ where: { orgId: CASA, sourceRef: `${MARCA}/${nome}` } });

  /** O que a empresa B tem, para comparar antes e depois. */
  async function retratoDeB() {
    const [notas, itens, versoes] = await Promise.all([
      prisma.knowledgeNote.findMany({ where: { orgId: B }, select: { path: true, content: true }, orderBy: { path: 'asc' } }),
      prisma.contextItem.findMany({ where: { orgId: B }, select: { chave: true, body: true, versao: true }, orderBy: { chave: 'asc' } }),
      prisma.contextItemVersion.count({ where: { orgId: B } }),
    ]);
    return { notas, itens, versoes };
  }

  async function limpar() {
    await prisma.knowledgeNote.deleteMany({ where: { orgId: CASA, path: { startsWith: PREFIXO } } });
    await prisma.contextItem.deleteMany({
      where: { orgId: CASA, OR: [{ chave: { startsWith: `vault:${PREFIXO}` } }, { chave: { startsWith: PREFIXO } }] },
    });
    await prisma.knowledgeNote.deleteMany({ where: { orgId: B } });
    await prisma.contextItem.deleteMany({ where: { orgId: B } });
  }

  /** O que B já tinha antes de qualquer reindexação: o espelho do onboarding, no índice e na memória. */
  async function espelhoDoOnboardingEmB() {
    await prisma.knowledgeNote.create({
      data: {
        orgId: B, path: 'onboarding/tema-1.md', folder: 'onboarding', title: 'Tema 1', tags: [],
        content: 'ritual de fechamento do cliente', links: [], wordCount: 5, fileTime: T0,
      },
    });
    await naEmpresa(B, () =>
      memoria.criar(B, {
        chave: `onboarding:${MARCA}`, title: 'Tema 1', body: 'ritual de fechamento do cliente',
        sourceType: ContextSource.operador, sourceRef: 'onboarding',
      }),
    );
  }

  /** A casa que existe, ou uma nova. Outra suíte pode criá-la no mesmo instante, e aí vale a dela. */
  async function acharOuCriarACasa(): Promise<string> {
    const achar = () => prisma.org.findUnique({ where: { slug: SLUG_DA_CASA }, select: { id: true } });
    const existente = await achar();
    if (existente) return existente.id;
    try {
      return (await prisma.org.create({ data: { name: 'Casa (suíte ROOT-05c)', slug: SLUG_DA_CASA }, select: { id: true } })).id;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return (await achar())!.id;
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    CASA = await acharOuCriarACasa();
    const deOutraOrigem =
      (await prisma.knowledgeNote.count({ where: { orgId: CASA, NOT: { path: { startsWith: PREFIXO } } } })) +
      (await prisma.contextItem.count({
        where: { orgId: CASA, NOT: [{ chave: { startsWith: `vault:${PREFIXO}` } }, { chave: { startsWith: PREFIXO } }] },
      }));
    if (deOutraOrigem) {
      throw new Error(
        `A empresa "${SLUG_DA_CASA}" deste banco tem ${deOutraOrigem} linha(s) de índice ou memória que não são desta ` +
          'suíte, e reindexar a casa substituiria o índice dela. Rode contra um banco descartável sem essa casa.',
      );
    }
    await prisma.org.upsert({ where: { id: B }, create: { id: B, name: `Cliente ${MARCA}`, slug: `cliente-${MARCA}` }, update: {} });
    memoria = new MemoriaService(prisma as unknown as PrismaService, new EventLogService(prisma as never));
  }, TEMPO);

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.$disconnect();
  }, TEMPO);

  beforeEach(async () => {
    await limpar();
  }, TEMPO);

  // -------------------------------------------------------------------------
  // C2
  // -------------------------------------------------------------------------

  it('C2: o slug da casa desta suíte é o do serviço', () => {
    const fonte = readFileSync(path.join(__dirname, '..', 'src', 'obsidian', 'obsidian.service.ts'), 'utf8');
    expect(fonte).toContain(`const SLUG_DA_CASA = '${SLUG_DA_CASA}';`);
  });

  for (const cenario of [
    { nome: 'fornecedor em 503', plano: () => 503 },
    { nome: 'fornecedor no ar', plano: () => null },
  ]) {
    it(`C2, ${cenario.nome}: outra empresa com obsidian.editar e admin.usuarios ouve 403 nas duas portas e não recebe nada da vault`, async () => {
      criarVault([
        { nome: 'regra-da-casa.md', texto: '# Regra da casa\n\nritual de fechamento da casa' },
        { nome: 'preco.md', texto: '# Preço\n\nmargem mínima da casa' },
      ]);
      await espelhoDoOnboardingEmB();
      const antes = await retratoDeB();
      const dublê = fornecedor(cenario.plano);
      vi.stubGlobal('fetch', dublê.buscar);
      const { svc, portas } = montar();

      const respostas = {
        knowledge: await desfecho(portas.knowledge(B)),
        sincronizacao: await desfecho(portas.sincronizacao(B)),
        direto: await desfecho(naEmpresa(B, () => svc.reindex(B))),
        completo: await desfecho(naEmpresa(B, () => svc.reindex(B, true))),
      };
      const pedidosDaVault = dublê.pedidos.length;
      const textoDeB = await naEmpresa(B, () => memoria.buscar(B, 'ritual de fechamento'));
      const indiceDeB = await naEmpresa(B, () => svc.search(B, 'ritual de fechamento', 8));

      expect({
        status: Object.values(respostas).map((r) => ('erro' in r ? r.status : 'passou')),
        pedidosDaVault,
        depois: await retratoDeB(),
        notasDaCasaNoIndiceDeB: await prisma.knowledgeNote.count({ where: { orgId: B, path: { startsWith: MARCA } } }),
        itensDaVaultEmB: await prisma.contextItem.count({ where: { orgId: B, sourceType: ContextSource.vault } }),
        memoriaDeBPorTexto: textoDeB.itens.map((i) => i.body),
        indiceDeBPorTexto: indiceDeB.items.map((i) => i.path),
      }).toEqual({
        status: [403, 403, 403, 403],
        pedidosDaVault: 0,
        depois: antes,
        notasDaCasaNoIndiceDeB: 0,
        itensDaVaultEmB: 0,
        memoriaDeBPorTexto: ['ritual de fechamento do cliente'],
        indiceDeBPorTexto: ['onboarding/tema-1.md'],
      });
      expect(respostas.knowledge).toMatchObject({ erro: expect.stringMatching(/empresa da casa, e só ela reindexa/) });
    }, TEMPO);
  }

  it('C2: a casa continua reindexando pelas duas portas, e com o fornecedor em 503 a projeção acontece e o recibo diz que faltou vetor', async () => {
    criarVault([{ nome: 'regra.md', texto: '# Regra\n\nregra da casa' }]);
    await espelhoDoOnboardingEmB();
    const antesDeB = await retratoDeB();
    let foraDoAr = true;
    const dublê = fornecedor(() => (foraDoAr ? 503 : null));
    vi.stubGlobal('fetch', dublê.buscar);
    const { portas } = montar();

    const comFornecedorFora = await desfecho(portas.knowledge(CASA));
    const itensDepoisDaFalha = await prisma.contextItem.count({ where: { orgId: CASA, chave: { startsWith: `vault:${MARCA}` } } });
    foraDoAr = false;
    const pelaRota = await desfecho(portas.knowledge(CASA));
    const peloContrato = await desfecho(portas.sincronizacao(CASA));

    expect({
      comFornecedorFora: 'erro' in comFornecedorFora ? comFornecedorFora.status : 'passou',
      itensDepoisDaFalha,
      pelaRota,
      peloContrato: 'ok' in peloContrato ? peloContrato.ok : peloContrato,
      indiceDaCasa: await prisma.knowledgeNote.count({ where: { orgId: CASA, path: { startsWith: MARCA } } }),
      itemComVetor: (await vetorNoBanco('ContextItem', (await itemDaVault('regra.md')).id)) !== null,
      pedidos: dublê.pedidos.map((p) => `${p.n}:${p.status}:${p.textos.length}`),
      b: await retratoDeB(),
    }).toEqual({
      comFornecedorFora: 503,
      itensDepoisDaFalha: 1,
      pelaRota: { ok: { ok: true, notes: 1 } },
      peloContrato: expect.objectContaining({ tipo: 'feito', numeros: { notas: 1 } }),
      indiceDaCasa: 1,
      itemComVetor: true,
      pedidos: ['1:503:1', '2:200:1'],
      b: antesDeB,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // R2
  // -------------------------------------------------------------------------

  it('R2 (sonda S3): lote do índice falhando não faz a fila da memória pagar a vault de novo, e nada fica abandonado', async () => {
    criarVault(
      Array.from({ length: 60 }, (_, i) => ({
        nome: `fixa-${String(i).padStart(3, '0')}.md`,
        texto: `# Fixa ${i}\n\n${'x'.repeat(7_900)}`,
      })),
    );
    // A nota digitada na tela, que só a fila da memória vetoriza.
    const daTela = await naEmpresa(CASA, () =>
      memoria.criar(CASA, {
        chave: `${MARCA}/tela`, title: 'Nota da tela', body: 'regra digitada na tela',
        sourceType: ContextSource.operador,
      }),
    );
    const dublê = fornecedor((n) => (n === 2 ? 500 : null));
    vi.stubGlobal('fetch', dublê.buscar);
    const { svc } = montar();

    const v1 = await desfecho(naEmpresa(CASA, () => svc.reindex(CASA)));
    const pedidosDaVolta1 = dublê.pedidos.length;
    const v2 = await desfecho(naEmpresa(CASA, () => svc.reindex(CASA)));
    const pagos = dublê.pedidos.filter((p) => p.status === 200).flatMap((p) => p.textos);
    const vezes = new Map<string, number>();
    for (const t of pagos) vezes.set(t, (vezes.get(t) ?? 0) + 1);
    const daVault = await prisma.contextItem.findMany({
      where: { orgId: CASA, chave: { startsWith: `vault:${MARCA}` } },
      select: { id: true },
    });
    const vaultComVetor = (await Promise.all(daVault.map((i) => vetorNoBanco('ContextItem', i.id)))).filter(Boolean).length;

    expect({
      voltas: ['ok' in v1, 'ok' in v2],
      pedidos: dublê.pedidos.map((p) => `${p.n}:${p.status}:${p.textos.length}`),
      pedidosDaVolta1,
      textosPagos: pagos.length,
      textosDistintos: vezes.size,
      pagosDuasVezes: [...vezes.values()].filter((n) => n > 1).length,
      daTelaNaVolta1: dublê.pedidos[2]?.textos.map((t) => t.split('\n\n')[1]),
      daTelaComVetor: mesmo(await vetorNoBanco('ContextItem', daTela.id), vetorDe('Nota da tela\n\nregra digitada na tela')),
      itensDaVault: daVault.length,
      vaultComVetor,
    }).toEqual({
      voltas: [false, true],
      pedidos: ['1:200:25', '2:500:25', '3:200:1', '4:200:25', '5:200:10'],
      pedidosDaVolta1: 3,
      textosPagos: 61,
      textosDistintos: 61,
      pagosDuasVezes: 0,
      daTelaNaVolta1: ['regra digitada na tela'],
      daTelaComVetor: true,
      itensDaVault: 60,
      vaultComVetor: 60,
    });
  }, TEMPO);

  it('R2: fora da volta da casa a fila da memória continua alcançando item de origem vault (o da cópia antiga em outra empresa)', async () => {
    // Antes da guarda da C2, a reindexação por outra empresa deixava itens de origem vault na memória dela.
    const copiaAntiga = await naEmpresa(B, () =>
      memoria.criar(B, {
        chave: `vault:${MARCA}/copia-antiga.md`, title: 'Cópia antiga', body: 'nota da casa copiada antes da guarda',
        sourceType: ContextSource.vault, sourceRef: `${MARCA}/copia-antiga.md`,
      }),
    );
    const dublê = fornecedor();
    vi.stubGlobal('fetch', dublê.buscar);
    const { svc } = montar();

    await naEmpresa(B, () => svc.vetorizarPendentesDaMemoria(B));

    expect({
      pedidos: dublê.pedidos.map((p) => p.textos.length),
      comVetor: mesmo(
        await vetorNoBanco('ContextItem', copiaAntiga.id),
        vetorDe('Cópia antiga\n\nnota da casa copiada antes da guarda'),
      ),
    }).toEqual({ pedidos: [1], comVetor: true });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // V1 pela vault
  // -------------------------------------------------------------------------

  it('V1 (sonda S1): nota editada numa volta com o fornecedor em 503 fica sem vetor, e a volta seguinte lhe dá o do texto atual', async () => {
    const vault = criarVault([
      { nome: 'a.md', texto: '# Nota A\n\nTEXTO ANTIGO sobre régua de cobrança.' },
      { nome: 'b.md', texto: '# Nota B\n\nOutra nota que não muda.' },
    ]);
    await espelhoDoOnboardingEmB();
    const antesDeB = await retratoDeB();
    let foraDoAr = false;
    const dublê = fornecedor(() => (foraDoAr ? 503 : null));
    vi.stubGlobal('fetch', dublê.buscar);
    const { svc } = montar();

    const v1 = await desfecho(naEmpresa(CASA, () => svc.reindex(CASA)));
    const textoAntigo = dublê.pedidos.flatMap((p) => p.textos).find((t) => t.includes('TEXTO ANTIGO'))!;
    const vetorDeBNaVolta1 = await vetorNoBanco('ContextItem', (await itemDaVault('b.md')).id);
    vault.editar('a.md', '# Nota A\n\nTEXTO NOVO sobre precificação.', T1);
    foraDoAr = true;
    const v2 = await desfecho(naEmpresa(CASA, () => svc.reindex(CASA)));
    const a2 = await itemDaVault('a.md');
    const depoisDaVolta2 = {
      corpo: a2.body.includes('TEXTO NOVO') ? 'novo' : 'antigo',
      vetor: await vetorNoBanco('ContextItem', a2.id),
      naFila: (await naEmpresa(CASA, () => memoria.semVetor(CASA, 100))).some((p) => p.id === a2.id),
    };
    foraDoAr = false;
    const v3 = await desfecho(naEmpresa(CASA, () => svc.reindex(CASA)));
    const textoNovo = dublê.pedidos.flatMap((p) => p.textos).find((t) => t.includes('TEXTO NOVO'))!;
    const a3 = await itemDaVault('a.md');
    const notaA = await prisma.knowledgeNote.findFirstOrThrow({ where: { orgId: CASA, path: `${MARCA}/a.md` } });

    expect({
      voltas: ['ok' in v1, 'ok' in v2, 'ok' in v3],
      depoisDaVolta2,
      vetorDoItemNaVolta3: mesmo(await vetorNoBanco('ContextItem', a3.id), vetorDe(textoNovo))
        ? 'novo'
        : mesmo(await vetorNoBanco('ContextItem', a3.id), vetorDe(textoAntigo))
          ? 'antigo'
          : 'outro',
      vetorDoIndiceNaVolta3: mesmo(await vetorNoBanco('KnowledgeNote', notaA.id), vetorDe(textoNovo)),
      bIntactaNaCasa: mesmo(await vetorNoBanco('ContextItem', (await itemDaVault('b.md')).id), vetorDeBNaVolta1 ?? []),
      versoesDeA: await prisma.contextItemVersion.count({ where: { itemId: a3.id } }),
      pedidos: dublê.pedidos.map((p) => `${p.n}:${p.status}:${p.textos.length}`),
      empresaB: await retratoDeB(),
    }).toEqual({
      voltas: [true, false, true],
      depoisDaVolta2: { corpo: 'novo', vetor: null, naFila: true },
      vetorDoItemNaVolta3: 'novo',
      vetorDoIndiceNaVolta3: true,
      bIntactaNaCasa: true,
      versoesDeA: 2,
      pedidos: ['1:200:2', '2:503:1', '3:200:1'],
      empresaB: antesDeB,
    });
  }, TEMPO);
});
