import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { selectedWorkTasks } from '../work/selected-work-tasks';
import { WorkService } from '../work/work.service';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly work: WorkService) {}

  // Gera um novo resumo diário (chama a IA). Exige permissão de gerar relatório.
  @Post('daily/generate')
  @RequirePermissions('relatorios.gerar')
  generateDaily(@CurrentUser() user: JwtUser, @Query() query: Record<string, unknown> = {}) {
    return this.svc.generateDaily(user.orgId, selectedWorkTasks(user, query));
  }

  @Get('tarefas')
  @RequirePermissions('relatorios.ver', 'tarefas.ver')
  tarefas(@CurrentUser() user: JwtUser, @Query() raw: Record<string, unknown> = {}) {
    const query = selectedWorkTasks(user, raw);
    if (!query) throw new BadRequestException('Selecione uma lista');
    return this.work.tarefas(user.orgId, query);
  }

  @Get('daily/latest')
  @RequirePermissions('relatorios.ver')
  async latest(@CurrentUser() user: JwtUser) {
    return { report: await this.svc.latest(user.orgId, user.permissions.includes('tarefas.ver')) };
  }

  @Get('daily')
  @RequirePermissions('relatorios.ver')
  list(@CurrentUser() user: JwtUser, @Query('limit') limit?: string) {
    return this.svc.list(user.orgId, limit ? Number(limit) : 30, user.permissions.includes('tarefas.ver'));
  }
}
