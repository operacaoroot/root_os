import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TotemGestaoEventosQuerySchema, TotemGestaoResumoQuerySchema } from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { TotemGestaoService } from './totem-gestao.service';

/**
 * `/api/totem-gestao` — o painel da rede (frente A). Este controller tem o
 * resumo e os eventos; lojas, dispositivos e produtos ficam nos irmãos, sob o
 * mesmo prefixo. Toda `lojaId` passa pelo escopo do usuário no serviço.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoController {
  constructor(private readonly svc: TotemGestaoService) {}

  @Get('resumo')
  @RequirePermissions('totem.ver')
  resumo(@CurrentUser() u: JwtUser, @Query() query: unknown) {
    return this.svc.resumo(u, TotemGestaoResumoQuerySchema.parse(query).lojaId);
  }

  @Get('eventos')
  @RequirePermissions('totem.ver')
  eventos(@CurrentUser() u: JwtUser, @Query() query: unknown) {
    return this.svc.eventos(u, TotemGestaoEventosQuerySchema.parse(query));
  }
}
