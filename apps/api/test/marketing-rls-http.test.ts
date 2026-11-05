import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApprovalsController } from '../src/approvals/approvals.controller';
import { AuditService } from '../src/audit/audit.service';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { BioController } from '../src/bio/bio.controller';
import { ClienteEscopoInterceptor } from '../src/clientes-escopo/cliente-escopo.interceptor';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { CofreDaEmpresaController } from '../src/cofre-da-empresa/cofre-da-empresa.controller';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { comContextoDaEmpresaResolvida } from '../src/prisma/contexto-de-plataforma';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import { ComercialController } from '../src/comercial/comercial.controller';
import { FinanceController } from '../src/finance/finance.controller';
import { FinanceService } from '../src/finance/finance.service';
import { GoogleController } from '../src/google/google.controller';
import type { GoogleService } from '../src/google/google.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { MaquinaDeConteudoController } from '../src/maquina-de-conteudo/maquina-de-conteudo.controller';
import { MaquinaDeConteudoService } from '../src/maquina-de-conteudo/maquina-de-conteudo.service';
import { FluxoDeIdeiasService } from '../src/marketing-estudio/fluxo-de-ideias.service';
import { GostoDaRootService } from '../src/marketing-estudio/gosto-da-root.service';
import { ImportacaoDaComunidadeService } from '../src/marketing-estudio/importacao-da-comunidade.service';
import { MarketingEstudioController } from '../src/marketing-estudio/marketing-estudio.controller';
import { MemoriaDoMarketingService } from '../src/marketing-estudio/memoria-do-marketing.service';
import { ReguasService } from '../src/marketing-estudio/reguas.service';
import { TriagemService } from '../src/marketing-estudio/triagem.service';
import { MarketingPreparacaoController } from '../src/marketing-preparacao/marketing-preparacao.controller';
import { MarketingPreparacaoService } from '../src/marketing-preparacao/marketing-preparacao.service';
import { AcessoAtualGuard } from '../src/memory/acesso-atual.guard';
import type { MemoriaService } from '../src/memory/memoria.service';
import { ApifyService } from '../src/pauta/apify.service';
import { BrandbookController } from '../src/pauta/brandbook.controller';
import { BrandbookService } from '../src/pauta/brandbook.service';
import { EditorialService } from '../src/pauta/editorial.service';
import type { MarcaService } from '../src/pauta/marca.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao, modoDoTenant } from '../src/prisma/sessao-de-banco';
import { ModulosController } from '../src/tenants/modulos.controller';
import { ModulosInterceptor } from '../src/tenants/modulos.interceptor';
import { ModulosService } from '../src/tenants/modulos.service';
import { UsersController } from '../src/users/users.controller';
import { WorkController } from '../src/work/work.controller';
import { WorkFilesService } from '../src/work/work-files.service';
import { exigirBancoDescartavel } from './banco-de-teste';

function bancoLocal(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} é obrigatório para a prova HTTP com RLS.`);
  if (!['localhost', '127.0.0.1'].includes(new URL(valor).hostname)) throw new Error('Esta suíte exige PostgreSQL local.');
  exigirBancoDescartavel(valor, 'cria organizações sintéticas e apaga apenas as suas fixtures');
  return valor;
}

const donoUrl = bancoLocal('TEST_DATABASE_URL');
const appUrl = new URL(bancoLocal('TENANT_DATABASE_URL'));
const destino = (url: URL) => [url.hostname === 'localhost' ? '127.0.0.1' : url.hostname, url.port || '5432', url.pathname].join(':');
if (destino(new URL(donoUrl)) !== destino(appUrl)) throw new Error('Fixtures e aplicação devem conectar ao mesmo banco.');
appUrl.searchParams.set('connection_limit', '1');

const senha = 'senha-local-sintetica';
const permissaoMarketing = ['pauta.ver', 'pauta.editar'];
const permissaoPreparo = [...permissaoMarketing, 'pauta.publicar', 'tarefas.ver', 'tarefas.editar', 'bio.editar', 'admin.usuarios'];
const estudio = '/api/marketing/estudio';
const maquina = '/api/marketing/maquina';
const preparo = '/api/marketing/preparacao';
const marcaQa = randomUUID();

type Pessoa = { id: string; email: string };
type Sessao = { token: string; user: { permissions: string[] } };

describe('Marketing com HTTP, mktos_app e RLS', () => {
  const dono = new PrismaClient({ datasourceUrl: donoUrl });
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const orgA = randomUUID();
  const orgB = randomUUID();
  let operadorA: Pessoa;
  let operadorB: Pessoa;
  let permissoesSemModulo: Pessoa;
  let operadorPreparoA: Pessoa;
  let aprovadorA: Pessoa;
  let aprovadorB: Pessoa;
  let tokenA: string;
  let tokenB: string;
  let tokenPreparoA: string;
  let tokenSemModulo: string;
  let editorial: EditorialService;
  let gosto: GostoDaRootService;
  let notaA: string;
  let notaB: string;
  let cardA: string;
  let cardB: string;
  let postA: string;
  let postB: string;
  const apify = { configured: true, usoDoMes: vi.fn(async () => ({ usadoUsd: 7, tetoUsd: 10, voltaEm: null })) };
  const drive = {
    filhosDaPasta: vi.fn(async () => [{ id: 'pasta-sintetica', nome: 'pasta-sintetica', mimeType: 'application/vnd.google-apps.folder' }]),
    gravarArquivoNoDrive: vi.fn(async () => ({ id: 'arquivo-sintetico', atualizado: false })),
    baixarTextoDoDrive: vi.fn(async () => '# conteúdo sintético'),
  };

  async function http(method: string, caminho: string, token?: string, body?: unknown) {
    const r = await fetch(base + caminho, {
      method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() as unknown };
  }

  async function login(pessoa: Pessoa) {
    const resposta = await http('POST', '/api/auth/login', undefined, { email: pessoa.email, password: senha });
    expect(resposta).toMatchObject({ status: 201, body: { token: expect.any(String) } });
    return resposta.body as Sessao;
  }

  beforeAll(async () => {
    vi.stubEnv('TENANT_MODO', 'impor');
    vi.stubEnv('MEMORIA_DRIVE_DESLIGADO', '0');
    vi.stubEnv('MARKETING_IA_SIMULADA', '1');
    prisma = comTenantNaSessao(new PrismaService({ datasourceUrl: appUrl.toString() }), { modo: modoDoTenant() });
    const [papel] = await comContextoDaEmpresaResolvida(orgA, () =>
      prisma.$queryRaw<Array<{ papel: string; super: boolean; bypass: boolean }>>`
        SELECT current_user::text AS papel, rolsuper AS super, rolbypassrls AS bypass
        FROM pg_roles WHERE rolname = current_user
      `);
    expect(papel).toEqual({ papel: 'mktos_app', super: false, bypass: false });
    await dono.org.createMany({ data: [
      { id: orgA, name: 'QA Marketing A', slug: `qa-mkt-a-${marcaQa}`, modulos: ['pauta'] },
      { id: orgB, name: 'QA Marketing B', slug: `qa-mkt-b-${marcaQa}`, modulos: ['pauta', 'financeiro'] },
    ] });
    const chaves = [...new Set([...permissaoPreparo, 'financeiro.ver'])];
    await dono.permission.createMany({ data: chaves.map(key => ({ key })), skipDuplicates: true });
    const hash = await bcrypt.hash(senha, 4);
    async function pessoa(orgId: string, key: string, permissions: string[], roleKey = key): Promise<Pessoa> {
      const role = await dono.role.upsert({
        where: { orgId_key: { orgId, key: roleKey } },
        create: { orgId, key: roleKey, name: key, permissions: { connect: permissions.map(p => ({ key: p })) } },
        update: {},
      });
      const user = await dono.user.create({
        data: { orgId, name: key, email: `${key}.${marcaQa}@qa.invalid`, passwordHash: hash, roles: { connect: { id: role.id } } },
      });
      await dono.clienteAcessoPerfil.create({ data: { orgId, userId: user.id, modo: 'ALL' } });
      return user;
    }
    operadorA = await pessoa(orgA, 'qa-marketing-a', permissaoMarketing);
    operadorB = await pessoa(orgB, 'qa-marketing-b', [...permissaoPreparo, 'financeiro.ver']);
    permissoesSemModulo = await pessoa(orgA, 'qa-modulo-desligado', [...permissaoMarketing, 'financeiro.ver']);
    operadorPreparoA = await pessoa(orgA, 'qa-preparo-a', permissaoPreparo);
    aprovadorA = await pessoa(orgA, 'qa-aprovador-a', permissaoPreparo, 'admin_master');
    aprovadorB = await pessoa(orgB, 'qa-aprovador-b', permissaoPreparo, 'admin_master');

    for (const [orgId, sufixo] of [[orgA, 'A'], [orgB, 'B']]) {
      const nota = await dono.marketingNota.create({ data: { orgId, titulo: `Nota ${sufixo}`, corpo: `Corpo da nota ${sufixo}` } });
      const card = await dono.marketingIdeiaCard.create({
        data: { orgId, notaId: nota.id, titulo: `Card ${sufixo}`, comentario: `Comentário privado ${sufixo}` },
      });
      const post = await dono.marketingPost.create({
        data: { orgId, titulo: `Post ${sufixo}`, cardId: card.id, ordem: 8, recursos: [{ tipo: 'arquivo', nome: `arquivo-${sufixo}.md`, conteudo: `arquivo privado ${sufixo}` }] },
      });
      await dono.marketingRegua.create({ data: { orgId, formato: 'Reel', regras: `Régua ${sufixo}` } });
      await dono.marketingMaquinaAjuste.create({ data: { orgId, cadencia: sufixo === 'A' ? [1] : [5] } });
      if (orgId === orgA) [notaA, cardA, postA] = [nota.id, card.id, post.id];
      else [notaB, cardB, postB] = [nota.id, card.id, post.id];
    }

    const audit = new AuditService(prisma);
    const escopo = new ClienteEscopoService(prisma, audit);
    const modulos = new ModulosService(prisma);
    const marca = { pilares: vi.fn(async () => []), bloco: vi.fn(async () => '') } as unknown as MarcaService;
    const llm = { complete: vi.fn(async () => { throw new Error('Provedor externo fora desta prova'); }) } as unknown as LlmProvider;
    const google = drive as unknown as GoogleService;
    const memoria = new MemoriaDoMarketingService(prisma, marca, llm, undefined, google, apify as unknown as ApifyService);
    gosto = new GostoDaRootService(prisma, llm, google);
    const triagem = new TriagemService(prisma, marca, llm, undefined, memoria, gosto);
    const reguas = new ReguasService(prisma, marca, llm, google, gosto);
    editorial = new EditorialService(prisma, audit, new WorkFilesService(prisma));
    const preparacao = new MarketingPreparacaoService(prisma, audit, editorial);
    const livros = new BrandbookService({} as MemoriaService, prisma);
    const fin = { listAccounts: vi.fn(async () => []) };
    jwt = new JwtService({ secret: randomUUID() + randomUUID(), signOptions: { expiresIn: '15m' } });
    const reflector = new Reflector();
    const controllers = [
      [AuthController, [AuthService]], [ModulosController, [ModulosService]],
      [MarketingEstudioController, [MemoriaDoMarketingService, TriagemService, ReguasService, ImportacaoDaComunidadeService, FluxoDeIdeiasService]],
      [MaquinaDeConteudoController, [MaquinaDeConteudoService]], [MarketingPreparacaoController, [MarketingPreparacaoService]],
      [BrandbookController, [BrandbookService]], [FinanceController, [FinanceService]],
      [BioController, []], [ComercialController, []], [WorkController, []], [GoogleController, []],
      [CofreDaEmpresaController, []], [ApprovalsController, []], [UsersController, []],
    ] as const;
    // O transpiler de testes não emite os metadados de injeção dos construtores.
    for (const [controller, deps] of controllers) Reflect.defineMetadata('design:paramtypes', deps, controller);
    const modulo = await Test.createTestingModule({
      controllers: controllers.map(([controller]) => controller),
      providers: [
        { provide: AuthService, useValue: new AuthService(prisma, jwt, audit) },
        { provide: ModulosService, useValue: modulos },
        { provide: MemoriaDoMarketingService, useValue: memoria },
        { provide: TriagemService, useValue: triagem },
        { provide: ReguasService, useValue: reguas },
        { provide: ImportacaoDaComunidadeService, useValue: new ImportacaoDaComunidadeService(prisma, reguas) },
        { provide: FluxoDeIdeiasService, useValue: new FluxoDeIdeiasService(prisma, triagem, memoria) },
        { provide: MaquinaDeConteudoService, useValue: new MaquinaDeConteudoService(prisma, marca) },
        { provide: MarketingPreparacaoService, useValue: preparacao },
        { provide: BrandbookService, useValue: livros },
        { provide: FinanceService, useValue: fin },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt, prisma, escopo))
      .overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector))
      .overrideGuard(AcessoAtualGuard).useValue(new AcessoAtualGuard(prisma, reflector))
      .compile();
    app = modulo.createNestApplication({ logger: ['error'] });
    app.setGlobalPrefix('api');
    app.useGlobalInterceptors(new ContextoInterceptor(), new ModulosInterceptor(modulos), new ClienteEscopoInterceptor(reflector, escopo));
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const sessaoA = await login(operadorA);
    expect(sessaoA.user.permissions.sort()).toEqual([...permissaoMarketing].sort());
    tokenA = sessaoA.token;
    tokenB = (await login(operadorB)).token;
    tokenPreparoA = (await login(operadorPreparoA)).token;
    tokenSemModulo = (await login(permissoesSemModulo)).token;
  }, 60_000);

  afterAll(async () => {
    try {
      await app?.close();
      await prisma?.$disconnect();
      const where = { orgId: { in: [orgA, orgB] } };
      await dono.marketingPreparation.deleteMany({ where });
      await dono.marketingAccountConfig.deleteMany({ where });
      await dono.editorialProduction.deleteMany({ where });
      await dono.editorialDecision.deleteMany({ where });
      await dono.editorialMaterial.updateMany({ where, data: { selectedVersionId: null } });
      await dono.editorialVersion.deleteMany({ where });
      await dono.editorialMaterial.deleteMany({ where });
      await dono.bioConexao.deleteMany({ where });
      await dono.workTask.deleteMany({ where });
      await dono.workStatus.deleteMany({ where });
      await dono.workList.deleteMany({ where });
      await dono.marketingPost.deleteMany({ where });
      await dono.marketingRegua.deleteMany({ where });
      await dono.marketingMaquinaAjuste.deleteMany({ where });
      await dono.marketingIdeiaCard.deleteMany({ where });
      await dono.marketingNota.deleteMany({ where });
      await dono.rotina.deleteMany({ where });
      await dono.auditLog.deleteMany({ where });
      await dono.clienteAcessoPerfil.deleteMany({ where });
      await dono.user.deleteMany({ where });
      await dono.role.deleteMany({ where });
      await dono.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    } finally {
      await dono.$disconnect();
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it('alterna organizações na mesma conexão sem misturar notas, grafo, cards, posts ou cadência', async () => {
    for (const [token, propria, estrangeira, post, outroPost, sufixo, cadencia] of [
      [tokenA, notaA, notaB, postA, postB, 'A', [1]],
      [tokenB, notaB, notaA, postB, postA, 'B', [5]],
      [tokenA, notaA, notaB, postA, postB, 'A', [1]],
    ] as const) {
      const lista = await http('GET', estudio + '/memoria', token);
      expect(lista.status).toBe(200);
      expect(JSON.stringify(lista.body)).toContain(propria);
      expect(JSON.stringify(lista.body)).not.toContain(estrangeira);
      expect(await http('GET', estudio + '/memoria/grafo', token)).toMatchObject({
        status: 200, body: { nodes: [expect.objectContaining({ id: propria })] },
      });
      expect(await http('GET', estudio + '/memoria/notas/' + propria, token)).toMatchObject({ status: 200 });
      expect(await http('GET', estudio + '/memoria/notas/' + estrangeira, token)).toMatchObject({ status: 404 });
      expect(await http('GET', estudio + '/formatos', token)).toMatchObject({
        status: 200, body: expect.arrayContaining([expect.objectContaining({ formato: 'Reel', regras: `Régua ${sufixo}` })]),
      });
      const painel = await http('GET', maquina, token);
      expect(painel).toMatchObject({ status: 200, body: { cadencia, posts: [{
        id: post,
        arquivos: [{ conteudo: `arquivo privado ${sufixo}` }],
        comentarioDaIdeia: { texto: `Comentário privado ${sufixo}` },
      }] } });
      expect(JSON.stringify(painel.body)).not.toContain(outroPost);
    }
    const semFiltroDaAplicacao = await comContextoDaEmpresaResolvida(orgA, () => prisma.marketingNota.findMany({ select: { id: true } }));
    expect(semFiltroDaAplicacao).toEqual([{ id: notaA }]);
  });

  it('grava na própria organização e recusa alterações por ID estrangeiro sem tocar na origem', async () => {
    const estrangeiros = {
      post: await dono.marketingPost.findUniqueOrThrow({ where: { id: postB } }),
      nota: await dono.marketingNota.findUniqueOrThrow({ where: { id: notaB } }),
      card: await dono.marketingIdeiaCard.findUniqueOrThrow({ where: { id: cardB } }),
    };
    const novo = await http('POST', maquina + '/posts', tokenA, { titulo: 'Post novo A', orgId: orgB });
    expect(novo).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    const id = (novo.body as { id: string }).id;
    expect(await dono.marketingPost.findUnique({ where: { id }, select: { orgId: true } })).toEqual({ orgId: orgA });
    expect(await http('PUT', maquina + '/posts/' + postB, tokenA, { titulo: 'Tentativa cruzada' })).toMatchObject({ status: 404 });
    expect(await http('POST', maquina + '/ordem', tokenA, { ids: [postB, postA] })).toMatchObject({ status: 201 });
    expect(await dono.marketingPost.findUnique({ where: { id: postA }, select: { ordem: true } })).toEqual({ ordem: 1 });
    expect(await http('PUT', estudio + '/memoria/notas/' + notaA, tokenA, { titulo: 'Nota revisada A' })).toMatchObject({ status: 200 });
    expect(await http('PUT', estudio + '/memoria/notas/' + notaB, tokenA, { titulo: 'Tentativa cruzada' })).toMatchObject({ status: 404 });
    expect(await http('POST', estudio + '/triagem/' + cardB + '/decisao', tokenA, { decisao: 'aprovada' })).toMatchObject({ status: 404 });
    expect(await dono.marketingPost.findUnique({ where: { id: postB } })).toEqual(estrangeiros.post);
    expect(await dono.marketingNota.findUnique({ where: { id: notaB } })).toEqual(estrangeiros.nota);
    expect(await dono.marketingIdeiaCard.findUnique({ where: { id: cardB } })).toEqual(estrangeiros.card);
  });

  it('oculta a relação de card adulterada no próprio post', async () => {
    await dono.marketingPost.update({ where: { id: postA }, data: { cardId: cardB } });
    try {
      const painel = await http('GET', maquina, tokenA);
      expect(painel).toMatchObject({ status: 200, body: { posts: expect.arrayContaining([
        expect.objectContaining({ id: postA, comentarioDaIdeia: null }),
      ]) } });
      expect(JSON.stringify(painel.body)).not.toContain('Comentário privado B');
    } finally {
      await dono.marketingPost.update({ where: { id: postA }, data: { cardId: cardA } });
    }
  });

  it('separa o papel Marketing dos módulos e verifica a organização da sessão', async () => {
    expect(await http('GET', '/api/tenants/modulos', tokenA)).toMatchObject({ status: 200, body: { modulos: ['pauta'] } });
    for (const rota of ['/finance/accounts', '/comercial/funil', '/trabalho/tarefas', '/bio/pages', '/google/drive', '/cofre-da-empresa/estado', '/approvals/fila', '/users']) {
      expect((await http('GET', '/api' + rota, tokenA)).status, rota).toBe(403);
    }
    expect(await http('GET', '/api/finance/accounts', tokenSemModulo)).toMatchObject({ status: 404 });
    expect(await http('GET', '/api/finance/accounts', tokenB)).toMatchObject({ status: 200 });
    expect(await http('GET', '/api/finance/accounts', tokenSemModulo)).toMatchObject({ status: 404 });
    const tokenTrocado = await jwt.signAsync({ typ: 'sessao', orgId: orgB, sub: operadorA.id, permissions: permissaoMarketing });
    expect(await http('GET', maquina, tokenTrocado)).toMatchObject({ status: 401 });
    expect(await http('GET', preparo + '/configuracao', tokenA)).toMatchObject({ status: 403 });
  });

  async function vinculoEditorial(orgId: string, ator: Pessoa, aprovador: Pessoa) {
    const c = await dono.bioConexao.create({
      data: { orgId, plataforma: 'instagram', externalId: randomUUID(), handle: `qa_${orgId}`, tokenCifrado: 'fixture-sem-token', finalidade: 'publicacao', status: 'ok', escopos: 'instagram_business_content_publish' },
    });
    const lista = await dono.workList.create({ data: { orgId, name: 'Lista QA Marketing' } });
    const status = await dono.workStatus.create({ data: { orgId, listId: lista.id, name: 'Liberado' } });
    const task = await dono.workTask.create({ data: { orgId, listId: lista.id, statusId: status.id, title: 'Peça QA' } });
    const material = await comContextoDaEmpresaResolvida(orgId, () => editorial.criar(orgId, ator.id, {
      requestId: randomUUID(), taskId: task.id, releaseStatusId: status.id, title: 'Peça QA', body: 'Texto editorial QA', sourceRef: 'fixture', files: [],
    }));
    const versao = await dono.editorialVersion.findUniqueOrThrow({ where: { id: material.versionId } });
    const decisao = await comContextoDaEmpresaResolvida(orgId, () => editorial.decidir(orgId, aprovador.id, {
      requestId: randomUUID(), versionId: versao.id, contentHash: versao.contentHash, state: 'approved', reason: 'QA',
    }));
    return { c, taskId: task.id, versionId: versao.id, decisionId: decisao.decisionId, contentHash: versao.contentHash };
  }

  it('isola conexão, dono, conta, tarefa e decisão editorial no preparo', async () => {
    const a = await vinculoEditorial(orgA, operadorPreparoA, aprovadorA);
    const b = await vinculoEditorial(orgB, operadorB, aprovadorB);
    const cadastrar = (token: string, connectionId: string, ownerId: string) =>
      http('POST', preparo + '/contas', token, { requestId: randomUUID(), connectionId, ownerId });
    expect(await cadastrar(tokenPreparoA, b.c.id, operadorPreparoA.id)).toMatchObject({ status: 404 });
    expect(await cadastrar(tokenPreparoA, a.c.id, operadorB.id)).toMatchObject({ status: 403 });
    const contaA = await cadastrar(tokenPreparoA, a.c.id, operadorPreparoA.id);
    const contaB = await cadastrar(tokenB, b.c.id, operadorB.id);
    expect(contaA).toMatchObject({ status: 201, body: { account: { connectionId: a.c.id } } });
    expect(contaB).toMatchObject({ status: 201, body: { account: { connectionId: b.c.id } } });
    const idA = (contaA.body as { account: { id: string } }).account.id;
    const idB = (contaB.body as { account: { id: string } }).account.id;
    const { c: _, ...vinculo } = a;
    const entrada = { ...vinculo, accountId: idA, expectedAccountRevision: 1, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), timezone: 'America/Sao_Paulo' };
    for (const invalido of [{ accountId: idB }, { taskId: b.taskId }, { versionId: b.versionId }, { decisionId: b.decisionId }]) {
      const resposta = await http('POST', preparo, tokenPreparoA, { ...entrada, ...invalido, requestId: randomUUID() });
      expect([403, 404, 409]).toContain(resposta.status);
    }
    expect(await dono.marketingPreparation.count({ where: { orgId: { in: [orgA, orgB] } } })).toBe(0);
    const propria = await http('POST', preparo, tokenPreparoA, { ...entrada, requestId: randomUUID() });
    expect(propria).toMatchObject({ status: 201, body: { preparation: { accountId: idA } } });
    const id = (propria.body as { preparation: { id: string } }).preparation.id;
    expect(await http('GET', preparo + '/' + id, tokenPreparoA)).toMatchObject({ status: 200, body: { publicationAvailable: false } });
    expect(await http('GET', preparo + '/' + id, tokenB)).toMatchObject({ status: 404 });
    expect(await http('GET', preparo, tokenA)).toMatchObject({ status: 200, body: { accounts: [], preparations: [] } });
  });

  it('contém o orçamento Apify compartilhado nas duas rotas de leitura', async () => {
    const uso = await http('GET', estudio + '/apify/uso', tokenA);
    expect.soft(uso).toMatchObject({ status: 200, body: { uso: null, configurado: false } });
    const fluxo = await http('GET', estudio + '/fluxo', tokenA);
    expect.soft(fluxo.status).toBe(200);
    expect.soft(JSON.stringify(fluxo.body)).not.toContain('"usadoUsd":7');
    expect.soft(apify.usoDoMes).not.toHaveBeenCalled();
  });

  it('o adaptador Apify recusa orçamento e coleta de outra organização ou sem sessão de empresa', async () => {
    const anterior = process.env.APIFY_TOKEN;
    process.env.APIFY_TOKEN = 'apify-qa-sem-acesso-externo';
    const adaptador = new ApifyService(undefined, prisma);
    const provedor = vi.fn(async (url: string) => url.includes('/limits')
      ? Response.json({ data: { current: { monthlyUsageUsd: 1 }, limits: { maxMonthlyUsageUsd: 9 } } })
      : Response.json([{ title: 'sintético' }]));
    vi.stubGlobal('fetch', provedor);
    try {
      await comContextoDaEmpresaResolvida(orgA, async () => {
        await expect.soft(adaptador.usoDoMes()).resolves.toBeNull();
        await expect.soft(adaptador.scrapeUrl('https://www.instagram.com/reel/qa/')).rejects.toThrow(/não está disponível/i);
        await expect.soft(adaptador.scrapePerfil('qa', 3)).rejects.toThrow(/não está disponível/i);
        await expect.soft(adaptador.buscarNoGoogle('sintético', { resultados: 3, dias: 7 })).rejects.toThrow(/não está disponível/i);
      });
      await expect.soft(adaptador.usoDoMes()).resolves.toBeNull();
      expect.soft(provedor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (anterior === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = anterior;
    }
  });

  it('nega sincronização e importação da raiz compartilhada para Marketing externo', async () => {
    drive.filhosDaPasta.mockClear();
    expect.soft(await http('POST', estudio + '/memoria/drive/sincronizar', tokenA)).toMatchObject({ status: 404 });
    expect.soft(await http('POST', estudio + '/comunidade/importar', tokenA)).toMatchObject({ status: 404 });
    expect.soft(drive.filhosDaPasta).not.toHaveBeenCalled();
  });

  it('não usa a pasta privada de decisões como fonte ou destino de outra organização', async () => {
    drive.filhosDaPasta.mockClear();
    drive.gravarArquivoNoDrive.mockClear();
    const ler = await comContextoDaEmpresaResolvida(orgA, () => gosto.paraAIa(orgA));
    const gravar = await comContextoDaEmpresaResolvida(orgA, () => gosto.gravarDecisoes(orgA));
    expect.soft(ler).toBe('');
    expect.soft(gravar).toBe(false);
    expect.soft(drive.filhosDaPasta).not.toHaveBeenCalled();
    expect.soft(drive.gravarArquivoNoDrive).not.toHaveBeenCalled();
  });

  it('não entrega a referência empacotada da ROOT a outra organização', async () => {
    expect(await http('GET', '/api/pauta/marca/brandbook/referencia-root', tokenA)).toMatchObject({ status: 404 });
  });
});
