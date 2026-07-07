import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  @RequirePermissions('campanhas.ver')
  list(@CurrentUser() user: JwtUser, @Query('status') status?: string) {
    return this.svc.list(user.orgId, status);
  }

  @Get(':id')
  @RequirePermissions('campanhas.ver')
  dossier(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.dossier(user.orgId, id);
  }
}
