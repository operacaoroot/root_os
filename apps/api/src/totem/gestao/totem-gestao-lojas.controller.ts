import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  TotemGestaoIdSchema,
  TotemGestaoLojaCriarSchema,
  TotemGestaoLojaEditarSchema,
  TotemGestaoLojasQuerySchema,
  TotemGestaoVinculoSchema,
} from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { TotemGestaoService } from './totem-gestao.service';

/**
 * Lojas e vínculos de usuário com loja. Ver a lista é de quem vê o painel
 * (`totem.ver`), porque todas as telas filtram por loja; mexer é de
 * `totem.lojas`. Desativar é o PATCH com `ativa: false`: loja não se apaga,
 * porque lote, remessa e evento apontam para ela.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoLojasController {
  constructor(private readonly svc: TotemGestaoService) {}

  @Get('lojas')
  @RequirePermissions('totem.ver')
  lojas(@CurrentUser() u: JwtUser, @Query() query: unknown) {
    return this.svc.lojas(u, TotemGestaoLojasQuerySchema.parse(query).situacao);
  }

  @Post('lojas')
  @RequirePermissions('totem.lojas')
  criarLoja(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarLoja(u, TotemGestaoLojaCriarSchema.parse(body));
  }

  @Patch('lojas/:id')
  @RequirePermissions('totem.lojas')
  editarLoja(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarLoja(u, TotemGestaoIdSchema.parse(id), TotemGestaoLojaEditarSchema.parse(body));
  }

  @Get('usuarios')
  @RequirePermissions('totem.lojas')
  usuarios(@CurrentUser() u: JwtUser) {
    return this.svc.usuarios(u);
  }

  @Post('usuarios/:id/lojas')
  @RequirePermissions('totem.lojas')
  vincular(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.vincular(u, TotemGestaoIdSchema.parse(id), TotemGestaoVinculoSchema.parse(body).lojaId);
  }

  @Delete('usuarios/:id/lojas/:lojaId')
  @RequirePermissions('totem.lojas')
  desvincular(@CurrentUser() u: JwtUser, @Param('id') id: string, @Param('lojaId') lojaId: string) {
    return this.svc.desvincular(u, TotemGestaoIdSchema.parse(id), TotemGestaoIdSchema.parse(lojaId));
  }
}
