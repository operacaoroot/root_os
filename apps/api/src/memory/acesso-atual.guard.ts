import { randomUUID } from 'node:crypto';
import { comContexto } from '../common/contexto-execucao';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { exigirAcessoAtual } from './acesso-memoria';

@Injectable()
export class AcessoAtualGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const user = ctx.switchToHttp().getRequest().user;
    await comContexto({ orgId: user?.orgId, actorType: 'user', actorId: user?.sub, correlationId: randomUUID(), origem: 'http' },
      () => exigirAcessoAtual(this.prisma, user?.orgId, user?.sub, required));
    return true;
  }
}
