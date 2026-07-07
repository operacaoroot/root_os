import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { permissions: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');

    const permissions = Array.from(
      new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.key))),
    );
    const roles = user.roles.map((r) => r.key);
    const payload = {
      sub: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      roles,
      permissions,
    };
    const token = await this.jwt.signAsync(payload);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      orgId: user.orgId,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      ip,
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, roles, permissions },
    };
  }
}
