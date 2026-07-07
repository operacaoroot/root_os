import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UpdateLeadSchema } from '@mktos/shared';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly svc: LeadsService) {}

  @Get()
  @RequirePermissions('leads.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: string,
    @Query('period') period?: string,
  ) {
    return this.svc.list(user.orgId, { status, period });
  }

  @Get(':id')
  @RequirePermissions('leads.ver')
  getOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.getOne(user.orgId, id);
  }

  @Patch(':id')
  @RequirePermissions('leads.editar')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateLeadSchema.parse(body);
    return this.svc.update(user.orgId, id, input, user.sub);
  }
}
