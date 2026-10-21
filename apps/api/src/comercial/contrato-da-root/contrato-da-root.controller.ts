import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { LaudoDoContrato, MinutaDoContratoNaTela } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { SoGenteGuard } from '../mover.service';
import { ContratoDaRootService } from './contrato-da-root.service';

/*
 * O CONTRATO DA ROOT NA FICHA DO LEAD (rodada dos agentes, 21/10/2026, CO-13 e CO-14).
 *
 *   GET  /comercial/lead/:id/minuta          a minuta mais recente e o laudo (leads.ver)
 *   POST /comercial/lead/:id/minuta          redige a minuta do contrato (leads.editar, só gente)
 *   POST /comercial/lead/:id/minuta/revisar  revisa a minuta mais recente (leads.editar, só gente)
 *
 * Gerar e revisar gastam modelo (Opus 5.5) e leem o Drive da Root em nome de
 * quem clicou: conta de máquina não chega aqui (`SoGenteGuard`, o mesmo do mover).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class ContratoDaRootController {
  constructor(private readonly svc: ContratoDaRootService) {}

  @Get('lead/:id/minuta')
  @RequirePermissions('leads.ver')
  minuta(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<MinutaDoContratoNaTela | null> {
    return this.svc.doLead(user.orgId, id);
  }

  @Post('lead/:id/minuta')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  gerar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<MinutaDoContratoNaTela> {
    return this.svc.gerar(user.orgId, id, { id: user.sub, nome: user.name ?? null });
  }

  @Post('lead/:id/minuta/revisar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  revisar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<LaudoDoContrato> {
    return this.svc.revisar(user.orgId, id);
  }
}
