import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { CreateUserInput, RoleList, UpdateUserInput, UserList } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<UserList> {
    const rows = await this.prisma.user.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      include: { roles: { select: { key: true } } },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        roles: u.roles.map((r) => r.key),
      })),
      total: rows.length,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async roles(orgId: string): Promise<RoleList> {
    const rows = await this.prisma.role.findMany({
      where: { orgId },
      include: { permissions: { select: { key: true } }, _count: { select: { users: true } } },
    });
    return {
      items: rows.map((r) => ({
        key: r.key,
        name: r.name,
        permissions: r.permissions.map((p) => p.key).sort(),
        userCount: r._count.users,
      })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /** ids dos perfis do org a partir das keys (valida que todas existem). */
  private async roleIdsByKeys(orgId: string, keys: string[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { orgId, key: { in: keys } },
      select: { id: true, key: true },
    });
    const found = new Set(roles.map((r) => r.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) throw new BadRequestException(`Perfil(is) inexistente(s): ${missing.join(', ')}`);
    return roles.map((r) => r.id);
  }

  async create(orgId: string, input: CreateUserInput, actorId: string): Promise<{ id: string }> {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new BadRequestException('E-mail já cadastrado.');

    const roleIds = await this.roleIdsByKeys(orgId, input.roles);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        orgId,
        name: input.name,
        email: input.email,
        passwordHash,
        roles: { connect: roleIds.map((id) => ({ id })) },
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { name: input.name, email: input.email, roles: input.roles },
    });
    return { id: user.id };
  }

  async update(
    orgId: string,
    id: string,
    input: UpdateUserInput,
    actorId: string,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id, orgId },
      include: { roles: { select: { key: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    // trava de segurança: não desativar/rebaixar a própria conta
    if (id === actorId && input.isActive === false) {
      throw new ForbiddenException('Você não pode desativar a própria conta.');
    }

    const data: Record<string, unknown> = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.password) data.passwordHash = await bcrypt.hash(input.password, 10);
    if (input.roles) {
      const roleIds = await this.roleIdsByKeys(orgId, input.roles);
      data.roles = { set: roleIds.map((rid) => ({ id: rid })) };
    }

    await this.prisma.user.update({ where: { id }, data });
    await this.audit.log({
      orgId,
      actorId,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      before: { isActive: user.isActive, roles: user.roles.map((r) => r.key) },
      after: {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.roles ? { roles: input.roles } : {}),
        ...(input.password ? { passwordReset: true } : {}),
      },
    });
    return { ok: true };
  }
}
