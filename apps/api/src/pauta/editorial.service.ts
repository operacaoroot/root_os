import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkFilesService } from '../work/work-files.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { alcadaDe, atendeAlcada } from '../approvals/alcada';
import { editorialContentHash, editorialFingerprint, type EditorialCreate, type EditorialVersionInput, type EditorialDecisionInput, type EditorialProductionInput, type EditorialFile, type EditorialMaterialRow, type EditorialVersionRow, type EditorialDecisionRow, type EditorialProductionRow, type EditorialConference } from './editorial-contrato';

type Db = Prisma.TransactionClient;
const VIEW = ['tarefas.ver', 'pauta.ver'];
const EDIT = [...VIEW, 'tarefas.editar', 'pauta.editar'];

@Injectable()
export class EditorialService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly files: WorkFilesService) {}
  private async run<T>(orgId: string, actorId: string, fn: (tx: Db) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'editorial:' + orgId}, 0))`;
      await exigirAcessoAtual(tx, orgId, actorId, EDIT);
      const result = await fn(tx);
      await exigirAcessoAtual(tx, orgId, actorId, EDIT);
      return result;
    }, { timeout: 20000 });
  }
  private async task(db: Db, orgId: string, taskId: string, lock = false) {
    if (lock) await db.$queryRaw`SELECT "id" FROM "WorkTask" WHERE "id"=${taskId} AND "orgId"=${orgId} FOR UPDATE`;
    const task = await db.workTask.findFirst({ where: { id: taskId, orgId }, include: { status: true, list: { include: { statuses: true } } } });
    if (!task) throw new NotFoundException('Tarefa indisponível.');
    return task;
  }
  private replay(row: { actorId: string; fingerprint: string }, actorId: string, fingerprint: string) {
    if (row.actorId !== actorId || row.fingerprint !== fingerprint) throw new ConflictException('O pedido já foi usado por outra pessoa ou com outro conteúdo.');
  }
  private async material(db: Db, orgId: string, id: string) {
    const rows = await db.$queryRaw<EditorialMaterialRow[]>`SELECT * FROM "EditorialMaterial" WHERE "id"=${id} AND "orgId"=${orgId}`;
    if (!rows[0]) throw new NotFoundException('Material indisponível.'); return rows[0];
  }
  private async version(db: Db, orgId: string, id: string) {
    const rows = await db.$queryRaw<EditorialVersionRow[]>`SELECT * FROM "EditorialVersion" WHERE "id"=${id} AND "orgId"=${orgId}`;
    const v = rows[0]; if (!v) throw new NotFoundException('Versão indisponível.');
    if (editorialContentHash(v) !== v.contentHash) throw new ConflictException('O conteúdo da versão precisa ser conferido.'); return v;
  }
  private async currentAuthority(db: Db, orgId: string, actorId: string) {
    const u = await db.user.findFirst({ where: { id: actorId, orgId, isActive: true }, select: { roles: { where: { orgId }, select: { key: true } } } });
    const authority = alcadaDe(u?.roles.map((r) => r.key) ?? []);
    if (!u || !atendeAlcada('responsavel', authority)) throw new ForbiddenException('A decisão exige uma pessoa ativa com alçada responsável.'); return authority!;
  }
  private async snapshotFiles(orgId: string, task: { externalId: string | null }, refs: { taskExternalId: string; fileId: string }[]): Promise<EditorialFile[]> {
    const result: EditorialFile[] = [];
    for (const ref of refs) {
      if (!task.externalId || task.externalId !== ref.taskExternalId) throw new NotFoundException('O arquivo não pertence à tarefa selecionada.');
      if (result.some((f) => f.fileId === ref.fileId)) throw new ConflictException('Arquivo repetido.');
      const f = await this.files.read(orgId, ref.taskExternalId, ref.fileId);
      result.push({ ...ref, name: f.name, sha256: createHash('sha256').update(f.bytes).digest('hex') });
    }
    return result;
  }
  private async log(tx: Db, orgId: string, actorId: string, action: string, entityId: string, after: Record<string, string | number | null>) {
    await this.audit.log({ orgId, actorId, action, entityType: 'editorial', entityId, after }, tx);
  }
  async obter(orgId: string, actorId: string, taskId: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, VIEW);
    const task = await this.task(this.prisma, orgId, taskId);
    const materials = await this.prisma.$queryRaw<EditorialMaterialRow[]>`SELECT * FROM "EditorialMaterial" WHERE "taskId"=${taskId} AND "orgId"=${orgId}`;
    const material = materials[0] ?? null;
    const versions = material ? await this.prisma.$queryRaw<EditorialVersionRow[]>`SELECT * FROM "EditorialVersion" WHERE "materialId"=${material.id} AND "orgId"=${orgId} ORDER BY "number" DESC` : [];
    for (const v of versions) if (editorialContentHash(v) !== v.contentHash) throw new ConflictException('Histórico da versão precisa ser conferido.');
    const decisions = material ? await this.prisma.$queryRaw<EditorialDecisionRow[]>`SELECT d.* FROM "EditorialDecision" d JOIN "EditorialVersion" v ON v."id"=d."versionId" AND v."orgId"=d."orgId" WHERE v."materialId"=${material.id} AND d."orgId"=${orgId} ORDER BY d."createdAt" DESC, d."id" DESC` : [];
    const productions = await this.prisma.$queryRaw<EditorialProductionRow[]>`SELECT * FROM "EditorialProduction" WHERE "taskId"=${taskId} AND "orgId"=${orgId} ORDER BY "createdAt" DESC`;
    const user = await this.prisma.user.findFirst({ where: { id: actorId, orgId }, select: { roles: { where: { orgId }, select: { key: true } } } });
    return { task: { id: task.id, title: task.title, description: task.description, externalId: task.externalId, statusId: task.statusId, statusName: task.status.name, archived: task.archived, statuses: task.list.statuses.map((s) => ({ id: s.id, name: s.name })) }, material, versions, decisions, productions, canDecide: atendeAlcada('responsavel', alcadaDe(user?.roles.map((r) => r.key) ?? [])) };
  }
  async criar(orgId: string, actorId: string, input: EditorialCreate) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'material', input);
    return this.run(orgId, actorId, async (tx) => {
      const old = (await tx.$queryRaw<EditorialMaterialRow[]>`SELECT * FROM "EditorialMaterial" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); const initial = (await tx.$queryRaw<EditorialVersionRow[]>`SELECT * FROM "EditorialVersion" WHERE "materialId"=${old.id} AND "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0]; return { materialId: old.id, versionId: initial.id, replayed: true }; }
      const task = await this.task(tx, orgId, input.taskId, true);
      if (task.archived) throw new ConflictException('Tarefa arquivada.');
      if (!task.list.statuses.some((s) => s.id === input.releaseStatusId)) throw new ConflictException('A etapa de liberação precisa pertencer à lista da tarefa.');
      const existing = await tx.$queryRaw`SELECT "id" FROM "EditorialMaterial" WHERE "taskId"=${task.id} AND "orgId"=${orgId}`;
      if (Array.isArray(existing) && existing.length) throw new ConflictException('Esta tarefa já possui material editorial; abra o registro existente.');
      const files = await this.snapshotFiles(orgId, task, input.files), materialId = randomUUID(), versionId = randomUUID();
      const contentHash = editorialContentHash({ ...input, files });
      await tx.$executeRaw`INSERT INTO "EditorialMaterial"("id","orgId","taskId","title","releaseStatusId","requestId","actorId","fingerprint") VALUES (${materialId},${orgId},${task.id},${input.title},${input.releaseStatusId},${input.requestId},${actorId},${fingerprint})`;
      await tx.$executeRaw`INSERT INTO "EditorialVersion"("id","orgId","materialId","number","title","body","files","sourceRef","contentHash","requestId","actorId","fingerprint") VALUES (${versionId},${orgId},${materialId},1,${input.title},${input.body},${JSON.stringify(files)}::jsonb,${input.sourceRef},${contentHash},${input.requestId},${actorId},${fingerprint})`;
      await tx.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=${versionId} WHERE "id"=${materialId} AND "orgId"=${orgId}`;
      await this.log(tx, orgId, actorId, 'editorial.material.created', materialId, { taskId: task.id, versionId, contentHash, releaseStatusId: input.releaseStatusId });
      return { materialId, versionId, replayed: false };
    });
  }
  async prepararVersao(orgId: string, actorId: string, materialId: string, input: EditorialVersionInput) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'version:' + materialId, input);
    return this.run(orgId, actorId, async (tx) => {
      const old = (await tx.$queryRaw<EditorialVersionRow[]>`SELECT * FROM "EditorialVersion" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); return { materialId, versionId: old.id, replayed: true }; }
      const m = await this.material(tx, orgId, materialId), task = await this.task(tx, orgId, m.taskId, true);
      if (m.revision !== input.expectedRevision || task.archived) throw new ConflictException('O material mudou. Confira o histórico antes de preparar a versão.');
      const files = await this.snapshotFiles(orgId, task, input.files), versionId = randomUUID(), number = m.revision + 1;
      const contentHash = editorialContentHash({ ...input, files });
      await tx.$executeRaw`INSERT INTO "EditorialVersion"("id","orgId","materialId","number","title","body","files","sourceRef","contentHash","requestId","actorId","fingerprint") VALUES (${versionId},${orgId},${materialId},${number},${input.title},${input.body},${JSON.stringify(files)}::jsonb,${input.sourceRef},${contentHash},${input.requestId},${actorId},${fingerprint})`;
      await tx.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=${versionId},"revision"=${number} WHERE "id"=${materialId} AND "orgId"=${orgId}`;
      await this.log(tx, orgId, actorId, 'editorial.version.selected', materialId, { taskId: task.id, versionId, number, contentHash });
      return { materialId, versionId, replayed: false };
    });
  }
  async decidir(orgId: string, actorId: string, input: EditorialDecisionInput) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'decision', input);
    return this.run(orgId, actorId, async (tx) => {
      const old = (await tx.$queryRaw<EditorialDecisionRow[]>`SELECT * FROM "EditorialDecision" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); return { decisionId: old.id, replayed: true }; }
      const authority = await this.currentAuthority(tx, orgId, actorId), v = await this.version(tx, orgId, input.versionId), m = await this.material(tx, orgId, v.materialId);
      await this.task(tx, orgId, m.taskId, true);
      if (v.actorId === actorId) throw new ForbiddenException('A versão precisa da decisão de outra pessoa.');
      if (m.selectedVersionId !== v.id || v.contentHash !== input.contentHash) throw new ConflictException('A decisão precisa corresponder à versão selecionada e ao conteúdo exato.');
      const prior = await tx.$queryRaw<EditorialDecisionRow[]>`SELECT * FROM "EditorialDecision" WHERE "orgId"=${orgId} AND "versionId"=${v.id}`;
      if (prior.length) throw new ConflictException('A versão já possui decisão. Revogue a aprovação ou prepare outra versão para uma nova decisão.');
      const decisionId = randomUUID();
      await tx.$executeRaw`INSERT INTO "EditorialDecision"("id","orgId","versionId","state","reason","authority","requestId","actorId","fingerprint") VALUES (${decisionId},${orgId},${v.id},${input.state},${input.reason},${authority},${input.requestId},${actorId},${fingerprint})`;
      await this.log(tx, orgId, actorId, 'editorial.content.' + input.state, decisionId, { versionId: v.id, contentHash: v.contentHash, authority });
      return { decisionId, replayed: false };
    });
  }
  async revogar(orgId: string, actorId: string, decisionId: string, reason: string) {
    return this.run(orgId, actorId, async (tx) => {
      await this.currentAuthority(tx, orgId, actorId);
      const d = (await tx.$queryRaw<EditorialDecisionRow[]>`SELECT * FROM "EditorialDecision" WHERE "id"=${decisionId} AND "orgId"=${orgId}`)[0];
      if (!d) throw new NotFoundException('Decisão indisponível.');
      if (d.revokedAt) { if (d.revokedBy !== actorId || d.revokedReason !== reason) throw new ConflictException('A decisão já foi revogada por outro pedido.'); return { decisionId, replayed: true }; }
      const v = await this.version(tx, orgId, d.versionId), m = await this.material(tx, orgId, v.materialId); await this.task(tx, orgId, m.taskId, true);
      await tx.$executeRaw`UPDATE "EditorialDecision" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedBy"=${actorId},"revokedReason"=${reason} WHERE "id"=${decisionId} AND "orgId"=${orgId} AND "revokedAt" IS NULL`;
      await this.log(tx, orgId, actorId, 'editorial.content.revoked', decisionId, { versionId: v.id, reason }); return { decisionId, replayed: false };
    });
  }
  /** Shared local gate. A caller creating a downstream object passes its transaction. */
  async conferirProducao(orgId: string, actorId: string, input: Omit<EditorialProductionInput, 'requestId'>, db?: Db): Promise<EditorialConference> {
    if (!db) return this.prisma.$transaction((tx) => this.conferirProducao(orgId, actorId, input, tx), { timeout: 20000 });
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'editorial:' + orgId}, 0))`;
    await exigirAcessoAtual(db, orgId, actorId, EDIT);
    const task = await this.task(db, orgId, input.taskId, true), v = await this.version(db, orgId, input.versionId), m = await this.material(db, orgId, v.materialId);
    if (m.taskId !== task.id || m.selectedVersionId !== v.id || v.contentHash !== input.contentHash) throw new ConflictException('Selecione a versão atual do material e confira seu conteúdo.');
    if (task.archived || task.statusId !== m.releaseStatusId) throw new ConflictException('A tarefa precisa estar na etapa de liberação para entrar em Produção.');
    const ds = await db.$queryRaw<EditorialDecisionRow[]>`SELECT * FROM "EditorialDecision" WHERE "versionId"=${v.id} AND "orgId"=${orgId} ORDER BY "createdAt" DESC,"id" DESC LIMIT 1`;
    const d = ds[0];
    if (!d || d.id !== input.decisionId || d.state !== 'approved' || d.revokedAt) throw new ConflictException('O conteúdo selecionado precisa de uma aprovação vigente.');
    await exigirAcessoAtual(db, orgId, d.actorId, EDIT); await this.currentAuthority(db, orgId, d.actorId);
    if (d.actorId === v.actorId) throw new ForbiddenException('A versão precisa da decisão de outra pessoa.');
    const actualFiles = await this.snapshotFiles(orgId, task, v.files);
    if (JSON.stringify(actualFiles) !== JSON.stringify(v.files)) throw new ConflictException('Os arquivos da versão mudaram ou estão indisponíveis.');
    // Reading the preserved bytes can outlive a grant. Recheck before a new effect.
    await exigirAcessoAtual(db, orgId, actorId, EDIT);
    await exigirAcessoAtual(db, orgId, d.actorId, EDIT);
    await this.currentAuthority(db, orgId, d.actorId);
    return { taskId: task.id, materialId: m.id, versionId: v.id, versionNumber: v.number, decisionId: d.id, contentHash: v.contentHash, title: v.title, body: v.body, files: v.files, sourceRef: v.sourceRef, approvedBy: d.actorId, authoredBy: v.actorId };
  }
  async produzir(orgId: string, actorId: string, input: EditorialProductionInput) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'production', input);
    return this.run(orgId, actorId, async (tx) => {
      const old = (await tx.$queryRaw<EditorialProductionRow[]>`SELECT * FROM "EditorialProduction" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); return { production: old, replayed: true }; }
      const checked = await this.conferirProducao(orgId, actorId, input, tx), id = randomUUID();
      await tx.$executeRaw`INSERT INTO "EditorialProduction"("id","orgId","taskId","materialId","versionId","decisionId","title","body","files","sourceRef","contentHash","requestId","actorId","fingerprint") VALUES (${id},${orgId},${checked.taskId},${checked.materialId},${checked.versionId},${checked.decisionId},${checked.title},${checked.body},${JSON.stringify(checked.files)}::jsonb,${checked.sourceRef},${checked.contentHash},${input.requestId},${actorId},${fingerprint})`;
      await this.log(tx, orgId, actorId, 'editorial.production.reused', id, { taskId: checked.taskId, versionId: checked.versionId, decisionId: checked.decisionId, contentHash: checked.contentHash });
      const production = (await tx.$queryRaw<EditorialProductionRow[]>`SELECT * FROM "EditorialProduction" WHERE "id"=${id} AND "orgId"=${orgId}`)[0];
      return { production, replayed: false };
    });
  }
}
