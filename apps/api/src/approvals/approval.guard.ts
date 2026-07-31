import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApprovalsService, isResourceType } from './approvals.service';
import { SENSITIVE_WRITE_KEY } from './sensitive-write.decorator';

// Roda DEPOIS de JwtAuthGuard + PermissionsGuard (nível de rota). Só libera a
// escrita se houver uma aprovação humana confirmada, single-use, casando o
// recurso e a mudança exata. Move o gate da UI para o backend.
@Injectable()
export class ApprovalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly approvals: ApprovalsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const resourceType = this.reflector.getAllAndOverride<string>(SENSITIVE_WRITE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!resourceType || !isResourceType(resourceType)) return true; // rota não sensível

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    const token = req.headers['x-approval-token'] as string | undefined;

    await this.approvals.consumeForWrite({
      orgId: user.orgId,
      token,
      resourceType,
      resourceId: req.params.id,
      body: req.body ?? {},
      actorId: user.sub,
    });
    return true;
  }
}
