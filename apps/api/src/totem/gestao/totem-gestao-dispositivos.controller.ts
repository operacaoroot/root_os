import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  TotemGestaoDispositivoCriarSchema,
  TotemGestaoDispositivoRenomearSchema,
  TotemGestaoDispositivosQuerySchema,
  TotemGestaoIdSchema,
} from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { TotemGestaoService } from './totem-gestao.service';

/**
 * Os totens das lojas. Criar e gerar código novo devolvem o código de ativação
 * em claro uma única vez; nenhuma outra resposta o repete.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoDispositivosController {
  constructor(private readonly svc: TotemGestaoService) {}

  @Get('dispositivos')
  @RequirePermissions('totem.dispositivos')
  dispositivos(@CurrentUser() u: JwtUser, @Query() query: unknown) {
    return this.svc.dispositivos(u, TotemGestaoDispositivosQuerySchema.parse(query).lojaId);
  }

  @Post('dispositivos')
  @RequirePermissions('totem.dispositivos')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarDispositivo(u, TotemGestaoDispositivoCriarSchema.parse(body));
  }

  @Post('dispositivos/:id/codigo')
  @RequirePermissions('totem.dispositivos')
  novoCodigo(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.novoCodigo(u, TotemGestaoIdSchema.parse(id));
  }

  @Patch('dispositivos/:id')
  @RequirePermissions('totem.dispositivos')
  renomear(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.renomearDispositivo(
      u,
      TotemGestaoIdSchema.parse(id),
      TotemGestaoDispositivoRenomearSchema.parse(body).nome,
    );
  }

  @Post('dispositivos/:id/revogar')
  @RequirePermissions('totem.dispositivos')
  revogar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.revogarDispositivo(u, TotemGestaoIdSchema.parse(id));
  }
}
