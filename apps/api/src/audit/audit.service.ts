import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import type { AuditList } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  orgId: string;
  actorType?: ActorType;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput, db: Pick<Prisma.TransactionClient, 'auditLog'> = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        orgId: input.orgId,
        actorType: input.actorType ?? ActorType.user,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before,
        after: input.after,
        ip: input.ip,
        metadata: input.metadata,
      },
    });
  }

  async list(
    orgId: string,
    filter: { limit?: number; action?: string; actorType?: string } = {},
  ): Promise<AuditList> {
    const take = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const where: Prisma.AuditLogWhereInput = { orgId };
    if (filter.action) where.action = { contains: filter.action };
    if (filter.actorType && ['user', 'ai', 'system'].includes(filter.actorType)) {
      where.actorType = filter.actorType as ActorType;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.auditLog.count({ where }),
    ]);

    // resolve nome dos atores do tipo `user` num único query
    const userIds = [
      ...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!)),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        actorType: r.actorType,
        actorName:
          r.actorType === 'user'
            ? (r.actorId ? (nameById.get(r.actorId) ?? r.actorId) : null)
            : r.actorType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
