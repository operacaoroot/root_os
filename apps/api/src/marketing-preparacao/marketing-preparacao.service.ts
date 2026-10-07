import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { EditorialService } from '../pauta/editorial.service';
import { editorialFingerprint } from '../pauta/editorial-contrato';
import type { MarketingAccountSchema, MarketingPrepareSchema } from './marketing-preparacao.controller';

type Db = Prisma.TransactionClient;
type AccountInput = z.infer<typeof MarketingAccountSchema>;
type PrepareInput = z.infer<typeof MarketingPrepareSchema>;
interface Account {
  id: string; orgId: string; connectionId: string; externalId: string; handle: string;
  ownerId: string; operators: string[]; revision: number; active: boolean;
  actorId: string; requestId: string; fingerprint: string;
}
interface Preparation extends Omit<PrepareInput, 'expectedAccountRevision'> {
  id: string; orgId: string; connectionId: string; externalId: string; handle: string;
  actorId: string; fingerprint: string; scheduledAt: any; accountRevision: number; state: string;
}
const CONFIG = ['bio.editar', 'admin.usuarios'];
const EDIT = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'tarefas.ver', 'tarefas.editar'];
const SCOPE = 'instagram_business_content_publish';

@Injectable()
export class MarketingPreparacaoService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly editorial: EditorialService) {}
  private async run<T>(orgId: string, actorId: string, permissions: string[], fn: (tx: Db) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'marketing-preparacao:' + orgId}, 0))`;
      await exigirAcessoAtual(tx, orgId, actorId, permissions);
      const result = await fn(tx);
      await exigirAcessoAtual(tx, orgId, actorId, permissions);
      return result;
    }, { timeout: 20000 });
  }
  private async account(db: Db, orgId: string, id: string, actorId?: string) {
    const rows = await db.$queryRaw<Account[]>`SELECT * FROM "MarketingAccountConfig" WHERE "id"=${id} AND "orgId"=${orgId}`;
    const a = rows[0];
    if (!a || actorId && a.ownerId !== actorId && !a.operators.includes(actorId)) throw new NotFoundException('Conta não disponível para esta pessoa.');
    return a;
  }
  private async connection(db: Db, orgId: string, a: Account) {
    const c = await db.bioConexao.findFirst({ where: { id: a.connectionId, orgId },
      select: { id: true, externalId: true, handle: true, plataforma: true, finalidade: true, status: true, escopos: true, expiraEm: true } });
    const matches = c?.externalId === a.externalId && c?.handle === a.handle && c?.plataforma === 'instagram';
    const scope = c?.escopos?.split(',').map((v) => v.trim()).includes(SCOPE);
    const valid = !!(a.active && matches && c?.status === 'ok' && scope && (!c.expiraEm || c.expiraEm > new Date()));
    return { c, valid, matches };
  }
  private replay(row: { actorId: string; fingerprint: string }, actorId: string, fingerprint: string) {
    if (row.actorId !== actorId || row.fingerprint !== fingerprint) throw new ConflictException('O pedido já foi usado com outra pessoa ou conteúdo.');
  }
  private async log(db: Db, orgId: string, actorId: string, action: string, entityId: string, after: Prisma.InputJsonValue) {
    await this.audit.log({ orgId, actorId, action, entityType: 'marketing_preparation', entityId,
      after, actorType: 'user' }, db);
  }
  async configuracao(orgId: string, actorId: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, CONFIG);
    const [connections, people] = await Promise.all([
      this.prisma.bioConexao.findMany({ where: { orgId, plataforma: 'instagram' },
        select: { id: true, externalId: true, handle: true, status: true, finalidade: true } }),
      this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true } }),
    ]);
    return { connections, people, qa: process.env.ROOTOS_QA_PREVIEW === '1' };
  }
  async configurar(orgId: string, actorId: string, input: AccountInput) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'marketing.account', input);
    return this.run(orgId, actorId, CONFIG, async (db) => {
      const old = (await db.$queryRaw<Account[]>`SELECT * FROM "MarketingAccountConfig" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); return { account: old, replayed: true }; }
      const c = await db.bioConexao.findFirst({ where: { id: input.connectionId, orgId, plataforma: 'instagram' },
        select: { id: true, externalId: true, handle: true } });
      if (!c) throw new NotFoundException('Conexão não encontrada.');
      const ids = [...new Set([input.ownerId, ...input.operators])];
      if (await db.user.count({ where: { orgId, id: { in: ids }, isActive: true } }) !== ids.length) throw new ForbiddenException('Dono e operadores devem ser pessoas ativas desta empresa.');
      const exists = await db.$queryRaw<Account[]>`SELECT * FROM "MarketingAccountConfig" WHERE "orgId"=${orgId} AND "connectionId"=${c.id}`;
      if (exists.length) throw new ConflictException('Esta conexão já possui dono e operadores definidos.');
      const id = randomUUID();
      await db.$executeRaw`INSERT INTO "MarketingAccountConfig"("id","orgId","connectionId","externalId","handle","ownerId","operators","requestId","actorId","fingerprint") VALUES (${id},${orgId},${c.id},${c.externalId},${c.handle},${input.ownerId},${input.operators}::text[],${input.requestId},${actorId},${fingerprint})`;
      await this.log(db, orgId, actorId, 'marketing.account.configured', id, { connectionId: c.id, ownerId: input.ownerId, operators: input.operators });
      return { account: await this.account(db, orgId, id), replayed: false };
    });
  }
  async disponibilidade(orgId: string, actorId: string, id: string, input: { active: boolean; expectedRevision: number }) {
    return this.run(orgId, actorId, CONFIG, async (db) => {
      const a = await this.account(db, orgId, id);
      if (a.revision !== input.expectedRevision) throw new ConflictException('A configuração da conta mudou; confira antes de alterar.');
      await db.$executeRaw`UPDATE "MarketingAccountConfig" SET "active"=${input.active},"revision"="revision"+1 WHERE "id"=${id} AND "orgId"=${orgId}`;
      await this.log(db, orgId, actorId, 'marketing.account.availability', id, { active: input.active, revision: a.revision + 1 });
      return { account: await this.account(db, orgId, id) };
    });
  }
  async listar(orgId: string, actorId: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['pauta.ver']);
    const accounts = await this.prisma.$queryRaw<Account[]>`SELECT * FROM "MarketingAccountConfig" WHERE "orgId"=${orgId} AND ("ownerId"=${actorId} OR ${actorId}=ANY("operators")) ORDER BY "createdAt","id"`;
    const items = [];
    for (const a of accounts) {
      const { c, valid } = await this.connection(this.prisma as unknown as Db, orgId, a);
      items.push({ id: a.id, handle: a.handle, ownerId: a.ownerId, operators: a.operators, revision: a.revision, active: a.active,
        connectionId: a.connectionId, status: c?.status ?? 'desconectada', canPrepare: valid,
        publicationAvailable: false, metricsAvailable: false,
        pending: process.env.ROOTOS_QA_PREVIEW === '1' ? 'Conexão sintética de QA. Publicação e métricas externas indisponíveis.' : 'Este percurso prepara o destino; publicação e métricas exigem integração externa verificada.' });
    }
    const preparations = await this.prisma.$queryRaw<Preparation[]>`SELECT p.* FROM "MarketingPreparation" p JOIN "MarketingAccountConfig" a ON a."id"=p."accountId" AND a."orgId"=p."orgId" WHERE p."orgId"=${orgId} AND (a."ownerId"=${actorId} OR ${actorId}=ANY(a."operators")) ORDER BY p."createdAt" DESC,p."id" DESC`;
    return { accounts: items, preparations, qa: process.env.ROOTOS_QA_PREVIEW === '1' };
  }
  async preparar(orgId: string, actorId: string, input: PrepareInput) {
    const fingerprint = editorialFingerprint(orgId, actorId, 'marketing.prepare', input);
    return this.run(orgId, actorId, EDIT, async (db) => {
      const a = await this.account(db, orgId, input.accountId, actorId);
      const old = (await db.$queryRaw<Preparation[]>`SELECT * FROM "MarketingPreparation" WHERE "orgId"=${orgId} AND "requestId"=${input.requestId}`)[0];
      if (old) { this.replay(old, actorId, fingerprint); return { preparation: old, replayed: true }; }
      const { valid } = await this.connection(db, orgId, a);
      if (!valid || a.revision !== input.expectedAccountRevision) throw new ConflictException('A conta mudou ou não está disponível para este preparo.');
      await this.editorial.conferirProducao(orgId, actorId, input, db);
      const currentAccount = await this.account(db, orgId, input.accountId, actorId);
      const currentConnection = await this.connection(db, orgId, currentAccount);
      if (!currentConnection.valid || currentAccount.revision !== input.expectedAccountRevision) throw new ConflictException('A conta mudou ou não está disponível para este preparo.');
      const when = new Date(input.scheduledAt);
      if (!(when.getTime() > Date.now())) throw new ConflictException('Escolha um horário futuro para o preparo.');
      const id = randomUUID();
      await db.$executeRaw`INSERT INTO "MarketingPreparation"("id","orgId","accountId","accountRevision","connectionId","externalId","handle","taskId","versionId","decisionId","contentHash","scheduledAt","timezone","requestId","actorId","fingerprint") VALUES (${id},${orgId},${a.id},${a.revision},${a.connectionId},${a.externalId},${a.handle},${input.taskId},${input.versionId},${input.decisionId},${input.contentHash},${when},${input.timezone},${input.requestId},${actorId},${fingerprint})`;
      await this.log(db, orgId, actorId, 'marketing.prepared', id, { taskId: input.taskId, accountId: a.id, connectionId: a.connectionId, versionId: input.versionId, decisionId: input.decisionId, scheduledAt: when.toISOString(), timezone: input.timezone, state: 'prepared', externalEffect: false });
      const preparation = (await db.$queryRaw<Preparation[]>`SELECT * FROM "MarketingPreparation" WHERE "id"=${id} AND "orgId"=${orgId}`)[0];
      return { preparation, replayed: false };
    });
  }
  async detalhe(orgId: string, actorId: string, id: string) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['pauta.ver']);
    const p = (await this.prisma.$queryRaw<Preparation[]>`SELECT * FROM "MarketingPreparation" WHERE "id"=${id} AND "orgId"=${orgId}`)[0];
    if (!p) throw new NotFoundException('Preparo não encontrado.');
    const a = await this.account(this.prisma as unknown as Db, orgId, p.accountId, actorId);
    const { valid } = await this.connection(this.prisma as unknown as Db, orgId, a);
    return { preparation: p, accountAvailable: valid, publicationAvailable: false, metricsAvailable: false };
  }
}
