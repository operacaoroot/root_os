import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { ConfigOverview } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(orgId: string): Promise<ConfigOverview> {
    const [org, users, roles, integrations] = await Promise.all([
      this.prisma.org.findUniqueOrThrow({ where: { id: orgId } }),
      this.prisma.user.count({ where: { orgId } }),
      this.prisma.role.count({ where: { orgId } }),
      this.prisma.integrationAccount.findMany({
        where: { orgId },
        include: { health: true },
        orderBy: { label: 'asc' },
      }),
    ]);

    return {
      org: { name: org.name, slug: org.slug },
      appName: process.env.APP_NAME ?? 'Marketing OS',
      counts: { users, roles },
      integrations: integrations.map((i) => ({
        key: i.key,
        label: i.label,
        status: i.status,
        health: i.health?.status ?? null,
        lastSyncAt: i.health?.lastSyncAt?.toISOString() ?? null,
        lastError: i.health?.lastError ?? null,
      })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async changePassword(
    userId: string,
    orgId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta.');
    if (currentPassword === newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'user.password_change',
      entityType: 'user',
      entityId: userId,
    });
    return { ok: true };
  }
}
