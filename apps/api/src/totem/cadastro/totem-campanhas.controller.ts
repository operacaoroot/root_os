import { Controller, Get, NotImplementedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';

/**
 * `/api/totem-campanhas` — campanhas, clientes, consentimentos e cupons no
 * painel (frente D). Corpo provisório da base; a frente D o substitui.
 */
@Controller('totem-campanhas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemCampanhasController {
  @Get()
  @RequirePermissions('totem.campanhas')
  listar(): never {
    throw new NotImplementedException('Em construção.');
  }
}
