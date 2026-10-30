import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EfeitosDaCentralService } from './efeitos-da-central.service';
import { CorpoExternoService } from './corpo-externo.service';

/*
 * Criar e revogar o token do corpo de um agente é a chave do freio dos agentes
 * e dos conectores: `admin.usuarios` sozinha (hoje só o `admin_master`).
 */
const COMANDAR_AGENTE = ['admin.usuarios'] as const;

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
  constructor(
    private readonly central: EfeitosDaCentralService,
    private readonly corpo: CorpoExternoService,
  ) {}

  /** A4 — os corpos do agente (sem o hash; o token em claro só sai ao criar). */
  @Get('agents/:slug/corpos')
  @RequirePermissions(...COMANDAR_AGENTE)
  corpos(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.corpo.listar(user.orgId, slug);
  }

  /** A4 — cria o corpo e devolve o token UMA vez. */
  @Post('agents/:slug/corpos')
  @RequirePermissions(...COMANDAR_AGENTE)
  criarCorpo(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.corpo.criar(user.orgId, user.sub, slug, body);
  }

  /** A4 — revoga, com motivo. A linha fica, para a auditoria. */
  @Post('agents/:slug/corpos/:corpoId/revogar')
  @HttpCode(200)
  @RequirePermissions(...COMANDAR_AGENTE)
  revogarCorpo(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('corpoId') corpoId: string, @Body() body: unknown) {
    return this.corpo.revogar(user.orgId, user.sub, slug, corpoId, body);
  }

  @Get('agents/:slug/ultima-passagem')
  @RequirePermissions('mcp.ver')
  ultimaPassagem(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.central.ultimaPassagem(user.orgId, slug);
  }
}
