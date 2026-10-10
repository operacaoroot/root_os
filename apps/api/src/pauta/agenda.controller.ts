import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  PAUTA_AUTOMACOES,
  PautaAutomacaoSalvarHumanoSchema,
  PautaDiaCivilSchema,
  type PautaAutomacao,
  PautaDistribuirSchema,
  PautaGradeSalvarHumanoSchema,
  PautaMarcarPostadaSchema,
  PautaReagendarSchema,
} from '@mktos/shared';
import { AgendaService } from './agenda.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
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
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  grade(@CurrentUser() user: JwtUser) {
    return this.agenda.gradeHumana(user.orgId, user.sub);
  }

  @Put('agenda/grade')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  salvarGrade(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.agenda.salvarGradeHumano(user.orgId, user.sub, PautaGradeSalvarHumanoSchema.parse(body ?? {}));
  }

  @Get('automacao/:qual')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  automacao(@CurrentUser() user: JwtUser, @Param('qual') qual: string) {
    if (!(PAUTA_AUTOMACOES as readonly string[]).includes(qual)) throw new NotFoundException('Interruptor desconhecido: é publicacao ou dm.');
    return this.agenda.automacaoHumana(user.orgId, user.sub, qual as PautaAutomacao);
  }

  /** D-MD1: liga ou desliga a publicação ou a DM automática da empresa (a nota da memória), com motivo. */
  @Put('automacao/:qual')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.publicar', 'obsidian.ver')
  ligarAutomacao(@CurrentUser() user: JwtUser, @Param('qual') qual: string, @Body() body: unknown) {
    if (!(PAUTA_AUTOMACOES as readonly string[]).includes(qual)) throw new NotFoundException('Interruptor desconhecido: é publicacao ou dm.');
    return this.agenda.ligarAutomacaoHumano(user.orgId, user.sub, qual as PautaAutomacao, PautaAutomacaoSalvarHumanoSchema.parse(body ?? {}));
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
