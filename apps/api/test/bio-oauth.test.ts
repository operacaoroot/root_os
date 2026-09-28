import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BIO_FINALIDADES, INSTAGRAM_ESCOPO_DE_PUBLICAR } from '@mktos/shared';

import * as instagram from '../src/bio/plataformas/instagram';
import { empresaDoEstado, estadoBemFormado, finalidadeDaConexao } from '../src/bio/finalidade-da-conexao';
import { BioOauthController } from '../src/bio/bio-oauth.controller';
import { BioService } from '../src/bio/bio.service';
import { BioCredenciaisService } from '../src/bio/bio-credenciais.service';
import { BioSyncService, tokenRecusadoPelaMeta } from '../src/bio/bio-sync.service';
import { ContaDePublicacaoController } from '../src/pauta/conta-de-publicacao.controller';
import { AuditService } from '../src/audit/audit.service';
import { cifrar, decifrar } from '../src/common/crypto';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD5 — a conta de publicação do Instagram pela trilha do Login do Instagram.
 *
 * O que se prova: a bio de um criador continua pedindo só a leitura; a conta
 * de publicação pede os três escopos; o callback só grava `publicacao` quando a
 * Meta concedeu publicar; uma por empresa; outra empresa não lê. A Meta é um
 * servidor HTTP local (INSTAGRAM_TOKEN_URL / INSTAGRAM_GRAPH_URL).
 */

// ---------------------------------------------------------------------------
// O dublê da Meta
// ---------------------------------------------------------------------------

/**
 * O `code` escolhe a resposta: `<conta>:<forma>`. A forma diz como a Meta
 * devolve `permissions` — texto com publicar, texto sem, lista dentro de
 * `data[]`, ou nada.
 */
const FORMAS: Record<string, unknown> = {
  com: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments',
  sem: 'instagram_business_basic',
  lista: ['instagram_business_basic', 'instagram_business_content_publish'],
  nada: undefined,
};

let servidor: Server;
let base = '';
const pedidos: string[] = [];
/** Quando preenchida, a renovação do token responde isto em vez do token novo. */
let falhaDaRenovacao: { status: number; corpo: unknown } | null = null;

function responder(res: import('node:http').ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    pedidos.push(`${req.method} ${url.pathname}`);
    if (req.method === 'POST' && url.pathname === '/oauth/access_token') {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const code = new URLSearchParams(corpo).get('code') ?? '';
        const [conta, forma] = code.split(':');
        if (!conta || !(forma in FORMAS)) return responder(res, 400, { error_message: 'code inválido' });
        const token = { access_token: `curto-${conta}`, user_id: `id-${conta}`, permissions: FORMAS[forma] };
        responder(res, 200, forma === 'lista' ? { data: [token] } : token);
      });
      return;
    }
    if (url.pathname === '/graph/access_token') {
      return responder(res, 200, { access_token: `longo-${url.searchParams.get('access_token')}`, token_type: 'bearer', expires_in: 5_184_000 });
    }
    if (url.pathname === '/graph/refresh_access_token') {
      if (falhaDaRenovacao) return responder(res, falhaDaRenovacao.status, falhaDaRenovacao.corpo);
      return responder(res, 200, { access_token: `renovado-${url.searchParams.get('access_token')}`, token_type: 'bearer', expires_in: 5_184_000 });
    }
    if (url.pathname === '/graph/me') {
      const conta = (url.searchParams.get('access_token') ?? '').replace(/^longo-curto-/, '');
      return responder(res, 200, { user_id: `id-${conta}`, username: conta, account_type: 'BUSINESS', media_count: 3 });
    }
    responder(res, 404, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

const AMBIENTE = ['INSTAGRAM_OAUTH_URL', 'INSTAGRAM_TOKEN_URL', 'INSTAGRAM_GRAPH_URL', 'WEB_ORIGIN', 'PUBLIC_BIO_ORIGIN', 'ENCRYPTION_KEY'] as const;
const antes: Partial<Record<(typeof AMBIENTE)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of AMBIENTE) antes[k] = process.env[k];
  process.env.INSTAGRAM_OAUTH_URL = `${base}/oauth/authorize`;
  process.env.INSTAGRAM_TOKEN_URL = `${base}/oauth/access_token`;
  process.env.INSTAGRAM_GRAPH_URL = `${base}/graph/`;
  process.env.WEB_ORIGIN = 'https://os.exemplo.test';
  process.env.PUBLIC_BIO_ORIGIN = 'https://bio.exemplo.test';
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  pedidos.length = 0;
  falhaDaRenovacao = null;
});

afterEach(() => {
  for (const k of AMBIENTE) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
});

const escoposDaUrl = (url: string) => new URL(url).searchParams.get('scope')!.split(',');

// ---------------------------------------------------------------------------
// 1. Os escopos e a URL
// ---------------------------------------------------------------------------

describe('bio-oauth: os escopos de cada finalidade', () => {
  it('a bio de um criador continua pedindo só instagram_business_basic, sem publicar', () => {
    expect([...instagram.ESCOPOS]).toEqual(['instagram_business_basic']);
    expect(instagram.ESCOPOS).not.toContain(INSTAGRAM_ESCOPO_DE_PUBLICAR);
    const url = instagram.urlDeAutorizacao('e'.repeat(32), { appId: 'app', secret: 's' });
    expect(escoposDaUrl(url)).toEqual(['instagram_business_basic']);
  });

  it('a conta de publicação pede os três escopos, pela MESMA redirect', () => {
    expect([...instagram.ESCOPOS_DE_PUBLICACAO]).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
    ]);
    const bio = new URL(instagram.urlDeAutorizacao('e'.repeat(32), { appId: 'app', secret: 's' }, 'bio'));
    const pub = new URL(instagram.urlDeAutorizacao('e'.repeat(32), { appId: 'app', secret: 's' }, 'publicacao'));
    expect(escoposDaUrl(pub.toString())).toEqual([...instagram.ESCOPOS_DE_PUBLICACAO]);
    expect(pub.searchParams.get('redirect_uri')).toBe('https://bio.exemplo.test/api/conectar/instagram/callback');
    expect(pub.searchParams.get('redirect_uri')).toBe(bio.searchParams.get('redirect_uri'));
    expect(pub.searchParams.get('state')).toBe('e'.repeat(32));
  });

  it('os endereços aceitam o dublê por ambiente; vazio (como o compose entrega) vale o da Meta', () => {
    expect(instagram.urlDeAutorizacao('x'.repeat(32), { appId: 'a', secret: 's' })).toMatch(new RegExp(`^${base}/oauth/authorize\\?`));
    process.env.INSTAGRAM_OAUTH_URL = '';
    expect(instagram.urlDeAutorizacao('x'.repeat(32), { appId: 'a', secret: 's' })).toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize\?/);
  });

  it('o endereço sobrescrito em http fora desta máquina é recusado no uso: o segredo do app e o token iriam em claro', async () => {
    process.env.INSTAGRAM_OAUTH_URL = 'http://duble.exemplo:8080/oauth/authorize';
    expect(() => instagram.urlDeAutorizacao('x'.repeat(32), { appId: 'a', secret: 's' })).toThrow(/http fora desta máquina/);
    process.env.INSTAGRAM_TOKEN_URL = 'http://duble.exemplo:8080/oauth/access_token';
    await expect(instagram.trocarCodigo('codigo', { appId: 'a', secret: 's' })).rejects.toThrow(/http fora desta máquina/);
    process.env.INSTAGRAM_GRAPH_URL = 'http://duble.exemplo:8080/graph';
    await expect(instagram.renovar('token-longo')).rejects.toThrow(/http fora desta máquina/);
    expect(pedidos).toEqual([]);
  });

  it('o enum do Prisma é o espelho exato do shared, na mesma ordem, e a migration tem o índice parcial', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const bloco = schema.match(/enum BioFinalidade \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(bloco.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)).toEqual([...BIO_FINALIDADES]);
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20260924220041_bio_finalidade/migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX "BioConexao_publicacao_unica"\s+ON "BioConexao"\("orgId", "plataforma"\)\s+WHERE "finalidade" = 'publicacao'/);
  });
});

// ---------------------------------------------------------------------------
// 2. O que a Meta devolve
// ---------------------------------------------------------------------------

describe('bio-oauth: os escopos concedidos, nas formas que a Meta usa', () => {
  it('texto, lista dentro de data[], e ausente', async () => {
    const cred = { appId: 'app', secret: 'seg' };
    expect((await instagram.trocarCodigo('a:com', cred)).concedidos).toContain(INSTAGRAM_ESCOPO_DE_PUBLICAR);
    expect((await instagram.trocarCodigo('a:sem', cred)).concedidos).toEqual(['instagram_business_basic']);
    const lista = await instagram.trocarCodigo('a:lista', cred);
    expect(lista.concedidos).toEqual(['instagram_business_basic', INSTAGRAM_ESCOPO_DE_PUBLICAR]);
    expect(lista.token).toBe('longo-curto-a');
    expect((await instagram.trocarCodigo('a:nada', cred)).concedidos).toBeNull();
    expect(pedidos).toContain('POST /oauth/access_token');
    expect(pedidos).toContain('GET /graph/access_token');
  });

  it('corpo sem access_token é erro, não token vazio', async () => {
    await expect(instagram.trocarCodigo('invalido', { appId: 'a', secret: 's' })).rejects.toThrow(/troca de código falhou: 400/);
    expect(instagram.escoposConcedidos(' a , ,b ')).toEqual(['a', 'b']);
    expect(instagram.escoposConcedidos([1, 'x'])).toEqual(['x']);
    expect(instagram.escoposConcedidos(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. A decisão da finalidade
// ---------------------------------------------------------------------------

describe('bio-oauth: com que finalidade a conexão fica', () => {
  const PUB = ['instagram_business_basic', INSTAGRAM_ESCOPO_DE_PUBLICAR];
  const LER = ['instagram_business_basic'];

  it.each([
    ['pediu publicar e ganhou', 'publicacao', null, PUB, 'publicacao', null],
    ['pediu publicar e não ganhou', 'publicacao', null, LER, 'bio', 'publicacao_sem_escopo'],
    ['pediu publicar e a Meta não disse', 'publicacao', null, null, 'bio', 'publicacao_sem_escopo'],
    ['bio comum', 'bio', null, LER, 'bio', null],
    ['bio comum com escopo a mais não vira publicação', 'bio', 'bio', PUB, 'bio', null],
    ['a de publicação reconectada pela bio, ainda publica', 'bio', 'publicacao', PUB, 'publicacao', null],
    ['a de publicação reconectada pela bio sem publicar fica como está', 'bio', 'publicacao', LER, 'publicacao', 'publicacao_mantida'],
  ] as const)('%s', (_n, pedida, anterior, concedidos, finalidade, aviso) => {
    expect(finalidadeDaConexao({ pedida, anterior, concedidos })).toEqual({ finalidade, aviso });
  });

  it('o state fora do formato não chega ao banco, e o bem formado diz de que empresa é', () => {
    expect(estadoBemFormado(`org-x.${'a'.repeat(32)}`)).toBe(true);
    expect(empresaDoEstado(`org-x.${'a'.repeat(32)}`)).toBe('org-x');
    // O formato antigo, sem a empresa na frente, também não passa: o callback
    // não teria em que empresa procurar a linha.
    for (const ruim of ['', 'curto', 'a'.repeat(32), `org-x.${'a'.repeat(200)}`, `.${'a'.repeat(32)}`, 'a b'.repeat(10), "'; drop", undefined, 42]) {
      expect(estadoBemFormado(ruim), String(ruim)).toBe(false);
      expect(empresaDoEstado(ruim), String(ruim)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. As rotas
// ---------------------------------------------------------------------------

class Redirecionamento {
  para = '';
  redirect(url: string) {
    this.para = url;
    return this;
  }
}

describe('bio-oauth: as rotas da conta de publicação', () => {
  it('conectar pede pauta.publicar E bio.editar e inicia com finalidade publicacao; ver pede pauta.ver', async () => {
    expect(Reflect.getMetadata('path', ContaDePublicacaoController)).toBe('pauta/instagram');
    expect(Reflect.getMetadata(GUARDS_METADATA, ContaDePublicacaoController)).toEqual([JwtAuthGuard, PermissionsGuard]);
    const proto = ContaDePublicacaoController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata('path', proto.conectar)).toBe('conectar');
    expect(Reflect.getMetadata('method', proto.conectar)).toBe(1); // POST
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.conectar)).toEqual(['pauta.publicar', 'bio.editar']);
    expect(Reflect.getMetadata('path', proto.conexao)).toBe('conexao');
    expect(Reflect.getMetadata('method', proto.conexao)).toBe(0); // GET
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.conexao)).toEqual(['pauta.ver']);

    const chamadas: unknown[][] = [];
    const bio = {
      iniciarConexao: async (...a: unknown[]) => (chamadas.push(a), { url: 'u' }),
      contaDePublicacao: async (...a: unknown[]) => (chamadas.push(a), null),
    } as unknown as BioService;
    const c = new ContaDePublicacaoController(bio);
    const usuario = { sub: 'u1', orgId: 'org-a' } as never;
    await c.conectar(usuario);
    await c.conexao(usuario);
    expect(chamadas).toEqual([['org-a', 'instagram', 'publicacao'], ['org-a']]);
  });

  it('publicar pelo TikTok é recusado antes de qualquer consulta (MD12 em espera)', async () => {
    const svc = new BioService({} as never, {} as never, {} as never, {} as never);
    await expect(svc.iniciarConexao('org-a', 'tiktok', 'publicacao')).rejects.toThrow(/só para o Instagram/);
  });

  it('o callback com state malformado volta como expirado sem tocar no banco', async () => {
    const tocou: string[] = [];
    const prisma = new Proxy({}, { get: (_t, p) => (tocou.push(String(p)), undefined) }) as never;
    const c = new BioOauthController(prisma, {} as never, {} as never);
    const res = new Redirecionamento();
    await c.callback('instagram', 'codigo', 'curto', '', res as never);
    expect(res.para).toBe('https://os.exemplo.test/bio?conexao=expirado');
    await c.callback('instagram', '', 'x'.repeat(500), 'access_denied', res as never);
    expect(res.para).toBe('https://os.exemplo.test/bio?conexao=cancelado');
    expect(tocou).toEqual([]);
  });

  it('ler a conta de publicação não decifra nem pega emprestado o segredo do app', async () => {
    const credenciais = {
      resolver: async () => {
        throw new Error('resolver não pode ser chamado pela tela');
      },
      estado: async () => ({ items: [{ plataforma: 'tiktok', configurada: false }, { plataforma: 'instagram', configurada: true }] }),
    } as unknown as BioCredenciaisService;
    const prisma = { bioConexao: { findFirst: async () => null } } as never;
    const svc = new BioService(prisma, {} as never, {} as never, credenciais);
    expect(await svc.contaDePublicacao('org-a')).toMatchObject({ credencialConfigurada: true, conexao: null });
  });

  it('desconectar a conta de publicação exige pauta.publicar; a da bio, não', async () => {
    const apagadas: string[] = [];
    const conexoes: Record<string, { id: string; finalidade: string; plataforma: string; handle: string }> = {
      pub: { id: 'pub', finalidade: 'publicacao', plataforma: 'instagram', handle: 'root' },
      bio: { id: 'bio', finalidade: 'bio', plataforma: 'instagram', handle: 'criador' },
    };
    const prisma = {
      bioConexao: {
        findFirst: async ({ where }: { where: { id: string } }) => conexoes[where.id] ?? null,
        delete: async ({ where }: { where: { id: string } }) => apagadas.push(where.id),
      },
      bioChallengeAccount: { updateMany: async () => ({ count: 0 }) },
    } as never;
    const auditados: unknown[] = [];
    const svc = new BioService(prisma, { log: async (a: unknown) => auditados.push(a) } as never, {} as never, {} as never);
    await expect(svc.desconectar('org-a', 'pub', 'u1', ['bio.editar'])).rejects.toThrow(/exige pauta.publicar/);
    expect(apagadas).toEqual([]);
    await svc.desconectar('org-a', 'bio', 'u1', ['bio.editar']);
    await svc.desconectar('org-a', 'pub', 'u1', ['bio.editar', 'pauta.publicar']);
    expect(apagadas).toEqual(['bio', 'pub']);
    expect(auditados[1]).toMatchObject({ action: 'bio.conexao_delete', before: { handle: 'root', finalidade: 'publicacao' } });
  });

  it('só o código 190 da Graph é token morto; OAuthException de limite ou erro temporário não', () => {
    const corpo = (code: number) =>
      `Error: renovação falhou: 400 {"error":{"message":"x","type":"OAuthException","code":${code},"fbtrace_id":"A"}}`;
    expect(tokenRecusadoPelaMeta(corpo(190))).toBe(true);
    expect(tokenRecusadoPelaMeta('{"error": {"code" : 190, "error_subcode": 463}}')).toBe(true);
    for (const code of [1, 2, 4, 17, 1900, 32]) expect(tokenRecusadoPelaMeta(corpo(code)), String(code)).toBe(false);
    expect(tokenRecusadoPelaMeta('TypeError: fetch failed')).toBe(false);
    expect(tokenRecusadoPelaMeta('Error: renovação falhou: 503 Service Unavailable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Com banco
// ---------------------------------------------------------------------------

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
if (URL_DO_BANCO) exigirBancoDescartavel(URL_DO_BANCO, 'ESCREVE nele (duas empresas, conexões e states da bio)');

const MARCA = `bo${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL_DO_BANCO)('bio-oauth com banco: a conexão de publicação de ponta a ponta', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let bioA: BioService;
  let callback: BioOauthController;
  let orgA = '';
  let orgB = '';

  const na = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  /** Inicia pela sessão da empresa e completa pelo callback, como o navegador faria. */
  async function conectar(orgId: string, finalidade: 'bio' | 'publicacao', code: string) {
    const { url } = await na(orgId, () => bioA.iniciarConexao(orgId, 'instagram', finalidade));
    const estado = new URL(url).searchParams.get('state')!;
    const res = new Redirecionamento();
    await callback.callback('instagram', code, estado, '', res as never);
    return { url, estado, volta: res.para };
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    admin = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    cru = new PrismaClient({ datasourceUrl: URL_DO_BANCO });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    bioA = new BioService(app, new AuditService(app), {} as never, new BioCredenciaisService(app));
    // O callback é público e roda sem empresa no contexto, como em produção hoje: conexão dona.
    const dono = admin as unknown as PrismaService;
    callback = new BioOauthController(dono, new BioCredenciaisService(dono), new AuditService(dono));
    const a = await admin.org.create({ data: { name: `Bio A ${MARCA}`, slug: `bo-a-${MARCA}`, modulos: ['pauta', 'bio'] } });
    const b = await admin.org.create({ data: { name: `Bio B ${MARCA}`, slug: `bo-b-${MARCA}`, modulos: ['pauta', 'bio'] } });
    orgA = a.id;
    orgB = b.id;
    for (const orgId of [orgA, orgB]) {
      await admin.bioCredencialApp.create({
        data: { plataforma: 'instagram', orgId, appId: `app-${orgId.slice(0, 6)}`, segredoCifrado: cifrar('segredo') },
      });
    }
  }, 60_000);

  afterAll(async () => {
    const orgs = [orgA, orgB].filter(Boolean);
    if (orgs.length) {
      await admin.bioConexao.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioOauthState.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioCredencialApp.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.org.deleteMany({ where: { id: { in: orgs } } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('iniciar com publicacao grava a finalidade no state e gera a URL com os três escopos', async () => {
    const { url } = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram', 'publicacao'));
    expect(escoposDaUrl(url)).toEqual([...instagram.ESCOPOS_DE_PUBLICACAO]);
    const estado = new URL(url).searchParams.get('state')!;
    expect(estado.startsWith(`${orgA}.`)).toBe(true);
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).toMatchObject({ orgId: orgA, finalidade: 'publicacao' });

    const daBio = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram'));
    expect(escoposDaUrl(daBio.url)).toEqual(['instagram_business_basic']);
    const e2 = new URL(daBio.url).searchParams.get('state')!;
    expect(await admin.bioOauthState.findUnique({ where: { estado: e2 } })).toMatchObject({ finalidade: 'bio' });
  });

  it('com content_publish concedido, a conexão fica de publicação e a volta é na aba Semana', async () => {
    const { estado, volta } = await conectar(orgA, 'publicacao', `root${MARCA}:com`);
    expect(volta).toBe('https://os.exemplo.test/pauta?aba=semana&conexao=ok');
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).toBeNull();
    const c = await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `root${MARCA}` } });
    expect(c).toMatchObject({ finalidade: 'publicacao', status: 'ok', externalId: `id-root${MARCA}` });
    expect(c!.escopos).toContain(INSTAGRAM_ESCOPO_DE_PUBLICAR);
    expect(decifrar(c!.tokenCifrado)).toBe(`longo-curto-root${MARCA}`);

    const conta = await na(orgA, () => bioA.contaDePublicacao(orgA));
    expect(conta.credencialConfigurada).toBe(true);
    expect(conta.conexao).toMatchObject({ handle: `root${MARCA}`, podePublicar: true, podeComentarios: true, status: 'ok' });
    expect(JSON.stringify(conta)).not.toContain('longo-curto');

    const aud = await admin.auditLog.findFirst({ where: { orgId: orgA, action: 'bio.conexao_create', entityId: c!.id } });
    expect(aud?.after).toMatchObject({ finalidadePedida: 'publicacao', finalidade: 'publicacao' });
  });

  it('sem o escopo de publicar, a conexão fica da bio e a volta traz o aviso', async () => {
    const { volta } = await conectar(orgA, 'publicacao', `semescopo${MARCA}:sem`);
    expect(volta).toBe('https://os.exemplo.test/pauta?aba=semana&conexao=publicacao_sem_escopo');
    expect(await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `semescopo${MARCA}` } })).toMatchObject({ finalidade: 'bio' });
    const r2 = await conectar(orgA, 'publicacao', `semlista${MARCA}:nada`);
    expect(r2.volta).toContain('conexao=publicacao_sem_escopo');
    // A conta de publicação que já existia não foi tocada.
    expect((await na(orgA, () => bioA.contaDePublicacao(orgA))).conexao?.handle).toBe(`root${MARCA}`);
  });

  it('o state com a empresa trocada não acha a linha: volta como expirado e não gasta o state verdadeiro', async () => {
    const { url } = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram', 'bio'));
    const estado = new URL(url).searchParams.get('state')!;
    const trocado = `${orgB}.${estado.slice(estado.indexOf('.') + 1)}`;
    const res = new Redirecionamento();
    await callback.callback('instagram', `trocado${MARCA}:sem`, trocado, '', res as never);
    expect(res.para).toBe('https://os.exemplo.test/bio?conexao=expirado');
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).not.toBeNull();
    expect(await admin.bioConexao.findFirst({ where: { handle: `trocado${MARCA}` } })).toBeNull();
  });

  it('o callback inteiro roda dentro da empresa: completa com a sessão em modo impor', async () => {
    const restrita = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const naEmpresa = new BioOauthController(restrita, new BioCredenciaisService(restrita), new AuditService(restrita));
    const { url } = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram', 'bio'));
    const estado = new URL(url).searchParams.get('state')!;
    const res = new Redirecionamento();
    await naEmpresa.callback('instagram', `impor${MARCA}:sem`, estado, '', res as never);
    expect(res.para).toBe('https://os.exemplo.test/bio?conexao=ok');
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).toBeNull();
    expect(await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `impor${MARCA}` } })).toMatchObject({ finalidade: 'bio' });
  });

  it('a bio de um criador continua como antes: só leitura, volta na bio', async () => {
    const { url, volta } = await conectar(orgA, 'bio', `criador${MARCA}:sem`);
    expect(escoposDaUrl(url)).toEqual(['instagram_business_basic']);
    expect(volta).toBe('https://os.exemplo.test/bio?conexao=ok');
    expect(await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `criador${MARCA}` } })).toMatchObject({
      finalidade: 'bio',
      escopos: 'instagram_business_basic',
    });
  });

  it('outra empresa conecta o MESMO @ para publicar sem tocar na conta de publicação da primeira', async () => {
    const deB = await na(orgB, () => bioA.contaDePublicacao(orgB));
    expect(deB.conexao).toBeNull();
    expect(deB.credencialConfigurada).toBe(true);
    const deA = (await na(orgA, () => bioA.contaDePublicacao(orgA))).conexao;
    expect(deA?.handle).toBe(`root${MARCA}`);

    // O state criado por B amarra a conexão a B; o rebaixamento de "uma por
    // empresa" não atravessa para A, mesmo sendo o mesmo @.
    const { volta } = await conectar(orgB, 'publicacao', `root${MARCA}:com`);
    expect(volta).toBe('https://os.exemplo.test/pauta?aba=semana&conexao=ok');
    const emB = await admin.bioConexao.findMany({ where: { orgId: orgB } });
    expect(emB.map((c) => [c.handle, c.finalidade])).toEqual([[`root${MARCA}`, 'publicacao']]);
    expect((await na(orgA, () => bioA.contaDePublicacao(orgA))).conexao).toEqual(deA);
    expect((await na(orgB, () => bioA.contaDePublicacao(orgB))).conexao?.id).toBe(emB[0].id);

    // Prepara o próximo caso: em A, um segundo @ com publicar.
    await conectar(orgA, 'publicacao', `outra${MARCA}:com`);
  });

  it('um segundo @ de publicação troca o primeiro: um por empresa, o anterior volta a ser da bio', async () => {
    // O teste anterior conectou `outra…` com publicar: ela é a de publicação agora.
    const pubs = await admin.bioConexao.findMany({ where: { orgId: orgA, finalidade: 'publicacao' } });
    expect(pubs.map((p) => p.handle)).toEqual([`outra${MARCA}`]);
    expect(await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `root${MARCA}` } })).toMatchObject({ finalidade: 'bio' });
    const aud = await admin.auditLog.findFirst({
      where: { orgId: orgA, action: 'bio.conexao_create', entityId: pubs[0].id },
      orderBy: { createdAt: 'desc' },
    });
    expect(aud?.after).toMatchObject({ deixaramDePublicar: [`root${MARCA}`] });

    // O índice parcial segura a segunda direto no banco, sem passar pelo callback.
    await expect(
      admin.bioConexao.update({ where: { id: (await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `root${MARCA}` } }))!.id }, data: { finalidade: 'publicacao' } }),
    ).rejects.toThrow(/Unique constraint|BioConexao_publicacao_unica/);
  });

  it('a de publicação reconectada pela bio sem publicar NÃO muda: quem só tem bio.editar não tira a conta de publicação', async () => {
    const antes = await admin.bioConexao.findFirstOrThrow({ where: { orgId: orgA, finalidade: 'publicacao' } });
    const { volta } = await conectar(orgA, 'bio', `outra${MARCA}:sem`);
    expect(volta).toBe('https://os.exemplo.test/bio?conexao=publicacao_mantida');
    const depois = await admin.bioConexao.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois).toMatchObject({ finalidade: 'publicacao', tokenCifrado: antes.tokenCifrado, escopos: antes.escopos });
    expect((await na(orgA, () => bioA.contaDePublicacao(orgA))).conexao).not.toBeNull();
    expect(await admin.auditLog.count({ where: { orgId: orgA, action: 'bio.conexao_mantida' } })).toBe(1);
  });

  it('cancelar na tela da Meta gasta o state e volta para a tela que pediu', async () => {
    const { url } = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram', 'publicacao'));
    const estado = new URL(url).searchParams.get('state')!;
    const res = new Redirecionamento();
    await callback.callback('instagram', '', estado, 'access_denied', res as never);
    expect(res.para).toBe('https://os.exemplo.test/pauta?aba=semana&conexao=cancelado');
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).toBeNull();
  });

  it('o state vencido volta para a tela que o pediu, como expirado, e é gasto', async () => {
    const { url } = await na(orgA, () => bioA.iniciarConexao(orgA, 'instagram', 'publicacao'));
    const estado = new URL(url).searchParams.get('state')!;
    await admin.bioOauthState.update({ where: { estado }, data: { expiraEm: new Date(Date.now() - 60_000) } });
    const res = new Redirecionamento();
    await callback.callback('instagram', `tarde${MARCA}:com`, estado, '', res as never);
    expect(res.para).toBe('https://os.exemplo.test/pauta?aba=semana&conexao=expirado');
    expect(await admin.bioOauthState.findUnique({ where: { estado } })).toBeNull();
    expect(await admin.bioConexao.count({ where: { orgId: orgA, handle: `tarde${MARCA}` } })).toBe(0);
    expect(pedidos).not.toContain('POST /oauth/access_token');
  });

  it('a conta de publicação perto de vencer é renovada pelo sync, e só ela', async () => {
    const { volta } = await conectar(orgA, 'publicacao', `renova${MARCA}:com`);
    expect(volta).toContain('conexao=ok');
    const cinco = new Date(Date.now() + 5 * 86_400_000);
    await admin.bioConexao.updateMany({ where: { orgId: orgA }, data: { expiraEm: cinco } });
    const sync = new BioSyncService(admin as unknown as PrismaService, new BioCredenciaisService(admin as unknown as PrismaService));
    const r = await sync.renovarContasDePublicacao();
    const minha = await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `renova${MARCA}` } });
    expect(r.filter((x) => x.conexaoId === minha!.id)).toEqual([{ conexaoId: minha!.id, ok: true }]);
    expect(decifrar(minha!.tokenCifrado)).toBe(`renovado-longo-curto-renova${MARCA}`);
    expect(minha!.expiraEm!.getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);
    const daBio = await admin.bioConexao.findFirst({ where: { orgId: orgA, handle: `criador${MARCA}` } });
    expect(daBio!.expiraEm!.getTime()).toBe(cinco.getTime());
  });

  it('uma renovação que falha por 5xx não tira a conta das rodadas seguintes, e a que dá certo limpa o erro', async () => {
    const sync = new BioSyncService(admin as unknown as PrismaService, new BioCredenciaisService(admin as unknown as PrismaService));
    const minha = await admin.bioConexao.findFirstOrThrow({ where: { orgId: orgA, handle: `renova${MARCA}` } });
    const cinco = new Date(Date.now() + 5 * 86_400_000);
    const tokenAntes = decifrar(minha.tokenCifrado);
    await admin.bioConexao.update({ where: { id: minha.id }, data: { expiraEm: cinco } });

    falhaDaRenovacao = { status: 503, corpo: { error: { message: 'temporário', type: 'OAuthException', code: 2 } } };
    const r1 = (await sync.renovarContasDePublicacao()).filter((x) => x.conexaoId === minha.id);
    expect(r1).toMatchObject([{ ok: false }]);
    const depois1 = await admin.bioConexao.findUniqueOrThrow({ where: { id: minha.id } });
    expect(depois1).toMatchObject({ status: 'ok', expiraEm: cinco });
    expect(depois1.ultimoErro).toMatch(/503/);
    expect(decifrar(depois1.tokenCifrado)).toBe(tokenAntes);

    // Limite de taxa (código 4) também vem como OAuthException e não é token morto.
    falhaDaRenovacao = { status: 400, corpo: { error: { message: 'limite', type: 'OAuthException', code: 4 } } };
    await sync.renovarContasDePublicacao();
    expect(await admin.bioConexao.findUniqueOrThrow({ where: { id: minha.id } })).toMatchObject({ status: 'ok' });

    falhaDaRenovacao = null;
    const r2 = (await sync.renovarContasDePublicacao()).filter((x) => x.conexaoId === minha.id);
    expect(r2).toEqual([{ conexaoId: minha.id, ok: true }]);
    const depois2 = await admin.bioConexao.findUniqueOrThrow({ where: { id: minha.id } });
    expect(depois2).toMatchObject({ status: 'ok', ultimoErro: null });
    expect(decifrar(depois2.tokenCifrado)).toBe(`renovado-${tokenAntes}`);
  });

  it('o código 190 marca token vencido, e a conta continua sendo tentada até vencer de fato', async () => {
    const sync = new BioSyncService(admin as unknown as PrismaService, new BioCredenciaisService(admin as unknown as PrismaService));
    const minha = await admin.bioConexao.findFirstOrThrow({ where: { orgId: orgA, handle: `renova${MARCA}` } });
    await admin.bioConexao.update({ where: { id: minha.id }, data: { expiraEm: new Date(Date.now() + 3 * 86_400_000) } });

    falhaDaRenovacao = { status: 400, corpo: { error: { message: 'Session has expired', type: 'OAuthException', code: 190, error_subcode: 463 } } };
    await sync.renovarContasDePublicacao();
    expect(await admin.bioConexao.findUniqueOrThrow({ where: { id: minha.id } })).toMatchObject({ status: 'token_expirado' });

    // Sem filtro por status: se a Meta voltar a aceitar, a rodada seguinte recupera.
    falhaDaRenovacao = null;
    const r = (await sync.renovarContasDePublicacao()).filter((x) => x.conexaoId === minha.id);
    expect(r).toEqual([{ conexaoId: minha.id, ok: true }]);
    expect(await admin.bioConexao.findUniqueOrThrow({ where: { id: minha.id } })).toMatchObject({ status: 'ok', ultimoErro: null });

    // Token já vencido fica fora: tentar de novo só falharia outra vez.
    await admin.bioConexao.update({ where: { id: minha.id }, data: { expiraEm: new Date(Date.now() - 60_000) } });
    expect((await sync.renovarContasDePublicacao()).map((x) => x.conexaoId)).not.toContain(minha.id);
  });
});
