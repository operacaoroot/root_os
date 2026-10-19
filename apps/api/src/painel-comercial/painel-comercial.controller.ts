import { Controller, Get, UseGuards } from '@nestjs/common';
import { PainelComercialService } from './painel-comercial.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class PainelComercialController {
  constructor(private readonly svc: PainelComercialService) {}

  @Get('painel')
  @RequirePermissions('leads.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.svc.painel(user.orgId);
  }
}
