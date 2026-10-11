import { Controller, Get, NotImplementedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';

/**
 * `/api/totem-gestao` — o painel da rede (frente A).
 *
 * A base deixa só o resumo, com a guarda completa e o corpo "em construção":
 * o prefixo precisa existir no código para o gate de módulos (`modulos.ts`) e o
 * smoke do arranque. A frente A substitui o corpo e acrescenta as rotas.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoController {
  @Get('resumo')
  @RequirePermissions('totem.ver')
  resumo(): never {
    throw new NotImplementedException('Em construção.');
  }
}
