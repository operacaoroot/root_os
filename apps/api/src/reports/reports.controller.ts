import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  // Gera um novo resumo diário (chama a IA). Exige permissão de gerar relatório.
  @Post('daily/generate')
  @RequirePermissions('relatorios.gerar')
  generateDaily(@CurrentUser() user: JwtUser) {
    return this.svc.generateDaily(user.orgId);
  }

  @Get('daily/latest')
  @RequirePermissions('relatorios.ver')
  async latest(@CurrentUser() user: JwtUser) {
    return { report: await this.svc.latest(user.orgId) };
  }

  @Get('daily')
  @RequirePermissions('relatorios.ver')
  list(@CurrentUser() user: JwtUser, @Query('limit') limit?: string) {
    return this.svc.list(user.orgId, limit ? Number(limit) : 30);
  }
}
