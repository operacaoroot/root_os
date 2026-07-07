import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ToggleIntegrationSchema } from '@mktos/shared';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly clickup: ClickupService,
  ) {}

  @Get('catalog')
  @RequirePermissions('dashboard.ver')
  catalog(@CurrentUser() user: JwtUser) {
    return this.svc.catalog(user.orgId);
  }

  // Ligar/desligar manualmente um conector (só os com credencial via env/API key).
  // Gerência de integrações é ação de admin.
  @Put(':key')
  @RequirePermissions('admin.usuarios')
  toggle(@CurrentUser() user: JwtUser, @Param('key') key: string, @Body() body: unknown) {
    const input = ToggleIntegrationSchema.parse(body);
    return this.svc.toggle(user.orgId, key, input.status, user.sub);
  }

  // Sincroniza as tarefas reais do ClickUp → módulo Tarefas.
  @Post('clickup/sync')
  @RequirePermissions('tarefas.editar')
  syncClickup(@CurrentUser() user: JwtUser) {
    return this.clickup.sync(user.orgId, user.sub);
  }
}
