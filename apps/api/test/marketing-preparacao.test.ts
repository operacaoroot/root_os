import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { WorkFilesService } from '../src/work/work-files.service';
import { EditorialService } from '../src/pauta/editorial.service';
import { MarketingPreparacaoService } from '../src/marketing-preparacao/marketing-preparacao.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { MarketingPrepareSchema } from '../src/marketing-preparacao/marketing-preparacao.controller';

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL é obrigatório para esta suíte de QA.');
exigirBancoDescartavel(URL, 'fixtures próprias de Marketing');
vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
const uid = randomUUID;
const code = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.getStatus?.() ?? e.code ?? e.message; } };
describe('Preparação local de Marketing: destino, versão, alçada e repetição', () => {
  const db = new PrismaService({ datasourceUrl: URL }); const control = new PrismaService({ datasourceUrl: URL }); const audit = new AuditService(db);
  const editorial = new EditorialService(db, audit, new WorkFilesService(db));
  const svc = new MarketingPreparacaoService(db, audit, editorial);
  const org = uid(), otherOrg = uid(), actor = uid(), approver = uid(), denied = uid(), foreign = uid();
  let role: string, list: string, release: string, review: string, task: string, a: string, b: string;
  let accountA: any, accountB: any, input: any;
  const sqlDelete = async (table: string) => db.$executeRawUnsafe('DELETE FROM "' + table + '" WHERE "orgId"=$1', org);
  beforeAll(async () => {
    await db.$connect();
    await db.org.createMany({ data: [{ id: org, name: 'QA preparo isolado', slug: 'qa-preparo-' + org }, { id: otherOrg, name: 'QA outra empresa', slug: 'qa-preparo-' + otherOrg }] });
    const keys = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'tarefas.ver', 'tarefas.editar', 'bio.editar', 'admin.usuarios'];
    const perms = await db.permission.findMany({ where: { key: { in: keys } } });
    expect(perms).toHaveLength(keys.length);
    role = (await db.role.create({ data: { orgId: org, key: 'admin_master', name: 'QA local', permissions: { connect: perms.map((p) => ({ id: p.id })) } } })).id;
    for (const id of [actor, approver, denied]) await db.user.create({ data: { id, orgId: org, name: 'Pessoa QA preparo', email: id + '@qa.invalid', passwordHash: 'sem-login', roles: { connect: { id: role } } } });
    await db.user.create({ data: { id: foreign, orgId: otherOrg, name: 'Pessoa outra QA', email: foreign + '@qa.invalid', passwordHash: 'sem-login' } });
    list = (await db.workList.create({ data: { orgId: org, name: 'QA preparo' } })).id;
    release = (await db.workStatus.create({ data: { orgId: org, listId: list, name: 'Liberado' } })).id;
    review = (await db.workStatus.create({ data: { orgId: org, listId: list, name: 'Revisão' } })).id;
    task = (await db.workTask.create({ data: { orgId: org, listId: list, statusId: release, title: 'QA material de preparo', externalId: 'qa-preparo-' + org } })).id;
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const t of ['MarketingPreparation', 'MarketingAccountConfig', 'EditorialProduction', 'EditorialDecision']) await sqlDelete(t);
    await db.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=NULL WHERE "orgId"=${org}`;
    for (const t of ['EditorialVersion', 'EditorialMaterial']) await sqlDelete(t);
    await db.bioConexao.deleteMany({ where: { orgId: org } });
    await db.user.updateMany({ where: { orgId: org }, data: { isActive: true } });
    for (const id of [actor, approver, denied]) await db.user.update({ where: { id }, data: { roles: { set: [{ id: role }] } } });
    await db.workTask.update({ where: { id: task }, data: { statusId: release, archived: false } });
    for (const key of ['pauta.ver', 'pauta.editar', 'pauta.publicar']) await db.role.update({ where: { id: role }, data: { permissions: { connect: { key } } } });
    a = (await db.bioConexao.create({ data: { orgId: org, plataforma: 'instagram', externalId: uid(), handle: 'qa_conta_a', tokenCifrado: 'fixture-sem-token', finalidade: 'publicacao', status: 'ok', escopos: 'instagram_business_content_publish' } })).id;
    b = (await db.bioConexao.create({ data: { orgId: org, plataforma: 'instagram', externalId: uid(), handle: 'qa_conta_b', tokenCifrado: 'fixture-sem-token', finalidade: 'bio', status: 'ok', escopos: 'instagram_business_content_publish' } })).id;
    accountA = (await svc.configurar(org, actor, { requestId: uid(), connectionId: a, ownerId: actor, operators: [approver] })).account;
    accountB = (await svc.configurar(org, actor, { requestId: uid(), connectionId: b, ownerId: actor, operators: [approver] })).account;
    const material = await editorial.criar(org, actor, { requestId: uid(), taskId: task, releaseStatusId: release, title: 'QA versão para destino', body: 'Corpo exato de QA', sourceRef: 'QA operador', files: [] });
    const v = (await db.$queryRaw<any[]>`SELECT * FROM "EditorialVersion" WHERE "id"=${material.versionId}`)[0];
    const decision = await editorial.decidir(org, approver, { requestId: uid(), versionId: v.id, contentHash: v.contentHash, state: 'approved', reason: 'Exercício QA' });
    input = { requestId: uid(), accountId: accountA.id, expectedAccountRevision: accountA.revision, taskId: task, versionId: v.id, decisionId: decision.decisionId, contentHash: v.contentHash, scheduledAt: new Date(Date.now() + 86400000).toISOString(), timezone: 'America/Sao_Paulo' };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const t of ['MarketingPreparation', 'MarketingAccountConfig', 'EditorialProduction', 'EditorialDecision']) await sqlDelete(t);
    await db.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=NULL WHERE "orgId"=${org}`;
    for (const t of ['EditorialVersion', 'EditorialMaterial']) await sqlDelete(t);
    await db.auditLog.deleteMany({ where: { orgId: org } }); await db.bioConexao.deleteMany({ where: { orgId: org } });
    await db.workTask.deleteMany({ where: { orgId: org } }); await db.workStatus.deleteMany({ where: { orgId: org } }); await db.workList.deleteMany({ where: { orgId: org } });
    await db.user.deleteMany({ where: { id: { in: [actor, approver, denied, foreign] } } }); await db.role.deleteMany({ where: { orgId: org } });
    await db.org.deleteMany({ where: { id: { in: [org, otherOrg] } } }); await control.$disconnect(); await db.$disconnect();
  });
  it('duas contas conservam identidades e concessões separadas', async () => {
    const c = await svc.listar(org, actor); expect(c.accounts).toHaveLength(2); expect(c.accounts.map((v) => v.handle)).toEqual(['qa_conta_a', 'qa_conta_b']);
    expect(c.accounts.every((v) => !v.publicationAvailable && !v.metricsAvailable)).toBe(true);
  });
  it('reenvio da configuração preserva identidade; payload diferente recebe409', async () => {
    const p = { requestId: accountA.requestId, connectionId: a, ownerId: actor, operators: [approver] };
    expect(await svc.configurar(org, actor, p)).toMatchObject({ account: { id: accountA.id }, replayed: true });
    expect(await code(svc.configurar(org, actor, { ...p, ownerId: denied }))).toBe(409);
  });
  it('pessoa sem concessão não vê nem usa conta; outra empresa recusada', async () => {
    expect((await svc.listar(org, denied)).accounts).toHaveLength(0); expect(await code(svc.preparar(org, denied, input))).toBe(404);
    expect(await code(svc.listar(org, foreign))).toBe(403);
  });
  it('dono estrangeiro e pessoa inativa não recebem concessão', async () => {
    const c = await db.bioConexao.create({ data: { orgId: org, plataforma: 'instagram', externalId: uid(), handle: 'qa_c', tokenCifrado: 'fixture' } });
    expect(await code(svc.configurar(org, actor, { requestId: uid(), connectionId: c.id, ownerId: foreign, operators: [] }))).toBe(403);
    await db.user.update({ where: { id: denied }, data: { isActive: false } });
    expect(await code(svc.configurar(org, actor, { requestId: uid(), connectionId: c.id, ownerId: actor, operators: [denied] }))).toBe(403);
  });
  it('permissão atual e pessoa ativa são conferidas no banco', async () => {
    await db.user.update({ where: { id: actor }, data: { isActive: false } }); expect(await code(svc.listar(org, actor))).toBe(403);
    await db.user.update({ where: { id: actor }, data: { isActive: true, roles: { set: [] } } }); expect(await code(svc.preparar(org, actor, input))).toBe(403);
  });
  it('preparo fixa destino, versão, decisão e horário sem publicação externa', async () => {
    const before = await db.pautaPublicacao.count(); const r = await svc.preparar(org, actor, input);
    expect(r.preparation).toMatchObject({ handle: 'qa_conta_a', versionId: input.versionId, decisionId: input.decisionId, state: 'prepared', timezone: input.timezone });
    expect(r.preparation.scheduledAt.toISOString()).toBe(input.scheduledAt); expect(await db.pautaPublicacao.count()).toBe(before);
    expect(await svc.detalhe(org, actor, r.preparation.id)).toMatchObject({ publicationAvailable: false, metricsAvailable: false });
  });
  it('pedidos concorrentes idênticos criam um único preparo', async () => {
    const r = await Promise.all([svc.preparar(org, actor, input), svc.preparar(org, actor, input)]);
    expect(r[0].preparation.id).toBe(r[1].preparation.id); expect(r.filter((v) => v.replayed)).toHaveLength(1);
  });
  it('reenvio após desconexão reencontra preparo histórico sem trocar conta', async () => {
    const r = await svc.preparar(org, actor, input); await db.bioConexao.delete({ where: { id: a } });
    expect(await svc.preparar(org, actor, input)).toMatchObject({ preparation: { id: r.preparation.id, connectionId: a }, replayed: true });
    expect(await code(svc.preparar(org, actor, { ...input, requestId: uid() }))).toBe(409);
  });
  it('mesmo requestId com outra conta ou pessoa recebe409', async () => {
    await svc.preparar(org, actor, input);
    expect(await code(svc.preparar(org, actor, { ...input, accountId: accountB.id }))).toBe(409);
    expect(await code(svc.preparar(org, approver, input))).toBe(409);
  });
  it('aprovação revogada impede novo preparo sem apagar o anterior', async () => {
    const r = await svc.preparar(org, actor, input); await editorial.revogar(org, approver, input.decisionId, 'QA revogação');
    expect(await code(svc.preparar(org, actor, { ...input, requestId: uid() }))).toBe(409);
    expect((await svc.detalhe(org, actor, r.preparation.id)).preparation.id).toBe(r.preparation.id);
  });
  it('tarefa em revisão e hash adulterado não entram', async () => {
    expect(await code(svc.preparar(org, actor, { ...input, contentHash: 'a'.repeat(64) }))).toBe(409);
    await db.workTask.update({ where: { id: task }, data: { statusId: review } }); expect(await code(svc.preparar(org, actor, input))).toBe(409);
  });
  it('mudança de identidade da conexão não usa outra conta silenciosamente', async () => {
    await db.bioConexao.update({ where: { id: a }, data: { externalId: uid(), handle: 'qa_outra' } }); expect(await code(svc.preparar(org, actor, input))).toBe(409);
  });
  it('escopo ausente, token vencido e estado inválido recusam novo preparo', async () => {
    await db.bioConexao.update({ where: { id: a }, data: { escopos: '' } }); expect(await code(svc.preparar(org, actor, input))).toBe(409);
    await db.bioConexao.update({ where: { id: a }, data: { escopos: 'instagram_business_content_publish', expiraEm: new Date(0) } }); expect(await code(svc.preparar(org, actor, input))).toBe(409);
    await db.bioConexao.update({ where: { id: a }, data: { expiraEm: null, status: 'erro' } }); expect(await code(svc.preparar(org, actor, input))).toBe(409);
  });
  it('desativar A não muda B nem prepara A por default', async () => {
    await svc.disponibilidade(org, actor, accountA.id, { active: false, expectedRevision: 1 });
    expect(await code(svc.preparar(org, actor, input))).toBe(409);
    expect((await svc.preparar(org, actor, { ...input, requestId: uid(), accountId: accountB.id })).preparation.handle).toBe('qa_conta_b');
  });
  it('revisão concorrente da conta recebe conflito', async () => {
    await svc.disponibilidade(org, actor, accountA.id, { active: false, expectedRevision: 1 });
    expect(await code(svc.disponibilidade(org, actor, accountA.id, { active: true, expectedRevision: 1 }))).toBe(409);
  });
  it('falha de auditoria desfaz o preparo', async () => {
    const real = audit.log.bind(audit); vi.spyOn(audit, 'log').mockImplementation(async (p, tx) => { if (p.action === 'marketing.prepared') throw new Error('Falha QA'); return real(p, tx); });
    expect(await code(svc.preparar(org, actor, input))).toBe('Falha QA');
    expect((await db.$queryRaw<any[]>`SELECT * FROM "MarketingPreparation" WHERE "orgId"=${org}`)).toHaveLength(0);
  });
  it('revogar permissão de publicação durante a conferência editorial desfaz o preparo', async () => {
    const real = editorial.conferirProducao.bind(editorial);
    vi.spyOn(editorial, 'conferirProducao').mockImplementation(async (...args) => {
      const result = await real(...args);
      await control.role.update({ where: { id: role }, data: { permissions: { disconnect: { key: 'pauta.publicar' } } } });
      return result;
    });
    expect(await code(svc.preparar(org, actor, input))).toBe(403);
    expect((await db.$queryRaw<any[]>`SELECT * FROM "MarketingPreparation" WHERE "orgId"=${org}`)).toHaveLength(0);
  });
  it('desconectar o destino durante a conferência editorial impede a gravação', async () => {
    const real = editorial.conferirProducao.bind(editorial);
    vi.spyOn(editorial, 'conferirProducao').mockImplementation(async (...args) => {
      const result = await real(...args);
      await control.bioConexao.delete({ where: { id: a } });
      return result;
    });
    expect(await code(svc.preparar(org, actor, input))).toBe(409);
    expect((await db.$queryRaw<any[]>`SELECT * FROM "MarketingPreparation" WHERE "orgId"=${org}`)).toHaveLength(0);
  });
  it('snapshot de preparo é imutável no banco', async () => {
    const r = await svc.preparar(org, actor, input); await expect(db.$executeRaw`UPDATE "MarketingPreparation" SET "handle"='outra' WHERE "id"=${r.preparation.id}`).rejects.toThrow();
  });
  it('fuso e horário ausentes/inválidos são recusados na fronteira do contrato', () => {
    expect(MarketingPrepareSchema.safeParse({ ...input, timezone: 'inventado' }).success).toBe(false);
    expect(MarketingPrepareSchema.safeParse({ ...input, scheduledAt: '2026-10-08T12:00' }).success).toBe(false);
  });
});
