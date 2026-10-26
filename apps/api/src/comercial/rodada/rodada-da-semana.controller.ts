import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RodadaDaSemanaService } from './rodada-da-semana.service';

/*
 * Layout 26/10: `GET /comercial/rodada-da-semana` (`leads.ver`), a tela Comercial ›
 * Rodada da semana. `?semana=AAAA-MM-DD` (qualquer dia da semana pedida; sem ele, a
 * semana de agora). Só leitura, só a empresa da sessão. Prefixo `comercial`: o gate
 * de módulos é o de `leads`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/rodada-da-semana')
export class RodadaDaSemanaController {
  constructor(private readonly svc: RodadaDaSemanaService) {}

  @Get()
  @RequirePermissions('leads.ver')
  rodada(@CurrentUser() u: JwtUser, @Query('semana') semana?: string) {
    return this.svc.rodada(u.orgId, u.sub, semana);
  }
}
