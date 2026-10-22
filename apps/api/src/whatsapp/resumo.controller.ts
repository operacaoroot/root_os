import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ResumoDoWhatsapp } from '@mktos/shared';

import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ResumoDoWhatsappService } from './resumo.service';

/**
 * Rotas `/whatsapp/resumo` (produção 22C, W4, lane D): o cartão "WhatsApp" do Dia
 * a dia e a bolha do menu. Só leitura, da empresa do token, com `leads.ver` (a
 * mesma permissão do item WhatsApp no menu). O módulo `leads` governa o prefixo.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/resumo')
export class ResumoDoWhatsappController {
  constructor(private readonly resumo: ResumoDoWhatsappService) {}

  @Get()
  @RequirePermissions('leads.ver')
  ler(@CurrentUser() u: JwtUser): Promise<ResumoDoWhatsapp> {
    return this.resumo.doResumo(u.orgId);
  }
}
