import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  PautaDiaCivilSchema,
  PautaDistribuirSchema,
  PautaGradeSalvarSchema,
  PautaMarcarPostadaSchema,
  PautaReagendarSchema,
} from '@mktos/shared';
import { AgendaService } from './agenda.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MC16: o calendário da semana. Sub-rotas de `/pauta`, governadas pelo módulo
 * pauta. Nenhuma sai do OS: "postada" é o registro de quem postou à mão, e por
 * isso pede `pauta.publicar` — é quem responde pelo que foi ao ar.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('agenda')
  @RequirePermissions('pauta.ver')
  semana(@CurrentUser() user: JwtUser, @Query('de') de?: string) {
    return this.agenda.semana(user.orgId, de === undefined || de === '' ? undefined : PautaDiaCivilSchema.parse(de));
  }

  @Get('agenda/grade')
  @RequirePermissions('pauta.ver')
  grade(@CurrentUser() user: JwtUser) {
    return this.agenda.grade(user.orgId);
  }

  @Put('agenda/grade')
  @RequirePermissions('pauta.editar')
  salvarGrade(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.agenda.salvarGrade(user.orgId, user.sub, PautaGradeSalvarSchema.parse(body ?? {}));
  }

  @Post('episodios/:id/agenda/distribuir')
  @RequirePermissions('pauta.editar')
  distribuir(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.agenda.distribuir(user.orgId, id, user.sub, PautaDistribuirSchema.parse(body ?? {}));
  }

  @Put('pecas/:id/agenda')
  @RequirePermissions('pauta.editar')
  reagendar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.agenda.reagendar(user.orgId, id, user.sub, PautaReagendarSchema.parse(body ?? {}));
  }

  @Post('pecas/:id/postada')
  @RequirePermissions('pauta.publicar')
  postada(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.agenda.marcarPostada(user.orgId, id, user.sub, PautaMarcarPostadaSchema.parse(body ?? {}));
  }
}
