import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { GoalWeekSchema, MetasDoMesSalvarSchema, PautaMesSchema } from '@mktos/shared';
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

  // Metas do mês (ROOT-53a, C-12): o alvo é nota da memória por mês e o número
  // sai das fontes, por semana. Ler é `dashboard.ver`, como o painel do desafio;
  // escrever é `relatorios.gerar`, como `saveWeek`. Cada número herda a permissão
  // da fonte (o serviço decide, com as permissões de quem pediu).
  @Get('month/:mes')
  @RequirePermissions('dashboard.ver')
  metasDoMes(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.svc.metasDoMes(user.orgId, PautaMesSchema.parse(mes), user.permissions ?? []);
  }

  @Put('month/:mes')
  @RequirePermissions('relatorios.gerar')
  salvarMetasDoMes(@CurrentUser() user: JwtUser, @Param('mes') mes: string, @Body() body: unknown) {
    return this.svc.salvarMetasDoMes(
      user.orgId,
      user.sub,
      PautaMesSchema.parse(mes),
      MetasDoMesSalvarSchema.parse(body ?? {}),
      user.permissions ?? [],
    );
  }

  @Post('config')
  @RequirePermissions('relatorios.gerar')
  config(@CurrentUser() user: JwtUser, @Body() body: { challengeStart?: string }) {
    return this.svc.setConfig(user.orgId, body?.challengeStart);
  }
}
