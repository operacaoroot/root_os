import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { TrabAtividadePagina } from '@mktos/shared';
import { WorkController } from '../src/work/work.controller';
import { WorkService } from '../src/work/work.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { ContextoTrabalhoService } from '../src/memory/contexto-trabalho.service';
import { AcessoAtualGuard } from '../src/memory/acesso-atual.guard';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { AuditService } from '../src/audit/audit.service';
import type { AuditInput } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '55582' ||
      !/^\/rootos_.*(?:write|test|dev|local)/.test(target.pathname)) {
    throw new Error('M02 exige o clone QA local autorizado na porta 55582.');
  }
}
const orgId = 'qa-m02-' + randomUUID(), otherOrgId = 'qa-m02-vizinha-' + randomUUID();
let db: PrismaClient, adversary: PrismaClient, svc: WorkService, app: INestApplication;
let actorId: string, readerId: string, peerId: string, otherActorId: string;
let roleId: string, listId: string, statusId: string, nextStatusId: string, tagId: string, fieldId: string;
let otherListId: string, otherStatusId: string;
let baseUrl: string, jwt: JwtService;
let baselineIds: string[] = [], baselineHash = '';
let afterAudit: (() => Promise<void>) | null = null;
let afterActivityRead: (() => Promise<void>) | null = null;
let afterActorNamesRead: (() => Promise<void>) | null = null;
const prisma = () => db as unknown as PrismaService;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function snapshot(ids: string[]) {
  return db.workTask.findMany({
    where: { id: { in: ids } }, orderBy: { id: 'asc' },
    include: {
      tags: { orderBy: { id: 'asc' } }, values: { orderBy: { id: 'asc' } },
      comments: { orderBy: { id: 'asc' } }, fontesContexto: { orderBy: { id: 'asc' } },
    },
  });
}
async function fixture(foreign = false) {
  const org = foreign ? otherOrgId : orgId;
  const task = await db.workTask.create({ data: {
    orgId: org, listId: foreign ? otherListId : listId, statusId: foreign ? otherStatusId : statusId,
    title: 'Card sintético M02', description: 'Material original M02', assignee: 'Texto histórico M02',
    assigneeUserId: foreign ? otherActorId : actorId, externalId: randomUUID(),
    externalUrl: 'https://example.invalid/qa-m02',
    ...(!foreign ? { tags: { connect: { id: tagId } } } : {}),
  } });
  if (!foreign) {
    await db.workFieldValue.create({ data: { orgId, taskId: task.id, fieldId, value: 'Material no campo M02' } });
    await db.workComment.create({ data: { orgId, taskId: task.id, authorId: peerId,
      authorName: 'Pessoa histórica M02', text: 'Comentário preservado M02' } });
  }
  return task;
}
async function state(id: string) {
  return {
    task: (await snapshot([id]))[0],
    audit: await db.auditLog.findMany({ where: { orgId, entityType: 'work_task', entityId: id }, orderBy: { id: 'asc' } }),
  };
}
async function token(id = actorId, org = orgId, permissions = ['tarefas.ver', 'tarefas.editar']) {
  return jwt.signAsync({ typ: 'sessao', sub: id, orgId: org, permissions,
    email: 'pessoa-sintetica@qa.invalid', name: 'Pessoa sintética M02', roles: ['qa_m02'] });
}
async function request(method: string, path: string, body?: unknown, bearer?: string | null) {
  const auth = bearer === undefined ? await token() : bearer;
  const response = await fetch(baseUrl + path, {
    method, headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json() as any;
  return { status: response.status, body: json };
}
const taskPath = (id: string) => '/trabalho/tarefas/' + id;
const activityPath = (id: string, query = '') => taskPath(id) + '/atividade' + query;
async function seedActivity(taskId: string, count = 121) {
  const base = Date.now() - 120_000;
  await db.auditLog.createMany({ data: Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), orgId, actorType: 'user' as const, actorId,
    action: 'work.task.update', entityType: 'work_task', entityId: taskId,
    before: { title: 'Antes ' + i }, after: { title: i === 0 ? 'CANARIO_ANTIGO_M02' : 'Depois ' + i },
    createdAt: new Date(base + Math.floor(i / 5)),
  })) });
  return db.auditLog.findMany({ where: { orgId, entityType: 'work_task', entityId: taskId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}
async function removeRole() {
  await adversary.user.update({ where: { id: actorId }, data: { roles: { disconnect: { id: roleId } } } });
}
async function restoreRole() {
  await adversary.user.update({ where: { id: actorId }, data: { roles: { connect: { id: roleId } } } });
}
async function firstPage(id: string, bearer?: string): Promise<TrabAtividadePagina> {
  const result = await request('GET', activityPath(id), undefined, bearer);
  expect(result.status).toBe(200);
  return result.body;
}

describe.skipIf(!url)('M02 HTTP e Postgres próprios', () => {
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    adversary = new PrismaClient({ datasources: { db: { url: url! } } });
    baselineIds = (await db.workTask.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(t => t.id);
    baselineHash = hash(await snapshot(baselineIds));
    for (const id of [orgId, otherOrgId]) await db.org.create({ data: { id, slug: id, name: 'Empresa sintética M02' } });
    const permissions = await db.permission.findMany({ where: { key: { in: ['tarefas.ver', 'tarefas.editar'] } } });
    expect(permissions).toHaveLength(2);
    const role = await db.role.create({ data: { orgId, key: 'qa_m02', name: 'QA M02 editar e consultar',
      permissions: { connect: permissions.map(p => ({ id: p.id })) } } });
    roleId = role.id;
    const readerRole = await db.role.create({ data: { orgId, key: 'qa_m02_leitor', name: 'QA M02 leitor',
      permissions: { connect: permissions.filter(p => p.key === 'tarefas.ver').map(p => ({ id: p.id })) } } });
    const foreignRole = await db.role.create({ data: { orgId: otherOrgId, key: 'qa_m02', name: 'QA M02 vizinha',
      permissions: { connect: permissions.map(p => ({ id: p.id })) } } });
    async function user(org: string, role: string, name: string) {
      return (await db.user.create({ data: { orgId: org, name, email: randomUUID() + '@qa.invalid',
        passwordHash: 'fixture-sem-login', roles: { connect: { id: role } } } })).id;
    }
    actorId = await user(orgId, role.id, 'Pessoa M02 editora');
    peerId = await user(orgId, role.id, 'Pessoa M02 histórica');
    readerId = await user(orgId, readerRole.id, 'Pessoa M02 leitora');
    otherActorId = await user(otherOrgId, foreignRole.id, 'NOME_PRIVADO_OUTRA_EMPRESA_M02');
    listId = (await db.workList.create({ data: { orgId, name: 'Lista sintética M02' } })).id;
    statusId = (await db.workStatus.create({ data: { orgId, listId, name: 'A fazer', type: 'open' } })).id;
    nextStatusId = (await db.workStatus.create({ data: { orgId, listId, name: 'Em andamento', type: 'custom', order: 1 } })).id;
    otherListId = (await db.workList.create({ data: { orgId: otherOrgId, name: 'Lista sintética vizinha M02' } })).id;
    otherStatusId = (await db.workStatus.create({ data: { orgId: otherOrgId, listId: otherListId, name: 'A fazer', type: 'open' } })).id;
    tagId = (await db.workTag.create({ data: { orgId, name: 'Etiqueta sintética M02' } })).id;
    fieldId = (await db.workField.create({ data: { orgId, listId, name: 'Material sintético M02', type: 'texto' } })).id;

    const actualAudit = new AuditService(prisma());
    const audit = { log: async (input: AuditInput, tx?: any) => {
      await actualAudit.log(input, tx);
      if (afterAudit) await afterAudit();
    } } as AuditService;
    const activityDelegate = new Proxy(db.auditLog, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'findMany') return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        if (afterActivityRead) await afterActivityRead();
        return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const userDelegate = new Proxy(db.user, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'findMany') return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        if (afterActorNamesRead) await afterActorNamesRead();
        return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const serviceDb = new Proxy(db, { get(target, key) {
      if (key === 'user') return userDelegate;
      if (key === 'auditLog') return activityDelegate;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as PrismaService;
    svc = new WorkService(serviceDb, audit, { agentesParaEscolher: async () => [] } as unknown as CheckoutDeTarefaService);
    // Vitest transpila decorators sem design:paramtypes; declarar a DI do controller real no harness.
    Reflect.defineMetadata('design:paramtypes', [WorkService, ContextoTrabalhoService, CheckoutDeTarefaService], WorkController);
    jwt = new JwtService({ secret: randomUUID() + randomUUID(), signOptions: { expiresIn: '15m' } });
    const reflector = new Reflector();
    const module = await Test.createTestingModule({ controllers: [WorkController], providers: [
      { provide: WorkService, useValue: svc },
      { provide: ContextoTrabalhoService, useValue: {} },
      { provide: CheckoutDeTarefaService, useValue: {} },
      { provide: PrismaService, useValue: prisma() },
      { provide: JwtService, useValue: jwt }, Reflector,
    ] }).overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt))
      .overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector))
      .overrideGuard(AcessoAtualGuard).useValue(new AcessoAtualGuard(prisma(), reflector)).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new ZodExceptionFilter());
    app.useGlobalInterceptors(new ContextoInterceptor());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    try {
      afterAudit = afterActivityRead = afterActorNamesRead = null;
      if (app) await app.close();
      if (db && baselineHash) expect(hash(await snapshot(baselineIds))).toBe(baselineHash);
    } finally {
      if (adversary) await adversary.$disconnect();
      if (db) await db.$disconnect();
    }
    // Fixtures e histórico próprios permanecem no clone descartável; não há limpeza global.
  });

  describe('RED legado — fronteiras HTTP antes do reparo', () => {
    it('R01 PATCH sem versão recusa sem alterar tarefa/material/audit', async () => {
      const f = await fixture(), before = await state(f.id);
      const result = await request('PATCH', taskPath(f.id), { title: 'Não gravar', campos: { [fieldId]: { value: 'Não gravar' } } });
      expect(result.status).toBe(400);
      expect(await state(f.id)).toEqual(before);
    });
    it('R02 DELETE sem versão recusa sem arquivar nem auditar', async () => {
      const f = await fixture(), before = await state(f.id);
      expect((await request('DELETE', taskPath(f.id))).status).toBe(400);
      expect(await state(f.id)).toEqual(before);
    });
    it('R03 PATCH com claims antigos após revogação recusa', async () => {
      const f = await fixture(), before = await state(f.id), oldToken = await token();
      await removeRole();
      try {
        expect((await request('PATCH', taskPath(f.id), { title: 'Revogado', expectedUpdatedAt: f.updatedAt.toISOString() }, oldToken)).status).toBe(403);
        expect(await state(f.id)).toEqual(before);
      } finally { await restoreRole(); }
    });
    it('R04 DELETE de pessoa inativada com token antigo recusa', async () => {
      const f = await fixture(), before = await state(f.id), oldToken = await token();
      await adversary.user.update({ where: { id: actorId }, data: { isActive: false } });
      try {
        expect((await request('DELETE', taskPath(f.id), { expectedUpdatedAt: f.updatedAt.toISOString() }, oldToken)).status).toBe(403);
        expect(await state(f.id)).toEqual(before);
      } finally { await adversary.user.update({ where: { id: actorId }, data: { isActive: true } }); }
    });
    it('R05 rota permite continuar além do recorte de 50 do detalhe', async () => {
      const f = await fixture(); await seedActivity(f.id);
      expect((await request('GET', taskPath(f.id))).body.atividade).toHaveLength(50);
      const result = await request('GET', activityPath(f.id));
      expect(result.status).toBe(200);
      expect(result.body.items).toHaveLength(50);
      expect(result.body.hasMore).toBe(true);
      expect(typeof result.body.nextCursor).toBe('string');
    });
    it('R06 detalhe não resolve nome de ator de outra empresa', async () => {
      const f = await fixture();
      await db.auditLog.create({ data: { orgId, actorId: otherActorId, actorType: 'user', action: 'work.task.update', entityType: 'work_task', entityId: f.id } });
      const result = await request('GET', taskPath(f.id));
      expect(result.status).toBe(200);
      expect(result.body.atividade[0].actorName).toBeNull();
    });
    it('R07 ator ai com ID de User não recebe nome humano', async () => {
      const f = await fixture();
      await db.auditLog.create({ data: { orgId, actorId: actorId, actorType: 'ai', action: 'work.task.update', entityType: 'work_task', entityId: f.id } });
      const result = await request('GET', taskPath(f.id));
      expect(result.status).toBe(200);
      expect(result.body.atividade[0].actorType).toBe('ai');
      expect(result.body.atividade[0].actorName).toBeNull();
    });
    it('R08 revogação confirmada após audit impede commit HTTP', async () => {
      const f = await fixture(), before = await state(f.id);
      afterAudit = removeRole;
      try {
        const result = await request('PATCH', taskPath(f.id), { title: 'Sem commit', tagIds: [],
          campos: { [fieldId]: { value: 'Sem commit' } }, expectedUpdatedAt: f.updatedAt.toISOString() });
        expect(result.status).toBe(403);
        afterAudit = null;
        expect(await state(f.id)).toEqual(before);
      } finally { afterAudit = null; await restoreRole(); }
    });
  });

  describe('página e escrita versionada permitidas e adversas', () => {
    it('N01 121 eventos com empates são consultáveis uma vez e incluem canário antigo', async () => {
      const f = await fixture(), expected = await seedActivity(f.id);
      const ids: string[] = []; let page = await firstPage(f.id), pages = 0;
      const anchor = page.anchor;
      for (;;) {
        pages++;
        expect(page.escopo).toEqual({ orgId, taskId: f.id, userId: actorId });
        expect(page.anchor).toEqual(anchor);
        expect(page.limit).toBe(50);
        expect(page.hasMore).toBe(page.nextCursor !== null);
        ids.push(...page.items.map(i => i.id));
        if (!page.nextCursor) break;
        expect(pages).toBeLessThan(5);
        const response = await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(page.nextCursor)));
        expect(response.status).toBe(200); page = response.body;
      }
      expect(pages).toBe(3);
      expect(ids).toEqual(expected.map(a => a.id));
      expect(new Set(ids).size).toBe(121);
      const old = expected.find(a => (a.after as { title: string }).title === 'CANARIO_ANTIGO_M02');
      expect(ids).toContain(old!.id);
    });
    it('N02 evento novo não entra na âncora antiga; atualização o reencontra', async () => {
      const f = await fixture(), old = await seedActivity(f.id);
      const initial = await firstPage(f.id);
      const newEvent = await db.auditLog.create({ data: { orgId, actorType: 'user', actorId,
        action: 'work.task.update', entityType: 'work_task', entityId: f.id, after: { title: 'Novo após consulta' } } });
      const ids = initial.items.map(i => i.id); let cursor = initial.nextCursor;
      while (cursor) {
        const result = await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(cursor)));
        expect(result.status).toBe(200); expect(result.body.anchor).toEqual(initial.anchor);
        ids.push(...result.body.items.map((a: { id: string }) => a.id)); cursor = result.body.nextCursor;
      }
      expect(ids).toEqual(old.map(a => a.id));
      expect(ids).not.toContain(newEvent.id);
      expect((await firstPage(f.id)).items[0].id).toBe(newEvent.id);
    });
    it('N03 cursor não é transferível entre pessoas da mesma empresa', async () => {
      const f = await fixture(); await seedActivity(f.id);
      const page = await firstPage(f.id);
      expect((await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(page.nextCursor!)), undefined, await token(peerId))).status).toBe(400);
    });
    it('N04 cursor não muda de tarefa ou empresa e tarefa estrangeira é 404', async () => {
      const f = await fixture(), other = await fixture(), foreign = await fixture(true);
      await seedActivity(f.id); const page = await firstPage(f.id), query = '?cursor=' + encodeURIComponent(page.nextCursor!);
      expect((await request('GET', activityPath(other.id, query))).status).toBe(400);
      expect((await request('GET', activityPath(foreign.id))).status).toBe(404);
      expect((await request('GET', activityPath(foreign.id, query), undefined, await token(otherActorId, otherOrgId))).status).toBe(400);
    });
    it('N05 limites e cursores malformados recusam sem consulta ampla', async () => {
      const f = await fixture();
      for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=NaN', '?limit=1&limit=2', '?cursor=abc', '?cursor=' + 'a'.repeat(8192)]) {
        expect((await request('GET', activityPath(f.id, query))).status).toBe(400);
      }
    });
    it('N06 pessoa revogada ou inativa não lê página com claims antigos', async () => {
      const f = await fixture(); await seedActivity(f.id, 2); const oldToken = await token();
      await removeRole();
      try { expect((await request('GET', activityPath(f.id), undefined, oldToken)).status).toBe(403); }
      finally { await restoreRole(); }
      await adversary.user.update({ where: { id: actorId }, data: { isActive: false } });
      try { expect((await request('GET', activityPath(f.id), undefined, oldToken)).status).toBe(403); }
      finally { await adversary.user.update({ where: { id: actorId }, data: { isActive: true } }); }
    });
    it('N07 revogação confirmada durante I/O retira a resposta da página', async () => {
      const f = await fixture(); await seedActivity(f.id, 2); afterActivityRead = removeRole;
      try {
        const result = await request('GET', activityPath(f.id));
        expect(result.status).toBe(403); expect(result.body).not.toHaveProperty('items');
      } finally { afterActivityRead = null; await restoreRole(); }
    });
    it('N08 DELETE com versão atual arquiva preservando identidade/material/comentários', async () => {
      const f = await fixture(), before = await state(f.id);
      expect((await request('DELETE', taskPath(f.id), { expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(200);
      const after = await state(f.id);
      expect(after.task.archived).toBe(true);
      expect(after.task).toMatchObject({ id: before.task.id, description: before.task.description,
        assigneeUserId: before.task.assigneeUserId, statusId: before.task.statusId,
        tags: before.task.tags, values: before.task.values, comments: before.task.comments, fontesContexto: before.task.fontesContexto });
      expect(after.audit).toHaveLength(1);
    });
    it('N09 versão malformada em PATCH/DELETE recusa antes de efeito', async () => {
      const f = await fixture(), before = await state(f.id);
      for (const method of ['PATCH', 'DELETE']) for (const version of ['2026-10-08', null, 1, 'sem-data']) {
        expect((await request(method, taskPath(f.id), { expectedUpdatedAt: version })).status).toBe(400);
      }
      expect(await state(f.id)).toEqual(before);
    });
    it('N10 PATCH e DELETE stale não produzem mudança parcial', async () => {
      const f = await fixture();
      expect((await request('PATCH', taskPath(f.id), { title: 'Vencedor', expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(200);
      const before = await state(f.id);
      expect((await request('PATCH', taskPath(f.id), { title: 'Perdedor', tagIds: [], campos: { [fieldId]: { value: 'Perdedor' } }, expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(409);
      expect((await request('DELETE', taskPath(f.id), { expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(409);
      expect(await state(f.id)).toEqual(before);
    });
    it('N11 dois PATCH de mesma versão confirmam um vencedor e um audit', async () => {
      const f = await fixture();
      const results = await Promise.all(['A', 'B'].map(title => request('PATCH', taskPath(f.id), {
        title, expectedUpdatedAt: f.updatedAt.toISOString(), campos: { [fieldId]: { value: title } },
      })));
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      const final = await state(f.id);
      expect(final.task.values[0].value).toBe(final.task.title); expect(final.audit).toHaveLength(1);
    });
    it('N12 falha após INSERT do audit reverte tarefa/tags/campos na mesma transação', async () => {
      const f = await fixture(), before = await state(f.id);
      afterAudit = async () => { throw new Error('Falha sintética após audit M02'); };
      try {
        expect((await request('PATCH', taskPath(f.id), { title: 'Sem commit', tagIds: [], campos: { [fieldId]: { value: 'Sem commit' } }, expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(500);
        expect(await state(f.id)).toEqual(before);
      } finally { afterAudit = null; }
    });
    it('N13 edição interna exige a versão preparada', async () => {
      const f = await fixture();
      const result = await svc.editarTarefa(orgId, actorId, f.id, { title: 'Interno permitido', expectedUpdatedAt: f.updatedAt.toISOString() });
      expect(result.title).toBe('Interno permitido');
      expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(f.updatedAt.getTime());
    });
    it('N14 pessoa leitora lê e não edita nem arquiva', async () => {
      const f = await fixture(), before = await state(f.id), ro = await token(readerId, orgId, ['tarefas.ver']);
      expect((await request('GET', activityPath(f.id), undefined, ro)).status).toBe(200);
      for (const method of ['PATCH', 'DELETE']) expect((await request(method, taskPath(f.id), { expectedUpdatedAt: f.updatedAt.toISOString() }, ro)).status).toBe(403);
      expect(await state(f.id)).toEqual(before);
    });
    it('N15 edição permitida de etapa preserva material/IDs e registra antes/depois', async () => {
      const f = await fixture(), before = await state(f.id);
      const result = await request('PATCH', taskPath(f.id), { statusId: nextStatusId, expectedUpdatedAt: f.updatedAt.toISOString() });
      expect(result.status).toBe(200); const after = await state(f.id);
      expect(after.task).toMatchObject({ id: before.task.id, description: before.task.description, externalId: before.task.externalId,
        externalUrl: before.task.externalUrl, assigneeUserId: before.task.assigneeUserId, agenteId: before.task.agenteId,
        tags: before.task.tags, values: before.task.values, comments: before.task.comments });
      expect(after.audit[0]).toMatchObject({ actorId, before: { status: 'A fazer' }, after: { status: 'Em andamento' } });
    });
    it('N16 histórico arquivado permanece legível; vazio declara fim sem âncora', async () => {
      const f = await fixture(); const empty = await firstPage(f.id);
      expect(empty.items).toEqual([]); expect(empty.anchor).toBeNull(); expect(empty.nextCursor).toBeNull(); expect(empty.hasMore).toBe(false);
      expect((await request('PATCH', taskPath(f.id), { archived: true, expectedUpdatedAt: f.updatedAt.toISOString() })).status).toBe(200);
      expect((await firstPage(f.id)).items).toHaveLength(1);
    });
    it('N17 falta de sessão recusa leitura sem expor atividade', async () => {
      const f = await fixture();
      const result = await request('GET', activityPath(f.id), undefined, null);
      expect(result.status).toBe(401); expect(result.body).not.toHaveProperty('items');
    });
    it('N19 RED cursor textual — ID histórico String continua na segunda página', async () => {
      const f = await fixture();
      const createdAt = new Date(Date.now() - 60_000);
      const ids = Array.from({ length: 61 }, (_, i) => 'qa_m02_historico_' + randomUUID() + '_' + i);
      await db.auditLog.createMany({ data: ids.map(id => ({ id, orgId, createdAt, actorType: 'user' as const,
        actorId, action: 'work.task.update', entityType: 'work_task', entityId: f.id })) });
      const page = await firstPage(f.id);
      const result = await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(page.nextCursor!)));
      expect(result.status).toBe(200);
      expect(new Set([...page.items, ...result.body.items].map(i => i.id))).toEqual(new Set(ids));
      expect(result.body.nextCursor).toBeNull();
    });
    it('N20 cursor adulterado na assinatura ou âncora é recusado', async () => {
      const f = await fixture(); await seedActivity(f.id); const page = await firstPage(f.id);
      const [payload, signature] = page.nextCursor!.split('.');
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      parsed.anchor.createdAt = new Date(Date.now() + 60_000).toISOString();
      const forged = Buffer.from(JSON.stringify(parsed)).toString('base64url') + '.' + signature;
      const changedSignature = payload + '.' + (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
      for (const cursor of [forged, changedSignature]) {
        expect((await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(cursor)))).status).toBe(400);
      }
    });
    it('N21 limite da primeira página fica vinculado ao cursor', async () => {
      const f = await fixture(), rows = await seedActivity(f.id, 21);
      const initial = await request('GET', activityPath(f.id, '?limit=7'));
      expect(initial.status).toBe(200); expect(initial.body.items).toHaveLength(7);
      expect((await request('GET', activityPath(f.id, '?limit=8&cursor=' + encodeURIComponent(initial.body.nextCursor)))).status).toBe(400);
      let page = initial.body; const ids: string[] = [];
      for (;;) {
        expect(page.limit).toBe(7); ids.push(...page.items.map((i: { id: string }) => i.id));
        if (!page.nextCursor) break;
        const response = await request('GET', activityPath(f.id, '?cursor=' + encodeURIComponent(page.nextCursor)));
        expect(response.status).toBe(200); page = response.body;
      }
      expect(ids).toEqual(rows.map(r => r.id));
    });
    it('N22 revogação após resolver nomes também impede DTO de atividade', async () => {
      const f = await fixture(); await seedActivity(f.id, 2); afterActorNamesRead = removeRole;
      try {
        const result = await request('GET', activityPath(f.id));
        expect(result.status).toBe(403); expect(result.body).not.toHaveProperty('items');
      } finally { afterActorNamesRead = null; await restoreRole(); }
    });
    it('N23 detalhe HTTP não revela recorte após revogação durante leitura', async () => {
      const f = await fixture(); await seedActivity(f.id, 2); afterActorNamesRead = removeRole;
      try {
        const result = await request('GET', taskPath(f.id));
        expect(result.status).toBe(403); expect(result.body).not.toHaveProperty('atividade');
      } finally { afterActorNamesRead = null; await restoreRole(); }
    });
    it('N24 DELETE aceita somente o corpo de versão', async () => {
      const f = await fixture(), before = await state(f.id);
      expect((await request('DELETE', taskPath(f.id), { expectedUpdatedAt: f.updatedAt.toISOString(), title: 'Extra' })).status).toBe(400);
      expect(await state(f.id)).toEqual(before);
    });
    it('N18 página conserva before/after do audit e nomes somente da empresa/tipo', async () => {
      const f = await fixture();
      await db.user.update({ where: { id: peerId }, data: { isActive: false } });
      const rows = await Promise.all([
        db.auditLog.create({ data: { orgId, actorId: peerId, actorType: 'user', action: 'work.task.update', entityType: 'work_task', entityId: f.id,
          before: { status: 'Etapa antiga', html: '<script>QA</script>' }, after: { status: 'Etapa histórica' } } }),
        db.auditLog.create({ data: { orgId, actorId: otherActorId, actorType: 'user', action: 'work.task.update', entityType: 'work_task', entityId: f.id } }),
        db.auditLog.create({ data: { orgId, actorId, actorType: 'system', action: 'work.task.update', entityType: 'work_task', entityId: f.id } }),
      ]);
      try {
        const page = await firstPage(f.id), byId = new Map(page.items.map(i => [i.id, i]));
        expect(byId.get(rows[0].id)).toMatchObject({ actorName: 'Pessoa M02 histórica', before: rows[0].before, after: rows[0].after });
        expect(byId.get(rows[1].id)?.actorName).toBeNull(); expect(byId.get(rows[2].id)?.actorName).toBeNull();
      } finally { await db.user.update({ where: { id: peerId }, data: { isActive: true } }); }
    });
  });
});
