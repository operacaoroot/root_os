import { Controller, Get, NotImplementedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';

/**
 * `/api/totem-lotes` — lotes, remessas, reposições e etiquetas no painel
 * (frente C). Corpo provisório da base; a frente C o substitui.
 */
@Controller('totem-lotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemLotesController {
  @Get('pendencias')
  @RequirePermissions('totem.ver')
  pendencias(): never {
    throw new NotImplementedException('Em construção.');
  }
}
