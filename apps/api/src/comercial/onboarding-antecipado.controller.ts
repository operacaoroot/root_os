import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { EtapasDoOnboardingAntecipado, LeadElegivelAoOnboarding, OnboardingAntecipadoResposta } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SoGenteGuard } from './mover.service';
import { OnboardingAntecipadoService } from './onboarding-antecipado.service';

/*
 * "INICIAR ONBOARDING" ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026).
 *
 * A terceira porta da implantação, sempre a partir de um lead do funil. Iniciar
 * pede `leads.editar` e `tarefas.editar` (abre card no Trabalho) e é só de gente:
 * o `SoGenteGuard` do mover recusa conta de máquina pelo token, e o serviço relê a
 * pessoa no banco. A busca da Implantação e as etapas de entrada são leitura.
 * Ver o cabeçalho de `onboarding-antecipado.service.ts`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class OnboardingAntecipadoController {
  constructor(private readonly svc: OnboardingAntecipadoService) {}

  @Post('leads/:leadId/onboarding-antecipado')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.editar')
  @UseGuards(SoGenteGuard)
  iniciar(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown): Promise<OnboardingAntecipadoResposta> {
    return this.svc.iniciar(user.orgId, leadId, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] });
  }

  /** A busca da Implantação: só leads em andamento no funil, sem card e sem cliente ativo. */
  @Get('onboarding-antecipado/elegiveis')
  @RequirePermissions('leads.ver')
  elegiveis(@CurrentUser() user: JwtUser, @Query('q') q?: string): Promise<LeadElegivelAoOnboarding[]> {
    return this.svc.elegiveis(user.orgId, typeof q === 'string' ? q : undefined);
  }

  /** As etapas de entrada da lista de onboarding (a primeira e a de encerramento ficam de fora). */
  @Get('onboarding-antecipado/etapas')
  @RequirePermissions('leads.ver')
  etapas(@CurrentUser() user: JwtUser): Promise<EtapasDoOnboardingAntecipado> {
    return this.svc.etapas(user.orgId);
  }
}
