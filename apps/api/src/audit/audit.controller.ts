import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly svc: AuditService) {}

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
