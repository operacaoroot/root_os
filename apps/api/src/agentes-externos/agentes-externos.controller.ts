import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EfeitosDaCentralService } from './efeitos-da-central.service';

/*
 * AS ROTAS DA CENTRAL PARA QUEM ESTÁ FORA DO LAÇO (política 1.13.0).
 *
 * `GET /agents/:slug/ultima-passagem` é a leitura que implementa `briefing.ler`
 * (a rota do catálogo é a desta rota com `briefing-diario` no lugar do slug):
 * a última passagem RESPONDIDA de um agente, para quem quer o resumo da manhã
 * sem acordar o agente de novo. `mcp.ver`, a mesma chave das outras leituras de
 * agente — ler não faz nada acontecer.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AgentesExternosController {
  constructor(private readonly central: EfeitosDaCentralService) {}

  @Get('agents/:slug/ultima-passagem')
  @RequirePermissions('mcp.ver')
  ultimaPassagem(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.central.ultimaPassagem(user.orgId, slug);
  }
}
