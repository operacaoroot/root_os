import 'reflect-metadata';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BioOauthController } from '../src/bio/bio-oauth.controller';
import { BioService } from '../src/bio/bio.service';
import { BioCredenciaisService } from '../src/bio/bio-credenciais.service';
import { AuditService } from '../src/audit/audit.service';
import { chaveDoPacote, cifrar, decifrar } from '../src/common/crypto';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * CX2 — o state do retorno OAuth da bio é de uso único também sob concorrência.
 *
 * O defeito da base (a142079): o callback lia o `BioOauthState` e depois o
 * apagava engolindo o erro. Dois retornos com o mesmo state liam a linha
 * juntos; um apagava, o outro levava P2025 em silêncio, e os dois seguiam para
 * a troca do código e para a gravação da conexão.
 *
 * O que se prova, contra banco descartável e plataforma simulada:
 *  - retornos simultâneos do mesmo state: um só chega à troca do código e
 *    grava; os outros voltam como expirado antes de qualquer chamada para fora;
 *  - o consumo acontece antes da chamada à plataforma e não é desfeito quando
 *    ela falha, então nem o perdedor da corrida nem a repetição ganham outra
 *    troca;
 *  - vencido, inexistente, de outra plataforma, já usado e cancelado continuam
 *    recusados, e o fluxo válido continua gravando na empresa do state, com a
 *    finalidade dele, e voltando para a tela que o pediu.
 *
 * O dublê aceita o mesmo código quantas vezes ele vier, de propósito: a
 * garantia testada é a nossa, e as trocas são contadas no ponto em que o
 * pedido sairia daqui (o `fetch` do endpoint de token), sem depender do que a
 * plataforma real faça com uma segunda troca do mesmo código. Nenhum pedido
 * sai desta máquina: o `fetch` só deixa passar o loopback, e o TikTok é
 * respondido aqui mesmo.
 *
 * Dois `PrismaClient` fazem o papel de dois containers da API, cada um com o
 * seu pool, embrulhados como em produção hoje: `comTenantNaSessao` em modo
 * observar, conexão dona e callback sem empresa no contexto.
 */

// ---------------------------------------------------------------------------
// A rede do teste: dublê da Meta em loopback, TikTok local, resto bloqueado
// ---------------------------------------------------------------------------

type Troca = { codigo: string; redirectUri: string | null; verifier: string | null; stateNaTroca: number | null };

const trocas: Troca[] = [];
const perfis: string[] = [];
const bloqueados: string[] = [];
/** O state de cada código, para medir, no instante da troca, se ele ainda estava no banco. */
const estadoDoCodigo = new Map<string, string>();
let contarState: ((estado: string) => Promise<number>) | null = null;
/** Contas cujo perfil a Meta simulada responde com 500 (depois de trocar o código). */
const perfilQuebrado = new Set<string>();

let servidor: Server;
let base = '';
let portaFechada = 0;
const fetchReal = globalThis.fetch.bind(globalThis);

function responder(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

const ESCOPOS_COM_PUBLICAR = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments';

function tiktokLocal(url: URL, metodo: string, init?: RequestInit): Response {
  if (metodo === 'POST' && url.pathname === '/v2/oauth/token/') {
    const conta = (new URLSearchParams(String(init?.body ?? '')).get('code') ?? '').split(':')[0];
    return json(200, {
      access_token: `tk-${conta}`,
      refresh_token: `rf-${conta}`,
      expires_in: 86_400,
      scope: 'user.info.basic,user.info.stats,video.list',
      open_id: `open-${conta}`,
    });
  }
  if (metodo === 'GET' && url.pathname === '/v2/user/info/') {
    const conta = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer tk-/, '');
    return json(200, { data: { user: { open_id: `open-${conta}`, display_name: conta, video_count: 0 } }, error: { code: 'ok', message: '' } });
  }
  return json(404, {});
}

/** O `fetch` do processo durante a suíte: conta trocas e perfis, e só deixa sair para o loopback. */
async function redeDoTeste(entrada: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();

  const ehTroca = metodo === 'POST' && (url.pathname.endsWith('/oauth/access_token') || url.pathname === '/v2/oauth/token/');
  if (ehTroca) {
    const corpo = new URLSearchParams(String(init?.body ?? ''));
    const codigo = corpo.get('code') ?? '';
    const estado = estadoDoCodigo.get(codigo);
    trocas.push({
      codigo,
      redirectUri: corpo.get('redirect_uri'),
      verifier: corpo.get('code_verifier'),
      stateNaTroca: estado && contarState ? await contarState(estado) : null,
    });
  }
  if (metodo === 'GET' && url.pathname.endsWith('/graph/me')) {
    perfis.push((url.searchParams.get('access_token') ?? '').replace(/^longo-curto-/, ''));
  }
  if (metodo === 'GET' && url.hostname === 'open.tiktokapis.com' && url.pathname === '/v2/user/info/') {
    perfis.push((new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer tk-/, ''));
  }

  if (url.hostname === '127.0.0.1') return fetchReal(entrada, init);
  if (url.hostname === 'open.tiktokapis.com') return tiktokLocal(url, metodo, init);
  bloqueados.push(url.host);
  throw new Error(`rede externa bloqueada no teste: ${url.host}`);
}

const AMBIENTE = [
  'INSTAGRAM_TOKEN_URL',
  'INSTAGRAM_GRAPH_URL',
  'WEB_ORIGIN',
  'PUBLIC_BIO_ORIGIN',
  'ENCRYPTION_KEY',
  'COFRE_CHAVES',
  'COFRE_CHAVE_ATUAL',
] as const;
const antes: Partial<Record<(typeof AMBIENTE)[number], string | undefined>> = {};

beforeAll(async () => {
  // A Meta simulada. O `code` escolhe a resposta: `<conta>:<forma>[:<qualquer
  // coisa>]`. `com` concede publicar, `sem` só a leitura, `troca500` derruba a
  // troca e `perfil500` troca e derruba a leitura do perfil.
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/oauth/access_token') {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const [conta, forma] = (new URLSearchParams(corpo).get('code') ?? '').split(':');
        if (!conta) return responder(res, 400, { error_message: 'code inválido' });
        if (forma === 'troca500') return responder(res, 500, { error_message: 'indisponível' });
        if (forma === 'perfil500') perfilQuebrado.add(conta);
        responder(res, 200, {
          access_token: `curto-${conta}`,
          user_id: `id-${conta}`,
          permissions: forma === 'com' ? ESCOPOS_COM_PUBLICAR : 'instagram_business_basic',
        });
      });
      return;
    }
    if (url.pathname === '/graph/access_token') {
      return responder(res, 200, { access_token: `longo-${url.searchParams.get('access_token')}`, token_type: 'bearer', expires_in: 5_184_000 });
    }
    if (url.pathname === '/graph/me') {
      const conta = (url.searchParams.get('access_token') ?? '').replace(/^longo-curto-/, '');
      if (perfilQuebrado.has(conta)) return responder(res, 500, { error: { message: 'indisponível' } });
      return responder(res, 200, { user_id: `id-${conta}`, username: conta, account_type: 'BUSINESS', media_count: 1 });
    }
    responder(res, 404, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  // Uma porta de loopback sem ninguém escutando: a plataforma "fora do ar".
  const vazio = createServer();
  await new Promise<void>((ok) => vazio.listen(0, '127.0.0.1', ok));
  portaFechada = (vazio.address() as AddressInfo).port;
  await new Promise<void>((ok) => vazio.close(() => ok()));

  for (const k of AMBIENTE) antes[k] = process.env[k];
  process.env.INSTAGRAM_TOKEN_URL = `${base}/oauth/access_token`;
  process.env.INSTAGRAM_GRAPH_URL = `${base}/graph/`;
  process.env.WEB_ORIGIN = 'https://os.exemplo.test';
  process.env.PUBLIC_BIO_ORIGIN = 'https://bio.exemplo.test';
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  // Credencial e token desta suíte saem cifrados com uma chave própria, e não
  // com a de ambiente: `cofre.test.ts` conta no banco inteiro as linhas da bio
  // cifradas com `env`, e as desta suíte, gravadas e apagadas em paralelo,
  // mudavam aquela conta no meio do caso (3 falhas em 12 rodadas, medido).
  process.env.COFRE_CHAVES = `cx2:${Buffer.alloc(32, 11).toString('base64')}`;
  process.env.COFRE_CHAVE_ATUAL = 'cx2';

  vi.spyOn(globalThis, 'fetch').mockImplementation(redeDoTeste);
});

afterEach(() => {
  expect(bloqueados, 'nenhum pedido pode sair do loopback').toEqual([]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const k of AMBIENTE) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

// ---------------------------------------------------------------------------
// O controlador, a barreira e as medidas
// ---------------------------------------------------------------------------

class Redirecionamento {
  para = '';
  redirect(url: string) {
    this.para = url;
    return this;
  }
}

/**
 * Segura cada leitor até `quantos` chegarem, para que todas as leituras do
 * state aconteçam antes de qualquer consumo: é a intercalação que a base não
 * aguentava. Tem prazo para não travar a suíte; `cheia` diz se ela fechou.
 */
class Barreira {
  private chegaram = 0;
  private abrir: () => void = () => undefined;
  private readonly aberta = new Promise<void>((ok) => (this.abrir = ok));
  cheia = false;

  constructor(private readonly quantos: number) {}

  async chegar(): Promise<void> {
    this.chegaram += 1;
    if (this.chegaram >= this.quantos) {
      this.cheia = true;
      this.abrir();
    }
    let prazo: NodeJS.Timeout | undefined;
    await Promise.race([this.aberta, new Promise<void>((ok) => (prazo = setTimeout(ok, 5_000)))]);
    clearTimeout(prazo);
  }
}

/** O mesmo cliente, com a leitura do `BioOauthState` presa na barreira depois de voltar do banco. */
function lendoNaBarreira(cliente: PrismaService, barreira: Barreira): PrismaService {
  return new Proxy(cliente, {
    get(alvo, prop) {
      const valor = Reflect.get(alvo, prop);
      if (prop !== 'bioOauthState') return valor;
      return new Proxy(valor as object, {
        get(modelo, op) {
          const metodo = Reflect.get(modelo, op);
          if (op !== 'findUnique' || typeof metodo !== 'function') return metodo;
          return async (...args: unknown[]) => {
            const lido: unknown = await metodo.apply(modelo, args);
            await barreira.chegar();
            return lido;
          };
        },
      });
    },
  });
}

const TELA_BIO = 'https://os.exemplo.test/bio?conexao=';
const TELA_PUB = 'https://os.exemplo.test/pauta?aba=semana&conexao=';
const tela = (finalidade: 'bio' | 'publicacao') => (finalidade === 'publicacao' ? TELA_PUB : TELA_BIO);

function contagem(voltas: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const v of voltas) c[v] = (c[v] ?? 0) + 1;
  return c;
}

// ---------------------------------------------------------------------------
// Com banco
// ---------------------------------------------------------------------------

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
if (URL_DO_BANCO) exigirBancoDescartavel(URL_DO_BANCO, 'ESCREVE nele (três empresas, states e conexões da bio)');

const MARCA = `cx${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL_DO_BANCO)('bio-oauth: o state do retorno é gasto uma vez só', () => {
  let admin: PrismaClient;
  let cruA: PrismaClient;
  let cruB: PrismaClient;
  let appA: PrismaService;
  let appB: PrismaService;
  let inicio: BioService;
  let orgA = '';
  let orgB = '';
  let orgSemCredencial = '';

  const na = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `cx2-${MARCA}`, origem: 'http' }, fn);

  /** Inicia pela rota autenticada da empresa, como a tela faz; devolve o state que foi para a plataforma. */
  async function iniciar(orgId: string, plataforma: 'instagram' | 'tiktok', finalidade: 'bio' | 'publicacao') {
    const { url } = await na(orgId, () => inicio.iniciarConexao(orgId, plataforma, finalidade));
    return new URL(url).searchParams.get('state')!;
  }

  function controlador(cliente: PrismaService, barreira?: Barreira) {
    const prisma = barreira ? lendoNaBarreira(cliente, barreira) : cliente;
    return new BioOauthController(prisma, new BioCredenciaisService(cliente), new AuditService(cliente));
  }

  async function chamar(c: BioOauthController, plataforma: string, codigo: string, estado: string, erro = '') {
    const res = new Redirecionamento();
    await c.callback(plataforma, codigo, estado, erro, res as never);
    return res.para;
  }

  /** O que um retorno deixou: chamadas para fora, linhas gravadas e o state. `conexoes` conta em TODAS as empresas. */
  async function efeitos(e: { codigo: string; conta: string; estado: string }) {
    const minhas = trocas.filter((t) => t.codigo === e.codigo);
    const conexao = await admin.bioConexao.findFirst({ where: { handle: e.conta } });
    return {
      trocas: minhas.length,
      stateNaTroca: minhas.map((t) => t.stateNaTroca),
      perfis: perfis.filter((p) => p === e.conta).length,
      conexoes: await admin.bioConexao.count({ where: { handle: e.conta } }),
      auditorias: conexao
        ? await admin.auditLog.count({ where: { action: 'bio.conexao_create', entityId: conexao.id } })
        : 0,
      stateNoBanco: await admin.bioOauthState.count({ where: { estado: e.estado } }),
    };
  }

  const NENHUM_EFEITO = { trocas: 0, stateNaTroca: [], perfis: 0, conexoes: 0, auditorias: 0, stateNoBanco: 0 };

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    cruA = new PrismaClient({ datasourceUrl: URL_DO_BANCO });
    cruB = new PrismaClient({ datasourceUrl: URL_DO_BANCO });
    const calado = { modo: 'observar' as const, avisar: () => undefined };
    appA = comTenantNaSessao(cruA, calado) as unknown as PrismaService;
    appB = comTenantNaSessao(cruB, calado) as unknown as PrismaService;
    const comEmpresa = comTenantNaSessao(cruA, { modo: 'impor', avisar: () => undefined }) as unknown as PrismaService;
    inicio = new BioService(comEmpresa, new AuditService(comEmpresa), {} as never, new BioCredenciaisService(comEmpresa));
    contarState = (estado) => admin.bioOauthState.count({ where: { estado } });

    const criar = (letra: string) =>
      admin.org.create({ data: { name: `CX2 ${letra} ${MARCA}`, slug: `cx2-${letra}-${MARCA}`, modulos: ['pauta', 'bio'] } });
    orgA = (await criar('a')).id;
    orgB = (await criar('b')).id;
    orgSemCredencial = (await criar('c')).id;
    for (const orgId of [orgA, orgB]) {
      for (const plataforma of ['instagram', 'tiktok'] as const) {
        await admin.bioCredencialApp.create({
          data: { plataforma, orgId, appId: `app-${plataforma}-${orgId.slice(0, 6)}`, segredoCifrado: cifrar('segredo') },
        });
      }
    }
  }, 60_000);

  afterAll(async () => {
    contarState = null;
    const orgs = [orgA, orgB, orgSemCredencial].filter(Boolean);
    if (orgs.length) {
      await admin.bioConexao.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioOauthState.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioCredencialApp.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.org.deleteMany({ where: { id: { in: orgs } } });
    }
    await Promise.all([admin?.$disconnect(), cruA?.$disconnect(), cruB?.$disconnect()]);
  });

  // -------------------------------------------------------------------------
  // A corrida
  // -------------------------------------------------------------------------

  it.each([
    ['instagram', 'bio'],
    ['instagram', 'publicacao'],
    ['tiktok', 'bio'],
  ] as const)(
    'dois retornos simultâneos do mesmo state (%s, %s), por dois clientes do banco: só um troca o código e grava; o outro volta expirado',
    async (plataforma, finalidade) => {
      const estado = await iniciar(orgA, plataforma, finalidade);
      const conta = `corrida${plataforma.slice(0, 2)}${finalidade.slice(0, 3)}${MARCA}`;
      const codigo = `${conta}:${finalidade === 'publicacao' ? 'com' : 'sem'}`;
      estadoDoCodigo.set(codigo, estado);

      const barreira = new Barreira(2);
      const voltas = await Promise.all([
        chamar(controlador(appA, barreira), plataforma, codigo, estado),
        chamar(controlador(appB, barreira), plataforma, codigo, estado),
      ]);

      expect(barreira.cheia, 'as duas leituras do state aconteceram antes de qualquer consumo').toBe(true);
      expect({ ...(await efeitos({ codigo, conta, estado })), voltas: voltas.sort() }).toEqual({
        trocas: 1,
        stateNaTroca: [0],
        perfis: 1,
        conexoes: 1,
        auditorias: 1,
        stateNoBanco: 0,
        voltas: [`${tela(finalidade)}expirado`, `${tela(finalidade)}ok`],
      });
      expect(await admin.bioConexao.findFirst({ where: { handle: conta } })).toMatchObject({ orgId: orgA, plataforma, finalidade });
    },
  );

  it('oito retornos simultâneos do mesmo state, sem barreira, por dois clientes do banco: um só chega à troca', async () => {
    const estado = await iniciar(orgA, 'instagram', 'bio');
    const conta = `rajada${MARCA}`;
    const codigo = `${conta}:sem`;
    estadoDoCodigo.set(codigo, estado);
    const [a, b] = [controlador(appA), controlador(appB)];

    const voltas = await Promise.all(Array.from({ length: 8 }, (_, i) => chamar(i % 2 ? b : a, 'instagram', codigo, estado)));

    expect({ ...(await efeitos({ codigo, conta, estado })), voltas: contagem(voltas) }).toEqual({
      trocas: 1,
      stateNaTroca: [0],
      perfis: 1,
      conexoes: 1,
      auditorias: 1,
      stateNoBanco: 0,
      voltas: { [`${TELA_BIO}ok`]: 1, [`${TELA_BIO}expirado`]: 7 },
    });
  });

  it('a plataforma falha no retorno que venceu: o state não volta, nem para o perdedor nem para a repetição', async () => {
    const estado = await iniciar(orgA, 'instagram', 'publicacao');
    const conta = `corridafalha${MARCA}`;
    const codigo = `${conta}:troca500`;
    estadoDoCodigo.set(codigo, estado);

    const barreira = new Barreira(2);
    const voltas = await Promise.all([
      chamar(controlador(appA, barreira), 'instagram', codigo, estado),
      chamar(controlador(appB, barreira), 'instagram', codigo, estado),
    ]);
    const repeticao = await chamar(controlador(appA), 'instagram', codigo, estado);

    expect(barreira.cheia).toBe(true);
    expect({ ...(await efeitos({ codigo, conta, estado })), voltas: voltas.sort(), repeticao }).toEqual({
      trocas: 1,
      stateNaTroca: [0],
      perfis: 0,
      conexoes: 0,
      auditorias: 0,
      stateNoBanco: 0,
      voltas: [`${TELA_PUB}erro`, `${TELA_PUB}expirado`],
      repeticao: `${TELA_BIO}expirado`,
    });
  });

  it('erro do banco ao gastar o state derruba o retorno antes da troca, sem gravar nada', async () => {
    const estado = await iniciar(orgA, 'instagram', 'bio');
    const conta = `bancofora${MARCA}`;
    const codigo = `${conta}:sem`;
    const semApagar = new Proxy(appA, {
      get(alvo, prop) {
        const valor = Reflect.get(alvo, prop);
        if (prop !== 'bioOauthState') return valor;
        return new Proxy(valor as object, {
          get(modelo, op) {
            if (op !== 'delete' && op !== 'deleteMany') return Reflect.get(modelo, op);
            return async () => {
              throw new Error('banco fora do ar (simulado)');
            };
          },
        });
      },
    });
    const c = new BioOauthController(semApagar, new BioCredenciaisService(appA), new AuditService(appA));

    await expect(chamar(c, 'instagram', codigo, estado)).rejects.toThrow('banco fora do ar (simulado)');
    expect(await efeitos({ codigo, conta, estado })).toEqual({ ...NENHUM_EFEITO, stateNoBanco: 1 });
  });

  it('states diferentes ao mesmo tempo seguem cada um o seu: o consumo de um não barra o outro', async () => {
    const estadoA = await iniciar(orgA, 'instagram', 'bio');
    const estadoB = await iniciar(orgB, 'instagram', 'bio');
    const conta = `paralelo${MARCA}`;

    const barreira = new Barreira(2);
    const voltas = await Promise.all([
      chamar(controlador(appA, barreira), 'instagram', `${conta}:sem:a`, estadoA),
      chamar(controlador(appB, barreira), 'instagram', `${conta}:sem:b`, estadoB),
    ]);

    expect(barreira.cheia).toBe(true);
    expect(voltas).toEqual([`${TELA_BIO}ok`, `${TELA_BIO}ok`]);
    expect(trocas.filter((t) => t.codigo.startsWith(`${conta}:`)).length).toBe(2);
    const gravadas = await admin.bioConexao.findMany({ where: { handle: conta } });
    expect(gravadas.map((c) => c.orgId).sort()).toEqual([orgA, orgB].sort());
    expect(await admin.bioOauthState.count({ where: { estado: { in: [estadoA, estadoB] } } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // O que continua valendo
  // -------------------------------------------------------------------------

  it.each(['bio', 'publicacao'] as const)(
    'o fluxo válido (%s): grava na empresa do state, com a finalidade dele, e volta para a tela que o pediu',
    async (finalidade) => {
      const estado = await iniciar(orgA, 'instagram', finalidade);
      const conta = `valido${finalidade.slice(0, 3)}${MARCA}`;
      const codigo = `${conta}:${finalidade === 'publicacao' ? 'com' : 'sem'}`;
      estadoDoCodigo.set(codigo, estado);

      const volta = await chamar(controlador(appA), 'instagram', codigo, estado);

      expect(volta).toBe(`${tela(finalidade)}ok`);
      expect(await efeitos({ codigo, conta, estado })).toEqual({
        trocas: 1,
        stateNaTroca: [0],
        perfis: 1,
        conexoes: 1,
        auditorias: 1,
        stateNoBanco: 0,
      });
      expect(trocas.find((t) => t.codigo === codigo)?.redirectUri).toBe('https://bio.exemplo.test/api/conectar/instagram/callback');
      const c = await admin.bioConexao.findFirstOrThrow({ where: { handle: conta } });
      expect(c).toMatchObject({ orgId: orgA, finalidade, status: 'ok', externalId: `id-${conta}` });
      expect(decifrar(c.tokenCifrado)).toBe(`longo-curto-${conta}`);
      expect(chaveDoPacote(c.tokenCifrado), 'fora da conta de herdadas `env` do cofre.test.ts').toBe('cx2');
    },
  );

  it('TikTok: o verifier guardado no state vai na troca, com a redirect cadastrada no console', async () => {
    const estado = await iniciar(orgA, 'tiktok', 'bio');
    const { verifier } = await admin.bioOauthState.findUniqueOrThrow({ where: { estado } });
    const conta = `tiktok${MARCA}`;
    const codigo = `${conta}:sem`;
    estadoDoCodigo.set(codigo, estado);

    expect(await chamar(controlador(appA), 'tiktok', codigo, estado)).toBe(`${TELA_BIO}ok`);

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(trocas.filter((t) => t.codigo === codigo)).toEqual([
      { codigo, redirectUri: 'https://bio.exemplo.test/api/conectar/tiktok/callback', verifier, stateNaTroca: 0 },
    ]);
    const c = await admin.bioConexao.findFirstOrThrow({ where: { handle: conta } });
    expect(c).toMatchObject({ orgId: orgA, plataforma: 'tiktok', finalidade: 'bio', externalId: `open-${conta}` });
    expect(decifrar(c.refreshCifrado!)).toBe(`rf-${conta}`);
    expect([chaveDoPacote(c.tokenCifrado), chaveDoPacote(c.refreshCifrado!)]).toEqual(['cx2', 'cx2']);
  });

  it('o state vencido é recusado e gasto, sem chamar a plataforma', async () => {
    const estado = await iniciar(orgA, 'instagram', 'publicacao');
    await admin.bioOauthState.update({ where: { estado }, data: { expiraEm: new Date(Date.now() - 1_000) } });
    const conta = `vencido${MARCA}`;
    const codigo = `${conta}:com`;

    expect(await chamar(controlador(appA), 'instagram', codigo, estado)).toBe(`${TELA_PUB}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual(NENHUM_EFEITO);
  });

  it('o state que nunca existiu é recusado sem chamar a plataforma nem gravar nada', async () => {
    const estado = randomBytes(24).toString('base64url');
    const conta = `inexistente${MARCA}`;
    const codigo = `${conta}:com`;

    expect(await chamar(controlador(appA), 'instagram', codigo, estado)).toBe(`${TELA_BIO}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual(NENHUM_EFEITO);
  });

  it('o state de outra plataforma é recusado e gasto, sem chamar nenhuma das duas', async () => {
    const estado = await iniciar(orgA, 'instagram', 'bio');
    const conta = `trocada${MARCA}`;
    const codigo = `${conta}:sem`;

    expect(await chamar(controlador(appA), 'tiktok', codigo, estado)).toBe(`${TELA_BIO}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual(NENHUM_EFEITO);
  });

  it('o state já usado é recusado na repetição, sem segunda troca nem segunda gravação', async () => {
    const estado = await iniciar(orgA, 'instagram', 'bio');
    const conta = `repetido${MARCA}`;
    const codigo = `${conta}:sem`;
    estadoDoCodigo.set(codigo, estado);

    expect(await chamar(controlador(appA), 'instagram', codigo, estado)).toBe(`${TELA_BIO}ok`);
    expect(await chamar(controlador(appB), 'instagram', codigo, estado)).toBe(`${TELA_BIO}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual({
      trocas: 1,
      stateNaTroca: [0],
      perfis: 1,
      conexoes: 1,
      auditorias: 1,
      stateNoBanco: 0,
    });
  });

  it.each([
    ['a troca do código responde 500', 'troca500', 1, 0],
    ['o perfil responde 500 depois da troca', 'perfil500', 1, 1],
    ['a plataforma está fora do ar (conexão recusada)', 'rede', 1, 0],
  ] as const)(
    '%s: o retorno volta com erro, o state segue gasto e a repetição é recusada sem nova troca',
    async (_nome, forma, trocasEsperadas, perfisEsperados) => {
      const estado = await iniciar(orgA, 'instagram', 'publicacao');
      const conta = `falha${forma}${MARCA}`;
      const codigo = `${conta}:${forma === 'rede' ? 'com' : forma}`;
      estadoDoCodigo.set(codigo, estado);

      const tokenUrl = process.env.INSTAGRAM_TOKEN_URL;
      if (forma === 'rede') process.env.INSTAGRAM_TOKEN_URL = `http://127.0.0.1:${portaFechada}/oauth/access_token`;
      let volta: string;
      try {
        volta = await chamar(controlador(appA), 'instagram', codigo, estado);
      } finally {
        process.env.INSTAGRAM_TOKEN_URL = tokenUrl;
      }
      const repeticao = await chamar(controlador(appB), 'instagram', codigo, estado);

      expect({ ...(await efeitos({ codigo, conta, estado })), volta, repeticao }).toEqual({
        trocas: trocasEsperadas,
        stateNaTroca: [0],
        perfis: perfisEsperados,
        conexoes: 0,
        auditorias: 0,
        stateNoBanco: 0,
        volta: `${TELA_PUB}erro`,
        repeticao: `${TELA_BIO}expirado`,
      });
    },
  );

  it('sem credencial do app, o state é gasto antes e a repetição é recusada', async () => {
    const estado = randomBytes(24).toString('base64url');
    await admin.bioOauthState.create({
      data: { estado, orgId: orgSemCredencial, plataforma: 'instagram', finalidade: 'bio', expiraEm: new Date(Date.now() + 600_000) },
    });
    const conta = `semcred${MARCA}`;
    const codigo = `${conta}:sem`;

    expect(await chamar(controlador(appA), 'instagram', codigo, estado)).toBe(`${TELA_BIO}sem_credencial`);
    expect(await chamar(controlador(appB), 'instagram', codigo, estado)).toBe(`${TELA_BIO}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual(NENHUM_EFEITO);
  });

  it('cancelar na tela da plataforma gasta o state: o retorno com código depois disso é recusado', async () => {
    const estado = await iniciar(orgA, 'instagram', 'publicacao');
    const conta = `cancelado${MARCA}`;
    const codigo = `${conta}:com`;

    expect(await chamar(controlador(appA), 'instagram', '', estado, 'access_denied')).toBe(`${TELA_PUB}cancelado`);
    expect(await chamar(controlador(appB), 'instagram', codigo, estado)).toBe(`${TELA_BIO}expirado`);
    expect(await efeitos({ codigo, conta, estado })).toEqual(NENHUM_EFEITO);
  });
});
