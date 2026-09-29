import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PautaMesSchema } from '@mktos/shared';
import { PerformanceService } from './performance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK5: a performance da casa. Sub-rota de `/pauta`, governada pelo módulo pauta.
// Coletar é `pauta.editar` + `automacoes.executar` como as outras chamadas que
// saem do OS: ela fala com a Graph pela porta, e quem pode olhar não é
// necessariamente quem pode gastar a chamada.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get(':mes')
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.performance.painel(user.orgId, PautaMesSchema.parse(mes));
  }

  @Post(':mes/coletar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  coletar(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.performance.coletar(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }
}
