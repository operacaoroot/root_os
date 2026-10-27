import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { FichaGeralService } from './ficha-geral.service';
import { SoGenteGuard } from './mover.service';

/*
 * A FICHA GERAL E AS PENDÊNCIAS DO LEAD (leva 5, L4, 27/10/2026). Um controlador
 * próprio no prefixo `comercial` (o gate de módulos é o de `leads`), para não
 * mexer no construtor do `ComercialController`, que a suíte monta à mão.
 *
 *   · `GET   /comercial/lead/:id/geral`      (`leads.ver`): o que a aba Geral lê a mais da ficha;
 *   · `PATCH /comercial/lead/:id/ficha`      (`leads.editar`, só gente): edita a ficha geral, auditado;
 *   · `GET   /comercial/lead/:id/pendencias` (`leads.ver`): os próximos passos da aba Pendências;
 *   · `POST  /comercial/lead/:id/fio/nota`   (`leads.editar`, só gente): a nota manual no fio ("marcar como feito").
 *
 * A etapa continua em `POST /comercial/lead/:id/mover`; o telefone, em
 * `PUT /whatsapp/vinculos/lead/:id/telefone`. Nenhuma permissão nova.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/lead')
export class FichaGeralController {
  constructor(private readonly svc: FichaGeralService) {}

  @Get(':id/geral')
  @RequirePermissions('leads.ver')
  geral(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.extra(user.orgId, id);
  }

  @Patch(':id/ficha')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard, AcessoAtualGuard)
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editar(user.orgId, id, body, quem(user));
  }

  @Get(':id/pendencias')
  @RequirePermissions('leads.ver')
  pendencias(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.pendencias(user.orgId, id);
  }

  @Post(':id/fio/nota')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard, AcessoAtualGuard)
  nota(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.nota(user.orgId, id, body, quem(user));
  }
}

function quem(user: JwtUser) {
  return { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] };
}
