import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ContextoModule } from '../src/common/contexto.module';
import { ClienteEscopoModule } from '../src/clientes-escopo/cliente-escopo.module';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { ClienteEscopoController } from '../src/clientes-escopo/cliente-escopo.controller';
import { ClienteEscopoInterceptor } from '../src/clientes-escopo/cliente-escopo.interceptor';
import { TarefaEscopoService } from '../src/clientes-escopo/tarefa-escopo.service';
import { JwtAuthGuard, esquecerUsuarioAtivo } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { AcessoAtualGuard } from '../src/memory/acesso-atual.guard';
import { ContextoTrabalhoService } from '../src/memory/contexto-trabalho.service';
import { WorkController } from '../src/work/work.controller';
import { WorkService } from '../src/work/work.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { MovimentoDoQuadroService } from '../src/work/movimento-do-quadro.service';
import { AnexosDaTarefaController } from '../src/work/anexos/anexos.controller';
import { AnexosDaTarefaService } from '../src/work/anexos/anexos.service';
import { WorkFilesController } from '../src/work/work-files.controller';
import { WorkFilesService } from '../src/work/work-files.service';
import { exigirBancoDescartavel } from './banco-de-teste';

// HTTP, JWT, guards, escopo, serviços e Postgres reais. Só storage/efeitos externos
// são dublês. A conexão é explícita e local; nenhum fallback para DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  exigirBancoDescartavel(databaseUrl, 'cria e remove somente fixtures sintéticas de isolamento HTTP');
  const destino = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(destino.hostname) || !/test/i.test(destino.pathname)) {
    throw new Error('Este aceite exige Postgres local descartável com test no nome do banco.');
  }
}

describe.skipIf(!databaseUrl)('Trabalho por cliente: HTTP e Postgres descartável', { timeout: 30_000 }, () => {
  const orgId = randomUUID(), orgOutro = randomUUID(), userId = randomUUID(), adminId = randomUUID();
  const prefixo = `work-http-${randomUUID()}`;
  const jwt = new JwtService({ secret: randomUUID(), signOptions: { expiresIn: '10m' } });
  const permissoes = ['tarefas.ver', 'tarefas.editar', 'dashboard.ver', 'obsidian.ver'];
  let db: PrismaClient, app: INestApplication, base: string, token: string, adminToken: string;
  let clienteA: string, clienteB: string, interno: string, lista: string, listaB: string, status: string;
  const tarefas: Record<string, string> = {};
  const anexos: Record<string, string> = {};
  const storageGet = vi.fn(async (_chave: string) => ({ stream: Readable.from(Buffer.from('pdf')), size: 3 }));
  let files: WorkFilesService;

  const pedir = (path: string, init: RequestInit = {}, sessao?: string) => fetch(`${base}${path}`, {
    ...init, headers: { Authorization: `Bearer ${sessao ?? token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const json = async (path: string, init: RequestInit = {}, sessao?: string) => {
    const r = await pedir(path, init, sessao);
    const body = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(init.method === 'POST' ? 201 : 200);
    return body;
  };

  const listaSchema = z.object({ total: z.number(), items: z.array(z.unknown()) });
  const detalheSchema = z.object({ clienteId: z.string().nullable(), subtasks: z.number(), filhos: z.array(z.object({ id: z.string() })), lead: z.unknown(), atividade: z.unknown() });
  const idsSchema = z.array(z.object({ id: z.string() }));
  const criadaSchema = z.object({ id: z.string(), clienteId: z.string().nullable() });
  const edicaoSchema = z.object({ title: z.string(), updatedAt: z.string() });

  beforeAll(async () => {
    const urlComNome = new URL(databaseUrl!);
    urlComNome.searchParams.set('application_name', prefixo);
    db = new PrismaClient({ datasourceUrl: urlComNome.toString() });
    await db.$connect();
    await db.org.createMany({ data: [
      { id: orgId, name: 'Aceite sintético', slug: `${prefixo}-a` },
      { id: orgOutro, name: 'Outra organização sintética', slug: `${prefixo}-b` },
    ] });
    for (const key of permissoes) await db.permission.upsert({ where: { key }, create: { key }, update: {} });
    const role = await db.role.create({ data: { orgId, key: 'admin_master', name: 'Teste', permissions: { connect: permissoes.map(key => ({ key })) } } });
    for (const id of [userId, adminId]) {
      await db.user.create({ data: { id, orgId, name: 'Pessoa sintética', email: `${id}@example.invalid`, passwordHash: 'test-only', roles: { connect: { id: role.id } } } });
      await db.clienteAcessoPerfil.create({ data: { orgId, userId: id, modo: id === adminId ? 'ALL' : 'SELECTED' } });
    }
    clienteA = (await db.partner.create({ data: { orgId, isCliente: true, razaoSocial: 'Cliente A' } })).id;
    clienteB = (await db.partner.create({ data: { orgId, isCliente: true, razaoSocial: 'Cliente B secreto' } })).id;
    interno = (await db.partner.create({ data: { orgId, isCliente: true, interno: true, razaoSocial: 'Interno' } })).id;
    await db.clienteAcessoVinculo.create({ data: { orgId, userId, clienteId: clienteA } });
    lista = (await db.workList.create({ data: { orgId, name: 'Lista compartilhada' } })).id;
    listaB = (await db.workList.create({ data: { orgId, name: 'Lista B' } })).id;
    status = (await db.workStatus.create({ data: { orgId, listId: lista, name: 'Aberto', type: 'open' } })).id;
    const statusB = (await db.workStatus.create({ data: { orgId, listId: listaB, name: 'Aberto', type: 'open' } })).id;
    const criar = async (key: string, clienteId: string | null, parentId?: string, listId = lista, statusId = status) => {
      tarefas[key] = (await db.workTask.create({ data: { orgId, clienteId, parentId, listId, statusId, title: key, externalId: `${prefixo}-${key}` } })).id;
    };
    await criar('A', clienteA);
    await criar('filha-A', clienteA, tarefas.A);
    await criar('B', clienteB);
    await criar('filha-B-cruzada', clienteB, tarefas.A);
    await criar('filha-null', null, tarefas.A);
    await criar('A-pai-B', clienteA, tarefas.B);
    await criar('NULL', null);
    await criar('interno', interno);
    await criar('B-outra-lista', clienteB, undefined, listaB, statusB);
    const outraLista = await db.workList.create({ data: { orgId: orgOutro, name: 'Outra org' } });
    const outroStatus = await db.workStatus.create({ data: { orgId: orgOutro, listId: outraLista.id, name: 'Aberto', type: 'open' } });
    tarefas.outraOrg = (await db.workTask.create({ data: { orgId: orgOutro, listId: outraLista.id, statusId: outroStatus.id, title: 'Outra org' } })).id;
    const lead = await db.lead.create({ data: { orgId, name: 'Lead B secreto' } });
    await db.comercialFicha.create({ data: { orgId, leadId: lead.id, partnerId: clienteB } });
    await db.workTask.update({ where: { id: tarefas.A }, data: { leadId: lead.id } });
    await db.auditLog.create({ data: { orgId, actorId: adminId, action: 'work.task.update', entityType: 'work_task', entityId: tarefas.A, before: { segredo: 'histórico B' } } });
    for (const key of ['A', 'B']) anexos[key] = (await db.workAnexo.create({ data: { orgId, taskId: tarefas[key], nome: `${key}.pdf`, tipoMime: 'application/pdf', bytes: 3, sha256: 'a'.repeat(64), chave: `${prefixo}/${key}`, autorNome: 'Teste' } })).id;

    const prisma = db as PrismaService;
    const audit = new AuditService(prisma);
    const escopo = new ClienteEscopoService(prisma, audit);
    const tarefaEscopo = new TarefaEscopoService(prisma, escopo);
    const work = new WorkService(prisma, audit, {} as CheckoutDeTarefaService, escopo, tarefaEscopo);
    const attachments = new AnexosDaTarefaService(prisma, audit, { arquivar: vi.fn() } as never, undefined, tarefaEscopo);
    attachments.usarArmazem({ get: storageGet, put: vi.fn() });
    files = new WorkFilesService(prisma, tarefaEscopo);

    @Global()
    @Module({ providers: [
      { provide: PrismaService, useValue: prisma }, { provide: AuditService, useValue: audit }, { provide: JwtService, useValue: jwt },
    ], exports: [PrismaService, AuditService, JwtService] })
    class Dependencias {}

    // Esbuild não emite os metadados de construtor usados pelo Nest em produção.
    for (const [tipo, deps] of [
      [ClienteEscopoService, [PrismaService, AuditService]], [TarefaEscopoService, [PrismaService, ClienteEscopoService]],
      [ClienteEscopoController, [ClienteEscopoService]], [ClienteEscopoInterceptor, [Reflector, ClienteEscopoService]],
      [JwtAuthGuard, [JwtService, PrismaService, ClienteEscopoService]], [PermissionsGuard, [Reflector]],
      [AcessoAtualGuard, [PrismaService, Reflector]],
      [WorkController, [WorkService, ContextoTrabalhoService, CheckoutDeTarefaService, MovimentoDoQuadroService]],
      [AnexosDaTarefaController, [AnexosDaTarefaService]], [WorkFilesController, [WorkFilesService]],
    ] as const) Reflect.defineMetadata('design:paramtypes', deps, tipo);
    const mod = await Test.createTestingModule({
      imports: [Dependencias, ContextoModule, ClienteEscopoModule],
      controllers: [WorkController, AnexosDaTarefaController, WorkFilesController],
      providers: [
        { provide: WorkService, useValue: work }, { provide: AnexosDaTarefaService, useValue: attachments }, { provide: WorkFilesService, useValue: files },
        { provide: ContextoTrabalhoService, useValue: {} }, { provide: CheckoutDeTarefaService, useValue: {} }, { provide: MovimentoDoQuadroService, useValue: {} },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: ['error'] });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    token = await jwt.signAsync({ typ: 'sessao', sub: userId, orgId, name: 'Pessoa sintética', roles: ['admin_master'], permissions: permissoes });
    adminToken = await jwt.signAsync({ typ: 'sessao', sub: adminId, orgId, name: 'Admin sintético', roles: ['admin_master'], permissions: permissoes });
  }, 60_000);

  beforeEach(() => { storageGet.mockClear(); esquecerUsuarioAtivo(); });

  afterAll(async () => {
    await app?.close();
    esquecerUsuarioAtivo();
    if (!db) return;
    const where = { orgId: { in: [orgId, orgOutro] } };
    try {
      await db.arquivoDoCliente.deleteMany({ where });
      await db.workAnexo.deleteMany({ where });
      await db.workComment.deleteMany({ where });
      await db.workTask.deleteMany({ where });
      await db.workStatus.deleteMany({ where });
      await db.workList.deleteMany({ where });
      await db.comercialFicha.deleteMany({ where });
      await db.lead.deleteMany({ where });
      await db.auditLog.deleteMany({ where });
      await db.clienteAcessoVinculo.deleteMany({ where });
      await db.clienteAcessoPerfil.deleteMany({ where });
      await db.partner.deleteMany({ where });
      await db.user.deleteMany({ where });
      await db.role.deleteMany({ where });
      await db.org.deleteMany({ where: { id: { in: [orgId, orgOutro] } } });
    } finally { await db.$disconnect(); }
  });

  it('filtra lista, total, paginação e filhos; não inclui lead ou histórico de B', async () => {
    const r = listaSchema.parse(await json(`/trabalho/tarefas?listId=${lista}&limit=1`));
    expect(r.total).toBe(2);
    expect(r.items).toHaveLength(1);
    const d = detalheSchema.parse(await json(`/trabalho/tarefas/${tarefas.A}`));
    expect(d.clienteId).toBe(clienteA);
    expect(d.subtasks).toBe(1);
    expect(d.filhos.map((f: { id: string }) => f.id)).toEqual([tarefas['filha-A']]);
    expect(d.lead).toBeNull();
    expect(d.atividade).toEqual([]);
    expect(JSON.stringify(d)).not.toContain('secreto');
    const busca = listaSchema.parse(await json(`/trabalho/tarefas?q=B&listId=${lista}`));
    expect(busca.total).toBe(0);
  });

  it('IDs conhecidos de B, NULL, interno, outra org e pai divergente recebem 404', async () => {
    for (const key of ['B', 'NULL', 'interno', 'outraOrg', 'A-pai-B', 'filha-B-cruzada', 'filha-null']) {
      expect((await pedir(`/trabalho/tarefas/${tarefas[key]}`)).status, key).toBe(404);
    }
    expect((await pedir(`/trabalho/tarefas?cliente=${clienteB}`)).status).toBe(403);
    expect((await pedir('/trabalho/tarefas?cliente=sem')).status).toBe(403);
    const clientes = idsSchema.parse(await json('/trabalho/clientes'));
    expect(clientes.map((c: { id: string }) => c.id)).toEqual([clienteA]);
  });

  it('ALL preserva leitura do legado e cliente interno', async () => {
    for (const key of ['NULL', 'interno']) {
      const r = await pedir(`/trabalho/tarefas/${tarefas[key]}`, {}, adminToken);
      expect(r.status, `${key}: ${await r.text()}`).toBe(200);
    }
  });

  it('comentário autorizado grava no cliente A; B e cadeia divergente não gravam', async () => {
    const antes = await db.workComment.count({ where: { orgId } });
    await json(`/trabalho/tarefas/${tarefas.A}/comentarios`, { method: 'POST', body: JSON.stringify({ text: 'Comentário de aceite sintético' }) });
    for (const key of ['B', 'A-pai-B']) expect((await pedir(`/trabalho/tarefas/${tarefas[key]}/comentarios`, { method: 'POST', body: JSON.stringify({ text: 'não gravar' }) })).status).toBe(404);
    expect(await db.workComment.count({ where: { orgId } })).toBe(antes + 1);
    expect(await db.auditLog.count({ where: { orgId, actorId: userId, action: 'work.comment.create' } })).toBe(1);
  });

  it('arquivo A entrega bytes; IDs B não chegam ao storage ou ao leitor migrado', async () => {
    const listaDeAnexos = idsSchema.parse(await json(`/trabalho/tarefas/${tarefas.A}/anexos`));
    expect(listaDeAnexos.map((a: { id: string }) => a.id)).toEqual([anexos.A]);
    const a = await pedir(`/trabalho/tarefas/${tarefas.A}/anexos/${anexos.A}/arquivo`);
    expect(a.status).toBe(200);
    expect(await a.text()).toBe('pdf');
    expect(a.headers.get('cache-control')).toContain('no-store');
    storageGet.mockClear();
    expect((await pedir(`/trabalho/tarefas/${tarefas.B}/anexos/${anexos.B}/arquivo`)).status).toBe(404);
    expect((await pedir(`/trabalho/tarefas/${tarefas.A}/anexos/${anexos.B}/arquivo`)).status).toBe(404);
    expect(storageGet).not.toHaveBeenCalled();
    const leitura = vi.spyOn(files, 'read');
    expect((await pedir(`/trabalho/arquivos/${prefixo}-B/arquivo-conhecido`)).status).toBe(404);
    expect(leitura).not.toHaveBeenCalled();
    leitura.mockRestore();
  });

  it('rotas ainda organizacionais continuam contidas pelo guard real', async () => {
    for (const path of ['/trabalho/estrutura', `/trabalho/tarefas/${tarefas.A}/fontes`, `/trabalho/tarefas/${tarefas.A}/atividade`]) {
      expect((await pedir(path)).status, path).toBe(403);
    }
    expect((await pedir(`/trabalho/tarefas/${tarefas.A}/anexos`, { method: 'POST', body: '{}' })).status).toBe(403);
  });

  it('cria tarefa e filha em A; recusa cliente, pai ou lista B sem escrita parcial', async () => {
    const criar = (body: object) => pedir('/trabalho/tarefas', { method: 'POST', body: JSON.stringify(body) });
    const r = await criar({ listId: lista, clienteId: clienteA, title: 'Criada pelo HTTP' });
    expect(r.status, await r.clone().text()).toBe(201);
    const nova = criadaSchema.parse(await r.json());
    expect(nova.clienteId).toBe(clienteA);
    const filha = await criar({ listId: lista, parentId: nova.id, title: 'Filha criada pelo HTTP' });
    expect(filha.status, await filha.clone().text()).toBe(201);
    expect(criadaSchema.parse(await filha.json()).clienteId).toBe(clienteA);
    const antes = await db.workTask.count({ where: { orgId } });
    for (const body of [
      { listId: lista, clienteId: clienteB, title: 'nega B' },
      { listId: lista, clienteId: clienteA, parentId: tarefas.B, title: 'nega pai B' },
      { listId: listaB, clienteId: clienteA, title: 'nega lista B' },
      { listId: lista, title: 'nega sem cliente' },
      { listId: lista, clienteId: interno, title: 'nega interno' },
    ]) expect([400, 403, 404]).toContain((await criar(body)).status);
    expect(await db.workTask.count({ where: { orgId } })).toBe(antes);
  });

  it('edita conteúdo de A com versão; recusa relações e tarefa B', async () => {
    const task = await db.workTask.findUniqueOrThrow({ where: { id: tarefas.A } });
    const body = { expectedUpdatedAt: task.updatedAt.toISOString(), title: 'A editada pelo HTTP' };
    const d = edicaoSchema.parse(await json(`/trabalho/tarefas/${tarefas.A}`, { method: 'PATCH', body: JSON.stringify(body) }));
    expect(d.title).toBe(body.title);
    expect((await pedir(`/trabalho/tarefas/${tarefas.A}`, { method: 'PATCH', body: JSON.stringify(body) })).status).toBe(409);
    for (const relacao of [{ clienteId: clienteB }, { parentId: tarefas.B }, { listId: listaB }]) {
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}`, { method: 'PATCH', body: JSON.stringify({ expectedUpdatedAt: d.updatedAt, ...relacao }) })).status).toBe(400);
    }
    expect((await pedir(`/trabalho/tarefas/${tarefas.B}`, { method: 'PATCH', body: JSON.stringify(body) })).status).toBe(404);
    expect((await db.workTask.findUniqueOrThrow({ where: { id: tarefas.A } })).clienteId).toBe(clienteA);
  });

  it('mesmo com A+B, não cria filha de A vinculada a B nem revela hierarquia legada divergente', async () => {
    const gestor = app.get(ClienteEscopoService);
    await gestor.configurar(orgId, adminId, userId, { modo: 'SELECTED', clienteIds: [clienteA, clienteB] });
    const antes = await db.workTask.count({ where: { orgId } });
    try {
      expect((await pedir(`/trabalho/tarefas/${tarefas['A-pai-B']}`)).status).toBe(404);
      expect((await pedir('/trabalho/tarefas', { method: 'POST', body: JSON.stringify({ listId: lista, parentId: tarefas.A, clienteId: clienteB, title: 'não misturar' }) })).status).toBe(400);
      expect(await db.workTask.count({ where: { orgId } })).toBe(antes);
    } finally { await gestor.configurar(orgId, adminId, userId, { modo: 'SELECTED', clienteIds: [clienteA] }); }
  });

  it('sem perfil, o mesmo JWT com papel admin não ganha acesso implícito', async () => {
    await db.clienteAcessoPerfil.delete({ where: { userId_orgId: { userId, orgId } } });
    try {
      expect((await pedir('/trabalho/tarefas')).status).toBe(403);
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}`)).status).toBe(403);
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}/anexos/${anexos.A}/arquivo`)).status).toBe(403);
      expect(storageGet).not.toHaveBeenCalled();
    } finally {
      await db.clienteAcessoPerfil.create({ data: { orgId, userId, modo: 'SELECTED' } });
      await db.clienteAcessoVinculo.create({ data: { orgId, userId, clienteId: clienteA } });
    }
  });

  it('reclassificação enquanto comentário espera a trava aborta sem gravar', async () => {
    let liberar!: () => void, avisarTrava!: () => void;
    const liberacao = new Promise<void>(resolve => { liberar = resolve; });
    const travada = new Promise<void>(resolve => { avisarTrava = resolve; });
    const antes = await db.workComment.count({ where: { orgId, taskId: tarefas.A } });
    // A transação concorrente usa o mesmo Postgres, sem dublê da trava ou do serviço.
    const mudanca = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "WorkTask" WHERE id = ${tarefas.A} FOR UPDATE`;
      avisarTrava();
      await liberacao;
      await tx.workTask.update({ where: { id: tarefas.A }, data: { clienteId: clienteB } });
    }, { timeout: 20_000 });
    await travada;
    const resposta = pedir(`/trabalho/tarefas/${tarefas.A}/comentarios`, { method: 'POST', body: JSON.stringify({ text: 'não gravar após reclassificação' }) });
    try {
      let esperaConfirmada = false;
      for (let i = 0; i < 100; i++) {
        const [r] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ${prefixo} AND wait_event_type = 'Lock' AND query LIKE '%ORDER BY id FOR UPDATE%'`;
        if (r.n > 0) { esperaConfirmada = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(esperaConfirmada, 'a requisição deve realmente aguardar o lock do Postgres').toBe(true);
      liberar();
      await mudanca;
      expect((await resposta).status).toBe(409);
      expect(await db.workComment.count({ where: { orgId, taskId: tarefas.A } })).toBe(antes);
    } finally {
      liberar();
      await mudanca;
      await resposta;
      await db.workTask.update({ where: { id: tarefas.A }, data: { clienteId: clienteA } });
    }
  });

  it('revoga vínculo pelo gestor real e o mesmo JWT perde leitura, comentário e download', async () => {
    expect((await pedir(`/trabalho/tarefas/${tarefas.A}`)).status).toBe(200);
    const gestor = app.get(ClienteEscopoService);
    await gestor.configurar(orgId, adminId, userId, { modo: 'SELECTED', clienteIds: [] });
    try {
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}`)).status).toBe(404);
      expect(listaSchema.parse(await json('/trabalho/tarefas')).total).toBe(0);
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}/comentarios`, { method: 'POST', body: JSON.stringify({ text: 'revogado' }) })).status).toBe(404);
      expect((await pedir(`/trabalho/tarefas/${tarefas.A}/anexos/${anexos.A}/arquivo`)).status).toBe(404);
      expect(storageGet).not.toHaveBeenCalled();
    } finally { await gestor.configurar(orgId, adminId, userId, { modo: 'SELECTED', clienteIds: [clienteA] }); }
  });
});
