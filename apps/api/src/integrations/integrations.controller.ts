import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ToggleIntegrationSchema } from '@mktos/shared';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

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
}
