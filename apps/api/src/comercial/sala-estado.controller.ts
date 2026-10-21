import { Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SalaEstadoService, SoGenteNaSalaGuard } from './sala-estado.service';

/*
 * A ABA SALA DO PAINEL DO LEAD: quando a sala entra (rodada de produção 1, P9).
 *
 * Um controlador próprio, no mesmo prefixo `comercial` (o gate de módulos é o
 * do comercial), para não mexer no construtor do `ComercialController`, que a
 * suíte monta à mão.
 *   · `GET  /comercial/lead/:id/sala/estado` (`leads.ver`): a linha do tempo,
 *     sem o link em claro;
 *   · `POST /comercial/lead/:id/sala/link` (`leads.editar`, só gente): o link,
 *     com auditoria `sala.link.copiado`. `no-store`: nenhum intermediário guarda
 *     a resposta.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class SalaEstadoController {
  constructor(private readonly estados: SalaEstadoService) {}

  @Get('lead/:id/sala/estado')
  @RequirePermissions('leads.ver')
  estado(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.estado(user.orgId, id);
  }

  @Post('lead/:id/sala/link')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNaSalaGuard)
  copiarLink(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.copiarLink(user.orgId, id, { id: user.sub, papeis: user.roles ?? [] });
  }
}
