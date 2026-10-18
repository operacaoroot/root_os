import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MemoriaService } from '../src/memory/memoria.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { hashDoCorpo } from '../src/memory/procedencia';

const url = process.env.TEST_DATABASE_URL ?? '';
if (new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/rootos_dia_m05_test_20261008') throw new Error('M05 author destination required');
const db = new PrismaClient();
const writer = new PrismaClient();
let barrier: { action: () => Promise<void>; filter: (sql: string) => boolean } | null = null;
const originalRaw = db.$queryRawUnsafe.bind(db);
const facade = new Proxy(db, { get(target, key) {
  if (key === '$queryRawUnsafe') return async (sql: string, ...args: any[]) => {
    const rows = await originalRaw(sql, ...args), pending = barrier;
    if (pending?.filter(sql)) { barrier = null; await pending.action(); }
    return rows;
  };
  const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
} });
const service = new MemoriaService(facade as never, new EventLogService(db as never));
async function fixture() {
  const orgId = randomUUID(), person = randomUUID();
  await db.org.create({ data: { id: orgId, name: 'M05 synthetic source', slug: 'm05-' + orgId } });
  const permission = await db.permission.upsert({ where: { key: 'obsidian.ver' }, create: { key: 'obsidian.ver' }, update: {} });
  const role = await db.role.create({ data: { orgId, key: 'm05-reader', name: 'M05 reader', permissions: { connect: { id: permission.id } } } });
  await db.user.create({ data: { id: person, orgId, name: 'M05 synthetic reader', email: person + '@qa.invalid', passwordHash: 'no-login', roles: { connect: { id: role.id } } } });
  const body = 'Synthetic M05 canary. These are two distinct documents with exactly equal long content, without any declared identity link. Preserve each document independently and its versioned source. '.repeat(3);
  const item = await db.contextItem.create({ data: { orgId, chave: 'vault:m05/A.md', title: 'M05 canary', body, contentHash: hashDoCorpo(body), sourceType: 'vault', sourceRef: 'm05/A.md' } });
  const version = await db.contextItemVersion.create({ data: { orgId, itemId: item.id, versao: 1, mudanca: 'criacao', kind: 'nota', title: item.title, body, sourceType: 'vault', sourceRef: item.sourceRef, contentHash: item.contentHash, semEventoPorque: 'migracao' } });
  return { orgId, person, role, item, version };
}
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { const code = (e as { getStatus?: () => number }).getStatus?.(); if (!code) throw e; return code; } }
function afterRaw(action: () => Promise<void>, filter: (sql: string) => boolean = () => true) {
  barrier = { action, filter };
}
describe('M05 own PG source boundaries', () => {
  beforeAll(async () => { await db.$connect(); await writer.$connect(); });
  afterEach(() => { barrier = null; });
  afterAll(async () => { await db.$disconnect(); await writer.$disconnect(); });
  it('document with equal text at a new path receives another identity', async () => {
    const f = await fixture();
    const beforeVersion = await db.contextItemVersion.findUniqueOrThrow({ where: { id: f.version.id } });
    const result = await service.projetarDaVault(f.orgId, [{ caminho: 'm05/B.md', title: 'Distinct B', body: f.item.body, tags: [] }]);
    const b = await db.contextItem.findUniqueOrThrow({ where: { orgId_chave: { orgId: f.orgId, chave: 'vault:m05/B.md' } } });
    expect(b.id).not.toBe(f.item.id); expect(result.movidas).toBe(0);
    expect(await db.contextItemVersion.findUniqueOrThrow({ where: { id: f.version.id } })).toEqual(beforeVersion);
    expect(await db.contextItem.findUnique({ where: { id: f.item.id } })).not.toBeNull();
  });
  it('explicit denied person never becomes anonymous reader of an open item', async () => {
    const f = await fixture(); await writer.user.update({ where: { id: f.person }, data: { isActive: false } });
    expect(await status(service.obter(f.orgId, f.item.id, f.person))).toBe(403);
  });
  it.each(['obter', 'porChave'] as const)('revocation after vector I/O refuses %s', async (method) => {
    const f = await fixture(); afterRaw(() => writer.user.update({ where: { id: f.person }, data: { isActive: false } }).then(() => undefined));
    expect(await status(method === 'obter' ? service.obter(f.orgId, f.item.id, f.person) : service.porChave(f.orgId, f.item.chave, f.person))).toBe(403);
  });
  it('initially open source revoked after vector I/O is not disclosed', async () => {
    const f = await fixture(); afterRaw(() => writer.contextItem.update({ where: { id: f.item.id }, data: { acessoRestrito: true, leitores: [] } }).then(() => undefined));
    expect(await service.obter(f.orgId, f.item.id, f.person)).toBeNull();
  });
  it('listing revocation during count I/O refuses the whole result', async () => {
    const f = await fixture(); afterRaw(() => writer.user.update({ where: { id: f.person }, data: { isActive: false } }).then(() => undefined), (sql) => /COUNT/i.test(sql));
    expect(await status(service.listar(f.orgId, {}, f.person))).toBe(403);
  });
  it('listing revocation during vector I/O refuses the whole result', async () => {
    const f = await fixture(); afterRaw(() => writer.user.update({ where: { id: f.person }, data: { isActive: false } }).then(() => undefined), (sql) => !/COUNT/i.test(sql));
    expect(await status(service.listar(f.orgId, {}, f.person))).toBe(403);
  });
  it('history denies explicit person without permission even if item was open', async () => {
    const f = await fixture(); await writer.role.update({ where: { id: f.role.id }, data: { permissions: { disconnect: { key: 'obsidian.ver' } } } });
    expect(await status(service.historico(f.orgId, f.item.id, f.person))).toBe(403);
  });
  it('authorized open source and internal anonymous source remain readable', async () => {
    const f = await fixture(); expect((await service.obter(f.orgId, f.item.id, f.person))?.body).toBe(f.item.body);
    expect((await service.obter(f.orgId, f.item.id, null))?.body).toBe(f.item.body);
  });
  it('vector counter does not disclose a source revoked during count I/O', async () => {
    const f = await fixture();
    await writer.$executeRawUnsafe('UPDATE "ContextItem" SET embedding=$1::vector WHERE id=$2', '[' + Array(1536).fill(0).join(',') + ']', f.item.id);
    afterRaw(() => writer.contextItem.update({ where: { id: f.item.id }, data: { acessoRestrito: true, leitores: [] } }).then(() => undefined), (sql) => /COUNT/i.test(sql));
    const result = await service.listar(f.orgId, {}, f.person);
    expect(result.itens).toEqual([]); expect(result.total).toBe(0); expect(result.comVetor).toBe(0);
  });
  it('standalone vector counter denies an explicit inactive person', async () => {
    const f = await fixture(); await writer.user.update({ where: { id: f.person }, data: { isActive: false } });
    expect(await status(service.contarComVetor(f.orgId, f.person))).toBe(403);
  });
});
