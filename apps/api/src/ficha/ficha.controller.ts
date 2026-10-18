import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { NovaReuniaoSchema, NovaTarefaDoClienteSchema, PassarNaJornadaSchema } from '@mktos/shared';
import { z } from 'zod';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/** Reuniões da ficha do cliente. Mora sob `trabalho/` porque a ficha é um cartão do Trabalho. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/fichas')
export class FichaController {
  constructor(
    private readonly svc: FichaService,
    private readonly jornadas: JornadaService,
    private readonly tarefas: TarefasDoClienteService,
  ) {}

  // ---- tarefas do cliente ----
  @Get(':taskId/tarefas')
  @RequirePermissions('tarefas.ver')
  listarTarefas(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.tarefas.listar(u.orgId, taskId);
  }

  @Post(':taskId/tarefas')
  @RequirePermissions('tarefas.editar')
  criarTarefa(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.tarefas.criar(u.orgId, taskId, NovaTarefaDoClienteSchema.parse(body));
  }

  @Post(':taskId/tarefas/rotina')
  @RequirePermissions('tarefas.editar')
  rotina(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    const { responsavel } = z.object({ responsavel: z.string().max(120).nullish() }).parse(body ?? {});
    return this.tarefas.rotina(u.orgId, taskId, responsavel);
  }

  @Post('tarefas/:id/alternar')
  @RequirePermissions('tarefas.editar')
  alternar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.tarefas.alternar(u.orgId, id);
  }

  /** O quadro de uma lista da jornada (`?lista=crm-root-onboarding`). */
  @Get('quadro')
  @RequirePermissions('tarefas.ver')
  quadro(@CurrentUser() u: JwtUser, @Query('lista') lista: string) {
    return this.jornadas.quadro(u.orgId, String(lista ?? ''));
  }

  @Get(':taskId/jornada')
  @RequirePermissions('tarefas.ver')
  jornada(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.jornadas.jornada(u.orgId, taskId);
  }

  @Post(':taskId/passar')
  @RequirePermissions('tarefas.editar')
  passar(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.jornadas.passar(u.orgId, taskId, PassarNaJornadaSchema.parse(body).destino);
  }

  @Get(':taskId/reunioes')
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.svc.listar(u.orgId, taskId);
  }

  @Get('reunioes/:id')
  @RequirePermissions('tarefas.ver')
  ler(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.ler(u.orgId, id);
  }

  @Post(':taskId/reunioes')
  @RequirePermissions('tarefas.editar')
  criar(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.svc.criar(u.orgId, u.sub, taskId, NovaReuniaoSchema.parse(body));
  }

  @Delete('reunioes/:id')
  @RequirePermissions('tarefas.editar')
  apagar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagar(u.orgId, id);
  }
}
