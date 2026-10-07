import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { selectedWorkTasks } from '../work/selected-work-tasks';
import { WorkService } from '../work/work.service';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { RelatorioDeCustoIaService } from '../llm/relatorio-custo.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly svc: DashboardService,
    private readonly work: WorkService,
    private readonly custoIa: RelatorioDeCustoIaService,
  ) {}

  @Get('tarefas')
  @RequirePermissions('dashboard.ver', 'tarefas.ver')
  tarefas(@CurrentUser() user: JwtUser, @Query() raw: Record<string, unknown> = {}) {
    const query = selectedWorkTasks(user, raw);
    if (!query) throw new BadRequestException('Selecione uma lista');
    return this.work.tarefas(user.orgId, query);
  }

  @Get('summary')
  @RequirePermissions('dashboard.ver')
  summary(@CurrentUser() user: JwtUser, @Query() query: Record<string, unknown> = {}) {
    return this.svc.summary(user.orgId, selectedWorkTasks(user, query));
  }

  /**
   * O PAINEL DE CUSTO DE IA — por empresa, por agente e por dia (RF-B-03).
   *
   * `dashboard` já é prefixo de ESPINHA DO OS (`tenants/modulos.ts`), e é por
   * isso que a rota mora aqui e não num controlador próprio: custo de IA não é
   * módulo de negócio que se contrata à parte, e prefixo novo não declarado
   * falha em tempo de EXECUÇÃO, não só com teste vermelho.
   *
   * `dashboard.ver` é a mesma permissão do resumo do Console — a pílula de custo
   * vive no topo dele, e exigir permissão a mais deixaria a casca com um buraco
   * para metade dos perfis.
   *
   * `dias` chega como texto de query e vai cru para o serviço, que é quem sabe o
   * padrão (30) e o teto (90). Validar aqui duplicaria a regra em dois arquivos —
   * e o serviço já trata `NaN`, negativo e fracionário.
   *
   * A empresa vem do TOKEN (`user.orgId`), nunca da query: ela é também a que o
   * `ContextoInterceptor` pôs no contexto de execução, e o serviço RECUSA
   * responder se as duas discordarem (`RelatorioForaDoContextoError`).
   */
  @Get('custo-ia')
  @RequirePermissions('dashboard.ver')
  custoDeIa(@CurrentUser() user: JwtUser, @Query('dias') dias?: string) {
    return this.custoIa.relatorio(user.orgId, dias === undefined ? undefined : Number(dias));
  }
}
