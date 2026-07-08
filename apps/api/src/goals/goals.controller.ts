import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GoalWeekSchema } from '@mktos/shared';
import { GoalsService } from './goals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly svc: GoalsService) {}

  @Get('panel')
  @RequirePermissions('dashboard.ver')
  panel(@CurrentUser() user: JwtUser) {
    return this.svc.panel(user.orgId);
  }

  @Get('weeks')
  @RequirePermissions('dashboard.ver')
  weeks(@CurrentUser() user: JwtUser) {
    return this.svc.weeks(user.orgId);
  }

  @Post('week')
  @RequirePermissions('relatorios.gerar')
  saveWeek(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = GoalWeekSchema.parse(body);
    return this.svc.saveWeek(user.orgId, input, user.sub);
  }

  // Alinha a semana aos dados do Instagram (Meta).
  @Post('week/:n/sync-meta')
  @RequirePermissions('relatorios.gerar')
  syncMeta(@CurrentUser() user: JwtUser, @Param('n') n: string) {
    return this.svc.syncFromMeta(user.orgId, Number(n), user.sub);
  }

  @Post('config')
  @RequirePermissions('relatorios.gerar')
  config(@CurrentUser() user: JwtUser, @Body() body: { challengeStart?: string }) {
    return this.svc.setConfig(user.orgId, body?.challengeStart);
  }
}
