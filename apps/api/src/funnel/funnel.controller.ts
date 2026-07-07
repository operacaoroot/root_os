import { Controller, Get, UseGuards } from '@nestjs/common';
import { FunnelService } from './funnel.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('funnel')
export class FunnelController {
  constructor(private readonly svc: FunnelService) {}

  @Get('metrics')
  @RequirePermissions('dashboard.ver')
  metrics(@CurrentUser() user: JwtUser) {
    return this.svc.metrics(user.orgId);
  }
}
