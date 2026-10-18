import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EditorialService } from '../src/pauta/editorial.service';
import { EditorialCreateSchema, EditorialDecisionSchema, EditorialProductionSchema, editorialContentHash } from '../src/pauta/editorial-contrato';
import { AuditService } from '../src/audit/audit.service';
import { WorkFilesService } from '../src/work/work-files.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
const URL = process.env.TEST_DATABASE_URL; exigirBancoDescartavel(URL ?? '', 'Fixtures próprias editoriais');
const uid = () => randomUUID();
const org = uid(), otherOrg = uid(), author = uid(), approver = uid(), lower = uid(), foreign = uid();
const fileBytes = Buffer.from('Arquivo editorial existente de QA');
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } }
describe('contratos editoriais', () => {
  it('valida identidade, origem e conteúdo exato sem receber campo de publicação', () => {
    expect(EditorialCreateSchema.safeParse({ requestId: uid(), taskId: uid(), releaseStatusId: uid(), title: ' Peça ', body: 'Texto', sourceRef: 'QA' }).success).toBe(true);
    expect(EditorialCreateSchema.safeParse({ requestId: uid(), taskId: uid(), releaseStatusId: uid(), title: 'Peça', body: 'Texto', sourceRef: 'QA', agendadaPara: '2026-10-08' }).success).toBe(false);
    expect(EditorialDecisionSchema.safeParse({ requestId: uid(), versionId: uid(), contentHash: 'x', state: 'approved', reason: 'Revisado' }).success).toBe(false);
    expect(EditorialProductionSchema.safeParse({ requestId: uid(), taskId: uid(), versionId: uid(), decisionId: uid(), contentHash: 'a'.repeat(64), body: 'troca' }).success).toBe(false);
  });
  it('texto, título, mídia e origem participam do hash', () => {
    const v = { title: 'A', body: 'Texto', files: [], sourceRef: 'QA' };
    for (const delta of [{ title: 'B' }, { body: 'Outra peça' }, { sourceRef: 'Outra fonte' }, { files: [{ taskExternalId: 't', fileId: 'a', name: 'arq', sha256: 'a'.repeat(64) }] }]) expect(editorialContentHash({ ...v, ...delta })).not.toBe(editorialContentHash(v));
  });
});
describe.skipIf(!URL)('percurso editorial no Postgres descartável', () => {
  let db: PrismaClient, svc: EditorialService, audit: AuditService, root: string;
  let listId: string, releaseId: string, reviewId: string, taskId: string, extId: string, roleHigh: string, roleLow: string;
  const createInput = (files = false) => ({ requestId: uid(), taskId, releaseStatusId: releaseId, title: 'Material QA existente', body: 'Texto preservado de QA', sourceRef: 'Card próprio de QA', files: files ? [{ taskExternalId: extId, fileId: 'arquivo-qa' }] : [] });
  async function reset() {
    await db.$executeRaw`DELETE FROM "EditorialProduction" WHERE "orgId"=${org}`;
    await db.$executeRaw`DELETE FROM "EditorialDecision" WHERE "orgId"=${org}`;
    await db.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=NULL WHERE "orgId"=${org}`;
    await db.$executeRaw`DELETE FROM "EditorialVersion" WHERE "orgId"=${org}`;
    await db.$executeRaw`DELETE FROM "EditorialMaterial" WHERE "orgId"=${org}`;
    await db.auditLog.deleteMany({ where: { orgId: org } });
  }
  async function version(id: string) { return (await db.$queryRaw<any[]>`SELECT * FROM "EditorialVersion" WHERE "id"=${id}`)[0]; }
  async function approved(files = false) {
    const input = createInput(files), made = await svc.criar(org, author, input), v = await version(made.versionId!);
    const decisionInput = { requestId: uid(), versionId: v.id, contentHash: v.contentHash, state: 'approved' as const, reason: 'Conteúdo exato revisado em QA' };
    const d = await svc.decidir(org, approver, decisionInput);
    return { input, made, v, d, decisionInput, productionInput: { requestId: uid(), taskId, versionId: v.id, decisionId: d.decisionId, contentHash: v.contentHash } };
  }
  async function nProductions() { return (await db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "EditorialProduction" WHERE "orgId"=${org}`)[0].n; }
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL } } }); const p = db as unknown as PrismaService; audit = new AuditService(p); svc = new EditorialService(p, audit, new WorkFilesService(p));
    for (const id of [org, otherOrg]) await db.org.create({ data: { id, name: 'QA Editorial', slug: 'editorial-' + id } });
    const perms = []; for (const key of ['tarefas.ver', 'tarefas.editar', 'pauta.ver', 'pauta.editar']) perms.push(await db.permission.upsert({ where: { key }, create: { key }, update: {} }));
    roleHigh = (await db.role.create({ data: { orgId: org, key: 'gestor_marketing', name: 'QA aprovação', permissions: { connect: perms.map((p) => ({ id: p.id })) } } })).id;
    roleLow = (await db.role.create({ data: { orgId: org, key: 'analista', name: 'QA autoria', permissions: { connect: perms.map((p) => ({ id: p.id })) } } })).id;
    for (const id of [author, approver, lower]) await db.user.create({ data: { id, orgId: org, name: 'Pessoa QA editorial', email: id + '@qa.invalid', passwordHash: 'sem-login', roles: { connect: { id: id === approver ? roleHigh : roleLow } } } });
    await db.user.create({ data: { id: foreign, orgId: otherOrg, name: 'Outra QA', email: foreign + '@qa.invalid', passwordHash: 'sem-login' } });
    listId = (await db.workList.create({ data: { orgId: org, name: 'QA Editorial' } })).id;
    releaseId = (await db.workStatus.create({ data: { orgId: org, listId, name: 'Liberada explicitamente', type: 'custom' } })).id;
    reviewId = (await db.workStatus.create({ data: { orgId: org, listId, name: 'Revisão QA', type: 'open' } })).id;
    extId = 'qa-' + uid(); taskId = (await db.workTask.create({ data: { orgId: org, listId, statusId: releaseId, title: 'QA editorial existente', externalId: extId, dueDate: new Date('2026-10-09T12:00:00Z') } })).id;
    root = await mkdtemp(join(tmpdir(), 'rootos-editorial-')); process.env.WORK_FILES_ROOT = root;
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); await reset();
    await db.user.updateMany({ where: { id: { in: [author, approver, lower] } }, data: { isActive: true } });
    await db.user.update({ where: { id: approver }, data: { roles: { set: [{ id: roleHigh }] } } });
    await db.role.update({ where: { id: roleHigh }, data: { permissions: { connect: { key: 'pauta.editar' } } } });
    await db.workTask.update({ where: { id: taskId }, data: { statusId: releaseId, archived: false } });
    await writeFile(join(root, 'qa.txt'), fileBytes);
    await writeFile(join(root, 'attachments-index.json'), JSON.stringify({ orgId: org, files: [{ taskId: extId, id: 'arquivo-qa', name: 'qa.txt', path: 'qa.txt', sha256: createHash('sha256').update(fileBytes).digest('hex'), size: fileBytes.length }] }));
  });
  afterAll(async () => {
    if (!db) return; await reset(); await db.workTask.deleteMany({ where: { orgId: org } }); await db.workStatus.deleteMany({ where: { orgId: org } }); await db.workList.deleteMany({ where: { orgId: org } });
    await db.user.deleteMany({ where: { id: { in: [author, approver, lower, foreign] } } }); await db.role.deleteMany({ where: { orgId: org } }); await db.org.deleteMany({ where: { id: { in: [org, otherOrg] } } }); await db.$disconnect(); await rm(root, { recursive: true, force: true }); delete process.env.WORK_FILES_ROOT;
  });
  it('reaproveita material e arquivo existentes, registra versão sem criar outro card', async () => {
    const before = await db.workTask.count({ where: { orgId: org } }); const r = await svc.criar(org, author, createInput(true)), v = await version(r.versionId!);
    expect(v.body).toBe('Texto preservado de QA'); expect(v.files[0].sha256).toBe(createHash('sha256').update(fileBytes).digest('hex')); expect(await db.workTask.count({ where: { orgId: org } })).toBe(before);
  });
  it('replay material e intenção alterada/ator diferente são distintos', async () => {
    const p = createInput(); const a = await svc.criar(org, author, p); expect(await svc.criar(org, author, p)).toMatchObject({ materialId: a.materialId, versionId: a.versionId, replayed: true });
    expect(await status(svc.criar(org, author, { ...p, body: 'Troca' }))).toBe(409); expect(await status(svc.criar(org, lower, p))).toBe(409);
  });
  it('não cria material paralelo com outro requestId na mesma tarefa', async () => { await svc.criar(org, author, createInput()); expect(await status(svc.criar(org, author, createInput()))).toBe(409); });
  it('outra empresa e etapa de outra lista não entram', async () => {
    expect(await status(svc.criar(org, author, { ...createInput(), taskId: uid() }))).toBe(404);
    const list = await db.workList.create({ data: { orgId: org, name: 'QA outra lista' } }); const stage = await db.workStatus.create({ data: { orgId: org, listId: list.id, name: 'Outra etapa' } });
    expect(await status(svc.criar(org, author, { ...createInput(), releaseStatusId: stage.id }))).toBe(409); await db.workStatus.delete({ where: { id: stage.id } }); await db.workList.delete({ where: { id: list.id } });
  });
  it('arquivo ausente ou de outro card impede material sem efeito parcial', async () => {
    await rm(join(root, 'qa.txt')); expect(await status(svc.criar(org, author, createInput(true)))).toBe(404);
    expect(await status(svc.criar(org, author, { ...createInput(), files: [{ taskExternalId: 'outra', fileId: 'arquivo-qa' }] }))).toBe(404);
    expect((await svc.obter(org, author, taskId)).material).toBeNull();
  });
  it('aprovação tem alçada atual, pessoa distinta e hash exato', async () => { const a = await approved(); expect((await svc.obter(org, author, taskId)).decisions[0]).toMatchObject({ actorId: approver, authority: 'responsavel', versionId: a.v.id }); });
  it('autor e pessoa sem alçada não aprovam', async () => {
    const r = await svc.criar(org, author, createInput()), v = await version(r.versionId!); const p = { requestId: uid(), versionId: v.id, contentHash: v.contentHash, state: 'approved' as const, reason: 'QA' };
    expect(await status(svc.decidir(org, author, p))).toBe(403); expect(await status(svc.decidir(org, lower, p))).toBe(403);
    await db.user.update({ where: { id: author }, data: { roles: { set: [{ id: roleHigh }] } } }); expect(await status(svc.decidir(org, author, p))).toBe(403);
  });
  it('aprovador inativo e permissão atual revogada são recusados', async () => {
    const r = await svc.criar(org, author, createInput()), v = await version(r.versionId!); const p = { requestId: uid(), versionId: v.id, contentHash: v.contentHash, state: 'approved' as const, reason: 'QA' };
    await db.user.update({ where: { id: approver }, data: { isActive: false } }); expect(await status(svc.decidir(org, approver, p))).toBe(403);
    await db.user.update({ where: { id: approver }, data: { isActive: true } }); await db.role.update({ where: { id: roleHigh }, data: { permissions: { disconnect: { key: 'pauta.editar' } } } }); expect(await status(svc.decidir(org, approver, p))).toBe(403);
  });
  it('decisão rejeita hash diferente e versão inexistente', async () => { const r = await svc.criar(org, author, createInput()), v = await version(r.versionId!); const p = { requestId: uid(), versionId: v.id, contentHash: 'a'.repeat(64), state: 'approved' as const, reason: 'QA' }; expect(await status(svc.decidir(org, approver, p))).toBe(409); expect(await status(svc.decidir(org, approver, { ...p, versionId: uid() }))).toBe(404); });
  it('decisão repetida conserva uma assinatura e outra intenção não sobrescreve', async () => { const a = await approved(); expect(await svc.decidir(org, approver, a.decisionInput)).toMatchObject({ decisionId: a.d.decisionId, replayed: true }); expect(await status(svc.decidir(org, approver, { ...a.decisionInput, requestId: uid(), state: 'rejected' }))).toBe(409); });
  it('entrada direta exige etapa liberada e produção não inventa horário de publicação', async () => {
    const a = await approved(); await db.workTask.update({ where: { id: taskId }, data: { statusId: reviewId } }); expect(await status(svc.conferirProducao(org, author, a.productionInput))).toBe(409); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(409); expect(await nProductions()).toBe(0);
    await db.workTask.update({ where: { id: taskId }, data: { statusId: releaseId } }); const p = await svc.produzir(org, author, a.productionInput); expect(p.production.body).toBe(a.v.body); expect('agendadaPara' in p.production).toBe(false);
  });
  it('nova versão selecionada não herda aprovação e guarda a versão/produção antiga', async () => {
    const a = await approved(); const old = await svc.produzir(org, author, a.productionInput);
    const next = await svc.prepararVersao(org, author, a.made.materialId, { requestId: uid(), expectedRevision: 1, title: 'Nova QA', body: 'Novo corpo', sourceRef: 'QA v2', files: [] });
    expect(await status(svc.produzir(org, author, { ...a.productionInput, requestId: uid() }))).toBe(409); const s = await svc.obter(org, author, taskId); expect(s.versions.length).toBe(2); expect(s.material?.selectedVersionId).toBe(next.versionId); expect(s.productions[0].id).toBe(old.production.id); expect(s.productions[0].body).toBe(a.v.body);
  });
  it('criação inicial repetida depois de nova versão retorna sua versão original', async () => { const a = await approved(); await svc.prepararVersao(org, author, a.made.materialId, { requestId: uid(), expectedRevision: 1, title: 'Nova QA', body: 'Novo corpo', sourceRef: 'QA v2', files: [] }); expect((await svc.criar(org, author, a.input)).versionId).toBe(a.v.id); });
  it('versão conserva idempotência após atualizações e conflito não troca seleção', async () => {
    const a = await approved(); const p = { requestId: uid(), expectedRevision: 1, title: 'Nova QA', body: 'Novo corpo', sourceRef: 'QA v2', files: [] }; const b = await svc.prepararVersao(org, author, a.made.materialId, p);
    expect(await svc.prepararVersao(org, author, a.made.materialId, p)).toMatchObject({ versionId: b.versionId, replayed: true }); expect(await status(svc.prepararVersao(org, author, a.made.materialId, { ...p, requestId: uid() }))).toBe(409); expect((await svc.obter(org, author, taskId)).material?.selectedVersionId).toBe(b.versionId);
  });
  it('replay produção após revogação devolve confirmação, sem novo efeito', async () => { const a = await approved(); const first = await svc.produzir(org, author, a.productionInput); await svc.revogar(org, approver, a.d.decisionId, 'Revogada QA'); const replay = await svc.produzir(org, author, a.productionInput); expect(replay.production.id).toBe(first.production.id); expect(replay.replayed).toBe(true); expect(await nProductions()).toBe(1); expect(await status(svc.produzir(org, author, { ...a.productionInput, requestId: uid() }))).toBe(409); });
  it('replay produção com ator diferente ou conteúdo diferente recebe409', async () => { const a = await approved(); await svc.produzir(org, author, a.productionInput); expect(await status(svc.produzir(org, lower, a.productionInput))).toBe(409); expect(await status(svc.produzir(org, author, { ...a.productionInput, contentHash: 'a'.repeat(64) }))).toBe(409); });
  it('revogação é terminal e histórico permanece; mesmo motivo confirma', async () => { const a = await approved(); expect((await svc.revogar(org, approver, a.d.decisionId, 'QA revogação')).replayed).toBe(false); expect((await svc.revogar(org, approver, a.d.decisionId, 'QA revogação')).replayed).toBe(true); expect(await status(svc.revogar(org, approver, a.d.decisionId, 'Outro pedido'))).toBe(409); expect((await svc.obter(org, author, taskId)).decisions[0].revokedAt).not.toBeNull(); });
  it('recusa não libera Produção', async () => { const r = await svc.criar(org, author, createInput()), v = await version(r.versionId!); const d = await svc.decidir(org, approver, { requestId: uid(), versionId: v.id, contentHash: v.contentHash, state: 'rejected', reason: 'Voltar QA' }); expect(await status(svc.produzir(org, author, { requestId: uid(), taskId, versionId: v.id, decisionId: d.decisionId, contentHash: v.contentHash }))).toBe(409); });
  it('aprovador rebaixado/inativo depois da decisão bloqueia novo uso', async () => { const a = await approved(); await db.user.update({ where: { id: approver }, data: { roles: { set: [{ id: roleLow }] } } }); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(403); await db.user.update({ where: { id: approver }, data: { roles: { set: [{ id: roleHigh }] }, isActive: false } }); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(403); });
  it('arquivo retirado depois da aprovação bloqueia o acesso direto', async () => { const a = await approved(true); await rm(join(root, 'qa.txt')); expect(await status(svc.conferirProducao(org, author, a.productionInput))).toBe(404); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(404); expect(await nProductions()).toBe(0); });
  it('arquivo alterado mesmo tamanho falha no hash preservado', async () => { const a = await approved(true); await writeFile(join(root, 'qa.txt'), Buffer.alloc(fileBytes.length, 120)); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(404); });
  it('revogação de acesso da pessoa impede leitura e uso com identidade antiga', async () => { const a = await approved(); await db.user.update({ where: { id: author }, data: { isActive: false } }); expect(await status(svc.obter(org, author, taskId))).toBe(403); expect(await status(svc.produzir(org, author, a.productionInput))).toBe(403); });
  it('rollback de auditoria conserva produção e pedido sem efeito parcial', async () => { const a = await approved(); vi.spyOn(audit, 'log').mockRejectedValueOnce(Error('QA audit failure')); await expect(svc.produzir(org, author, a.productionInput)).rejects.toThrow('QA audit failure'); expect(await nProductions()).toBe(0); vi.restoreAllMocks(); expect((await svc.produzir(org, author, a.productionInput)).replayed).toBe(false); });
  it('duas produções concorrentes da mesma intenção geram uma peça', async () => { const a = await approved(); const [x, y] = await Promise.all([svc.produzir(org, author, a.productionInput), svc.produzir(org, author, a.productionInput)]); expect(x.production.id).toBe(y.production.id); expect(await nProductions()).toBe(1); expect([x.replayed, y.replayed].sort()).toEqual([false, true]); });
  it('tarefa arquivada bloqueia produção mantendo o histórico anterior', async () => { const a = await approved(); const first = await svc.produzir(org, author, a.productionInput); await db.workTask.update({ where: { id: taskId }, data: { archived: true } }); expect(await status(svc.produzir(org, author, { ...a.productionInput, requestId: uid() }))).toBe(409); expect((await svc.obter(org, author, taskId)).productions[0].id).toBe(first.production.id); });
  it('revogação pendente bloqueia produção até a decisão ser conferida na mesma trava', async () => {
    const a = await approved(); let locked!: () => void, release!: () => void; const reached = new Promise<void>((r) => { locked = r; }), allowCommit = new Promise<void>((r) => { release = r; });
    const revoke = db.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'editorial:' + org}, 0))`; await tx.$executeRaw`UPDATE "EditorialDecision" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedBy"=${approver},"revokedReason"='QA concorrência' WHERE "id"=${a.d.decisionId}`; locked(); await allowCommit; });
    await reached; let finished = false; const producing = status(svc.produzir(org, author, a.productionInput)).then((r) => { finished = true; return r; }); await new Promise((r) => setTimeout(r, 50)); expect(finished).toBe(false); release(); await revoke; expect(await producing).toBe(409); expect(await nProductions()).toBe(0);
  });
  it('banco recusa seleção de versão de outro material, mesmo na empresa', async () => {
    const a = await approved(); const task2 = await db.workTask.create({ data: { orgId: org, listId, statusId: releaseId, title: 'Outra tarefa QA' } }); const b = await svc.criar(org, author, { ...createInput(), taskId: task2.id });
    await expect(db.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=${b.versionId} WHERE "id"=${a.made.materialId}`).rejects.toThrow();
  });
  it('versão, produção e decisão não podem ser adulteradas no banco', async () => { const a = await approved(), p = await svc.produzir(org, author, a.productionInput); await expect(db.$executeRaw`UPDATE "EditorialVersion" SET "body"='Adulterado' WHERE "id"=${a.v.id}`).rejects.toThrow(); await expect(db.$executeRaw`UPDATE "EditorialProduction" SET "body"='Adulterado' WHERE "id"=${p.production.id}`).rejects.toThrow(); await expect(db.$executeRaw`UPDATE "EditorialDecision" SET "state"='rejected' WHERE "id"=${a.d.decisionId}`).rejects.toThrow(); });
  it('banco recusa snapshot de produção que não corresponde à versão', async () => { const a = await approved(); await expect(db.$executeRaw`INSERT INTO "EditorialProduction"("id","orgId","taskId","materialId","versionId","decisionId","title","body","files","sourceRef","contentHash","requestId","actorId","fingerprint") VALUES (${uid()},${org},${taskId},${a.made.materialId},${a.v.id},${a.d.decisionId},${a.v.title},'Adulterado','[]'::jsonb,${a.v.sourceRef},${a.v.contentHash},${uid()},${author},'QA')`).rejects.toThrow(); });
});
