import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { versionarVault } from './vault-com-git';
const url = process.env.TEST_DATABASE_URL ?? '';
if (new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/rootos_dia_m05_test_20261008') throw new Error('M05 author destination required');
const db = new PrismaClient(); let orgId: string;
async function snapshot() { return db.$queryRawUnsafe('SELECT row_to_json(n)::text AS row FROM "KnowledgeNote" n WHERE "orgId"=$1 ORDER BY id', orgId); }
describe('M05 own PG atomic index rollback', () => {
  beforeAll(async () => { await db.$connect(); orgId = (await db.org.upsert({ where: { slug: 'root' }, create: { name: 'M05 synthetic vault', slug: 'root' }, update: {} })).id; });
  afterAll(() => db.$disconnect());
  it.each([1, 2])('insert number %i failure preserves the exact preceding index', async (failAt) => {
    const prefix = 'm05-' + randomUUID().slice(0, 8), folder = mkdtempSync(join(tmpdir(), prefix));
    process.env.OBSIDIAN_FONTE = 'pasta'; process.env.OBSIDIAN_VAULT_PATH = folder; delete process.env.OPENAI_API_KEY;
    for (let i = 1; i <= 2; i++) writeFileSync(join(folder, prefix + '-' + i + '.md'), '# M05 synthetic note ' + i + '\n\nOnly own test content.');
    versionarVault(folder);
    await db.knowledgeNote.create({ data: { orgId, path: prefix + '-old.md', title: 'M05 previous index', content: 'Old synthetic contents', folder: null, tags: [], links: [], wordCount: 3, fileTime: new Date('2026-10-08T10:00:00Z') } });
    const before = await snapshot(), memoryBefore = await db.contextItem.findMany({ where: { orgId }, orderBy: { id: 'asc' } });
    const fn = 'm05_fail_' + prefix.slice(4), trigger = fn + '_trigger', rejectedPath = prefix + '-' + failAt + '.md';
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.path = '${rejectedPath}' THEN RAISE EXCEPTION 'M05 synthetic insert refusal' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "KnowledgeNote" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    const receipt = vi.fn().mockResolvedValue({ id: randomUUID(), seq: 1n });
    const projection = vi.fn();
    const memory = { projetarDaVault: projection, ultimoReciboDaVault: vi.fn().mockResolvedValue(null), registrarReciboDaVault: receipt };
    const service = new ObsidianService(db as never, new ConectoresConfiguradosRegistry(), new RegistroDeConectores(), memory as never);
    let error: unknown;
    try { await service.reindex(orgId, true); } catch (e) { error = e; }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "KnowledgeNote"`); await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`); }
    expect(String(error)).toContain('M05 synthetic insert refusal');
    expect(projection).not.toHaveBeenCalled(); expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][1].payload.resultado).not.toBe('ok');
    expect(await snapshot()).toEqual(before);
    expect(await db.contextItem.findMany({ where: { orgId }, orderBy: { id: 'asc' } })).toEqual(memoryBefore);
  });
});
