import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PendenciasQuerySchema, ResponderPendenciaSchema, type Pendencia } from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { temPapelDeMaquina } from '../approvals/alcada';
import { PendenciasService, RECUSA_DE_MAQUINA_NA_PENDENCIA } from './pendencias.service';

/**
 * `GET /api/pendencias`, `POST /api/pendencias/:id/responder` e
 * `POST /api/pendencias/:id/descartar` (rodada dos agentes, Lane 0).
 *
 * Mesma permissão da caixa (`dashboard.ver`, que todo perfil de gente tem):
 * quem vê a caixa vê o que espera por ela. Responder e descartar são de gente,
 * pelo token aqui e pelo banco no serviço. O que a resposta FAZ é do tratador
 * do tipo, e o que sai do OS passa pela porta dele.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pendencias')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Get()
  @RequirePermissions('dashboard.ver')
  listar(@CurrentUser() user: JwtUser, @Query() q: Record<string, string>): Promise<Pendencia[]> {
    const filtro = PendenciasQuerySchema.parse(q);
    return this.pendencias.listar(user.orgId, user.sub, filtro);
  }

  @Post(':id/responder')
  @HttpCode(200)
  @RequirePermissions('dashboard.ver')
  responder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() corpo: unknown): Promise<{ ok: true }> {
    soGente(user);
    const r = ResponderPendenciaSchema.parse(corpo);
    return this.pendencias.responder(user.orgId, id, user.sub, r.escolha, r.complemento);
  }

  @Post(':id/descartar')
  @HttpCode(200)
  @RequirePermissions('dashboard.ver')
  descartar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ ok: true }> {
    soGente(user);
    return this.pendencias.descartar(user.orgId, id, user.sub);
  }
}

function soGente(user: JwtUser): void {
  if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_PENDENCIA);
}
