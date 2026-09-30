import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service';
import { EditorialService } from '../src/work/editorial.service';
import { instalarCorpoEditorial } from '../src/common/corpo-editorial';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE versões editoriais e suspende gatilhos apenas na limpeza');
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const TASK_A = randomUUID();
const TASK_B = randomUUID();
const MARK = randomUUID().slice(0, 8);

@Controller('trabalho/tarefas/:taskId/artefatos/:artifactId')
class ControllerDeCorpoEditorial {
  @Post('versoes')
  versoes(@Body() body: { body: string }) { return { bytes: Buffer.byteLength(body.body, 'utf8') }; }

  @Post('outro')
  outro(@Body() body: { body: string }) { return { bytes: Buffer.byteLength(body.body, 'utf8') }; }
}
@Module({ controllers: [ControllerDeCorpoEditorial] })
class ModuloDeCorpoEditorial {}

describe('entrada editorial sem banco', () => {
  const service = new EditorialService(null as unknown as PrismaService);
  it('recusa referências, arquivo, autoria do cliente e corpo acima de 512 KiB antes de consultar o banco', async () => {
    const base = { expectedCurrentVersionId: null, body: 'Texto revisável', idempotencyKey: 'a' };
    await expect(service.criarVersao(ORG_A, TASK_A, randomUUID(), 'u', { ...base, sourceRefs: [{ id: randomUUID() }] }))
      .rejects.toThrow();
    await expect(service.criarVersao(ORG_A, TASK_A, randomUUID(), 'u', { ...base, fileIdsEmOrdem: [randomUUID()] }))
      .rejects.toThrow();
    await expect(service.criarVersao(ORG_A, TASK_A, randomUUID(), 'u', { ...base, authorId: 'forjado' }))
      .rejects.toThrow();
    await expect(service.criarVersao(ORG_A, TASK_A, randomUUID(), 'u', { ...base, body: 'á'.repeat(262_145) }))
      .rejects.toThrow();
  });

  it('aceita JSON acima de 100 kb só no POST editorial com sessão', async () => {
    const app = await NestFactory.create<NestExpressApplication>(ModuloDeCorpoEditorial, { logger: false });
    try {
      app.setGlobalPrefix('api');
      instalarCorpoEditorial(app, 'api', (token) => token === 'sessao-qa');
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}/api/trabalho/tarefas/t/artefatos/a`;
      const data = JSON.stringify({ body: 'x'.repeat(150_000) });
      const headers = { 'content-type': 'application/json', authorization: 'Bearer sessao-qa' };
      const editorial = await fetch(`${base}/versoes`, { method: 'POST', headers, body: data });
      expect(editorial.status).toBe(201);
      expect(await editorial.json()).toEqual({ bytes: 150_000 });
      const atLimit = await fetch(`${base}/versoes`, { method: 'POST', headers,
        body: JSON.stringify({ body: 'x'.repeat(524_288) }) });
      expect(atLimit.status).toBe(201);
      expect(await atLimit.json()).toEqual({ bytes: 524_288 });
      const other = await fetch(`${base}/outro`, { method: 'POST', headers, body: data });
      expect(other.status).toBe(413);
      const noSession = await fetch(`${base}/versoes`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: data });
      expect(noSession.status).toBe(413);
    } finally { await app.close(); }
  });
});

describe.skipIf(!URL)('artefato e versão editorial em Postgres descartável', () => {
  let db: PrismaService;
  let service: EditorialService;
  let pool: Pool;

  beforeAll(async () => {
    db = new PrismaService({ datasourceUrl: URL });
    await db.$connect();
    pool = new Pool({ connectionString: URL });
    service = new EditorialService(db);
    for (const [orgId, taskId, label] of [[ORG_A, TASK_A, 'a'], [ORG_B, TASK_B, 'b']] as const) {
      await db.org.create({ data: { id: orgId, slug: `editorial-${label}-${MARK}`, name: `Editorial QA ${label}` } });
      const folder = await db.workFolder.create({ data: { orgId, name: `Editorial QA ${label}` } });
      const list = await db.workList.create({ data: { orgId, folderId: folder.id, name: `Editorial QA ${label}` } });
      const status = await db.workStatus.create({ data: { orgId, listId: list.id, name: 'aberto', type: 'open' } });
      await db.workTask.create({ data: { id: taskId, orgId, listId: list.id, statusId: status.id, title: `Card ${label}` } });
    }
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.$transaction(async (tx) => {
        const triggers = [
          ['EditorialArtifact', 'EditorialArtifact_guard'],
          ['EditorialVersion', 'EditorialVersion_immutable'],
          ['EditorialVersionFile', 'EditorialVersionFile_immutable'],
          ['EditorialFile', 'EditorialFile_guard'],
        ] as const;
        for (const [table, trigger] of triggers) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        await tx.$executeRaw`UPDATE "EditorialArtifact" SET "currentVersionId"=NULL WHERE "orgId" IN (${ORG_A}, ${ORG_B})`;
        await tx.$executeRaw`DELETE FROM "EditorialVersionFile" WHERE "orgId" IN (${ORG_A}, ${ORG_B})`;
        await tx.$executeRaw`DELETE FROM "EditorialVersion" WHERE "orgId" IN (${ORG_A}, ${ORG_B})`;
        await tx.$executeRaw`DELETE FROM "EditorialFile" WHERE "orgId" IN (${ORG_A}, ${ORG_B})`;
        await tx.$executeRaw`DELETE FROM "EditorialArtifact" WHERE "orgId" IN (${ORG_A}, ${ORG_B})`;
        for (const orgId of [ORG_A, ORG_B]) {
          await tx.workTask.deleteMany({ where: { orgId } });
          await tx.workStatus.deleteMany({ where: { orgId } });
          await tx.workList.deleteMany({ where: { orgId } });
          await tx.workFolder.deleteMany({ where: { orgId } });
          await tx.org.delete({ where: { id: orgId } });
        }
        for (const [table, trigger] of triggers) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      });
    } finally {
      await db.$disconnect();
      await pool?.end();
    }
  });

  it('liga artefato ao card, aceita replay exato e recusa chave com outro pedido', async () => {
    const key = `artifact-${MARK}`;
    const first = await service.criarArtefato(ORG_A, TASK_A, { tipo: 'roteiro', createKey: key });
    const replay = await service.criarArtefato(ORG_A, TASK_A, { tipo: 'roteiro', createKey: key });
    expect(replay.artifactId).toBe(first.artifactId);
    expect(replay.replayed).toBe(true);
    await expect(service.criarArtefato(ORG_A, TASK_A, { tipo: 'copy', createKey: key })).rejects.toThrow();
    await expect(service.listar(ORG_B, TASK_A)).rejects.toThrow();
  });

  it('mantém v1 histórica, replay concorrente e ponteiro monotônico', async () => {
    const { artifactId } = await service.criarArtefato(ORG_A, TASK_A,
      { tipo: 'copy', createKey: `chain-${MARK}` });
    const request1 = { expectedCurrentVersionId: null, body: 'Versão inicial', idempotencyKey: `v1-${MARK}` };
    const [v1a, v1b] = await Promise.all([
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', request1),
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', request1),
    ]);
    expect(v1a.versionId).toBe(v1b.versionId);
    expect(v1a.numero).toBe(1);
    const v2 = await service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
      expectedCurrentVersionId: v1a.versionId, body: 'Segunda versão', idempotencyKey: `v2-${MARK}`,
    });
    expect(v2.numero).toBe(2);
    expect((await service.lerVersao(ORG_A, TASK_A, artifactId, 1)).body).toBe('Versão inicial');
    expect((await service.lerVersao(ORG_A, TASK_A, artifactId, 2)).body).toBe('Segunda versão');
    const lateReplay = await service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', request1);
    expect(lateReplay.versionId).toBe(v1a.versionId);
    expect(lateReplay.currentVersionId).toBe(v2.versionId);
    const request3 = {
      expectedCurrentVersionId: v2.versionId, body: 'Terceira versão', idempotencyKey: `v3-${MARK}`,
    };
    const v3 = await service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', request3);
    expect(v3.numero).toBe(3);
    const intermediateReplay = await service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
      expectedCurrentVersionId: v1a.versionId, body: 'Segunda versão', idempotencyKey: `v2-${MARK}`,
    });
    expect(intermediateReplay.versionId).toBe(v2.versionId);
    expect(intermediateReplay.currentVersionId).toBe(v3.versionId);
    await expect(service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa',
      { ...request1, body: 'Outra coisa' })).rejects.toThrow();
    await expect(service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa',
      { ...request1, idempotencyKey: `stale-${MARK}` })).rejects.toThrow();
    await expect(service.lerVersao(ORG_B, TASK_B, artifactId, 1)).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "EditorialArtifact" SET "currentVersionId"=${v1a.versionId} WHERE id=${artifactId}`)
      .rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "EditorialVersion" SET body='adulterado' WHERE id=${v1a.versionId}`)
      .rejects.toThrow();
    const saved = await db.editorialArtifact.findUniqueOrThrow({ where: { id: artifactId } });
    expect(saved.currentVersionId).toBe(v3.versionId);
    expect(await db.editorialVersion.count({ where: { artifactId } })).toBe(3);
    await expect(db.editorialVersion.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, artifactId, numero: 5, baseVersionId: v3.versionId,
      body: 'Pulo de versão por SQL', sourceRefs: [], contentHash: 'a'.repeat(64),
      idempotencyKey: `skip-${MARK}`, requestHash: 'b'.repeat(64), authorType: 'user', authorId: 'qa',
    } })).rejects.toThrow();
    await expect(db.editorialVersion.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, artifactId, numero: 1, baseVersionId: null,
      body: 'Segunda raiz por SQL', sourceRefs: [], contentHash: 'a'.repeat(64),
      idempotencyKey: `root-${MARK}`, requestHash: 'b'.repeat(64), authorType: 'user', authorId: 'qa',
    } })).rejects.toThrow();
    await expect(db.editorialArtifact.create({ data: {
      orgId: ORG_B, workTaskId: TASK_A, tipo: 'roteiro', createKey: `cross-${MARK}`, requestHash: 'c'.repeat(64),
    } })).rejects.toThrow();
    await expect(db.editorialVersion.create({ data: {
      orgId: ORG_A, workTaskId: TASK_B, artifactId, numero: 4, baseVersionId: v3.versionId,
      body: 'Card cruzado por SQL', sourceRefs: [], contentHash: 'a'.repeat(64),
      idempotencyKey: `cross-version-${MARK}`, requestHash: 'b'.repeat(64), authorType: 'user', authorId: 'qa',
    } })).rejects.toThrow(/editorial artifact missing/);

    const file = await db.editorialFile.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, uploadKey: `file-${MARK}`, requestHash: 'd'.repeat(64),
      state: 'verified', displayName: 'fixture.txt', mimeDetected: 'text/plain', sizeBytes: BigInt(3),
      sha256: 'e'.repeat(64), storageKey: `qa/${MARK}`, verifiedAt: new Date(), authorType: 'user', authorId: 'qa',
    } });
    await expect(db.$executeRaw`UPDATE "EditorialFile" SET "originSystem"='forjado', "originRef"='x' WHERE id=${file.id}`)
      .rejects.toThrow();
    await expect(db.editorialVersionFile.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, versionId: v1a.versionId, fileId: file.id,
      position: 1, sha256AtLink: 'e'.repeat(64), sizeAtLink: BigInt(3), mimeAtLink: 'text/plain',
    } })).rejects.toThrow();
    expect(await db.editorialVersionFile.count({ where: { versionId: v1a.versionId } })).toBe(0);
    const fileB = await db.editorialFile.create({ data: {
      orgId: ORG_B, workTaskId: TASK_B, uploadKey: `file-b-${MARK}`, requestHash: 'd'.repeat(64),
      state: 'verified', displayName: 'fixture-b.txt', mimeDetected: 'text/plain', sizeBytes: BigInt(3),
      sha256: 'e'.repeat(64), storageKey: `qa/b/${MARK}`, verifiedAt: new Date(), authorType: 'user', authorId: 'qa',
    } });
    await expect(db.editorialVersionFile.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, versionId: v1a.versionId, fileId: fileB.id,
      position: 1, sha256AtLink: 'e'.repeat(64), sizeAtLink: BigInt(3), mimeAtLink: 'text/plain',
    } })).rejects.toThrow();
  });

  it('duas chaves concorrentes partem da mesma base; só uma promove v1', async () => {
    const { artifactId } = await service.criarArtefato(ORG_A, TASK_A,
      { tipo: 'pacote', createKey: `race-${MARK}` });
    const results = await Promise.allSettled([
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
        expectedCurrentVersionId: null, body: 'Candidato A', idempotencyKey: `race-a-${MARK}`,
      }),
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
        expectedCurrentVersionId: null, body: 'Candidato B', idempotencyKey: `race-b-${MARK}`,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.editorialVersion.count({ where: { artifactId } })).toBe(1);
    const artifact = await db.editorialArtifact.findUniqueOrThrow({ where: { id: artifactId } });
    expect(artifact.currentVersionId).toBeTruthy();
  });

  it('mesma chave concorrente com payload divergente não reutiliza versão', async () => {
    const { artifactId } = await service.criarArtefato(ORG_A, TASK_A,
      { tipo: 'roteiro', createKey: `mismatch-${MARK}` });
    const key = `mismatch-v1-${MARK}`;
    const results = await Promise.allSettled([
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
        expectedCurrentVersionId: null, body: 'Texto A', idempotencyKey: key,
      }),
      service.criarVersao(ORG_A, TASK_A, artifactId, 'author-qa', {
        expectedCurrentVersionId: null, body: 'Texto B', idempotencyKey: key,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.editorialVersion.count({ where: { artifactId } })).toBe(1);
  });

  it('manifesto válido entra antes da promoção; cruzamento e INSERT tardio são recusados', async () => {
    const { artifactId } = await service.criarArtefato(ORG_A, TASK_A,
      { tipo: 'roteiro', createKey: `manifest-${MARK}` });
    const makeFile = (orgId: string, workTaskId: string, suffix: string) => db.editorialFile.create({ data: {
      orgId, workTaskId, uploadKey: `manifest-${suffix}-${MARK}`, requestHash: 'a'.repeat(64),
      state: 'verified', displayName: `${suffix}.txt`, mimeDetected: 'text/plain', sizeBytes: BigInt(3),
      sha256: 'b'.repeat(64), storageKey: `qa/manifest/${suffix}-${MARK}`,
      verifiedAt: new Date(), authorType: 'user', authorId: 'qa',
    } });
    const fileA = await makeFile(ORG_A, TASK_A, 'a');
    const lateFileA = await makeFile(ORG_A, TASK_A, 'late');
    const fileB = await makeFile(ORG_B, TASK_B, 'b');
    const versionId = randomUUID();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO "EditorialVersion" (id,"orgId","artifactId","workTaskId",numero,body,"contentHash","idempotencyKey","requestHash","authorType") VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9)',
        [versionId, ORG_A, artifactId, TASK_A, 'Manifesto inicial', 'c'.repeat(64), `manifest-v1-${MARK}`, 'd'.repeat(64), 'user']);
      await c.query('INSERT INTO "EditorialVersionFile" ("orgId","workTaskId","versionId","fileId",position,"sha256AtLink","sizeAtLink","mimeAtLink") VALUES ($1,$2,$3,$4,1,$5,3,$6)',
        [ORG_A, TASK_A, versionId, fileA.id, 'b'.repeat(64), 'text/plain']);
      await c.query('SAVEPOINT cross_file');
      let crossError = '';
      try {
        await c.query('INSERT INTO "EditorialVersionFile" ("orgId","workTaskId","versionId","fileId",position,"sha256AtLink","sizeAtLink","mimeAtLink") VALUES ($1,$2,$3,$4,2,$5,3,$6)',
          [ORG_A, TASK_A, versionId, fileB.id, 'b'.repeat(64), 'text/plain']);
      } catch (error) { crossError = String(error); }
      expect(crossError).toContain('editorial file metadata differs');
      await c.query('ROLLBACK TO SAVEPOINT cross_file');
      await c.query('UPDATE "EditorialArtifact" SET "currentVersionId"=$1 WHERE id=$2', [versionId, artifactId]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { c.release(); }
    expect(await db.editorialVersionFile.count({ where: { versionId } })).toBe(1);
    await expect(db.editorialVersionFile.create({ data: {
      orgId: ORG_A, workTaskId: TASK_A, versionId, fileId: lateFileA.id,
      position: 2, sha256AtLink: 'b'.repeat(64), sizeAtLink: BigInt(3), mimeAtLink: 'text/plain',
    } })).rejects.toThrow('editorial manifest is sealed');
    const constraints = await db.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint WHERE conname IN (
        'EditorialVersionFile_versionId_workTaskId_orgId_fkey',
        'EditorialVersionFile_fileId_workTaskId_orgId_fkey') ORDER BY conname`;
    expect(constraints.map((row) => row.name)).toHaveLength(2);
  });
});
