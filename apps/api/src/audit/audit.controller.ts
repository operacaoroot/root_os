import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly svc: AuditService,
    private readonly eventos: EventLogService,
  ) {}

  /*
   * A cadeia do rastro, verificada de ponta a ponta. É o que transforma
   * "cadeia íntegra" de enfeite de tela em afirmação checável: um elo quebrado
   * devolve em qual sequência e por quê.
   */
  @Get('verificar')
  @RequirePermissions('auditoria.ver')
  verificar(@CurrentUser() user: JwtUser) {
    return this.eventos.verificar(user.orgId);
  }

  @Get()
  @RequirePermissions('auditoria.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actorType') actorType?: string,
  ) {
    return this.svc.list(user.orgId, {
      limit: limit ? Number(limit) : undefined,
      action,
      actorType,
    });
  }
}
