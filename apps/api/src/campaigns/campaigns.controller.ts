import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UpdateCampaignSchema } from '@mktos/shared';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';

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

  @Patch(':id')
  @RequirePermissions('campanhas.editar')
  @SensitiveWrite('campaign')
  @UseGuards(ApprovalGuard)
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateCampaignSchema.parse(body);
    return this.svc.update(user.orgId, id, input, user.sub);
  }
}
