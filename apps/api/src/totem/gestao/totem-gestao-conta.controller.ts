import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ChangePasswordSchema } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { ConfigService } from '../../config/config.service';

/**
 * A troca da própria senha para quem só tem papel do Totem. A rota da ROOT
 * (`POST /config/password`) pede `dashboard.ver`, que nenhum papel do Totem
 * tem; esta pede `totem.ver` e faz a mesma troca, com a senha atual conferida
 * e o registro na auditoria.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoContaController {
  constructor(private readonly config: ConfigService) {}

  @Post('minha-conta/senha')
  @HttpCode(200)
  @RequirePermissions('totem.ver')
  trocarSenha(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const entrada = ChangePasswordSchema.parse(body);
    return this.config.changePassword(user.sub, user.orgId, entrada.currentPassword, entrada.newPassword);
  }
}
