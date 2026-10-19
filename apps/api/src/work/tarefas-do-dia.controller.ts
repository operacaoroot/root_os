import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AreaDeTarefaCriarSchema, ClienteDaTarefaCriarSchema, TarefaDoDiaCriarSchema, TarefaDoDiaEditarSchema, TarefasReordenarSchema } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { TarefasDoDiaService } from './tarefas-do-dia.service';

const AlternarSchema = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict();

/** Dia a dia › Tarefas: todas as tarefas de todas as áreas, sem card repetido. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/todas')
export class TarefasDoDiaController {
  constructor(private readonly svc: TarefasDoDiaService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  painel(@CurrentUser() u: JwtUser) {
    return this.svc.painel(u.orgId);
  }

  @Get('areas')
  @RequirePermissions('tarefas.ver')
  areas(@CurrentUser() u: JwtUser) {
    return this.svc.areas(u.orgId);
  }

  @Post('areas')
  @RequirePermissions('tarefas.editar')
  criarArea(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarArea(u.orgId, u.sub, AreaDeTarefaCriarSchema.parse(body));
  }

  @Post()
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criar(u.orgId, u.sub, TarefaDoDiaCriarSchema.parse(body));
  }

  @Post('clientes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  criarCliente(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarCliente(u.orgId, u.sub, ClienteDaTarefaCriarSchema.parse(body).nome);
  }

  @Post('ordem')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  reordenar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.reordenar(u.orgId, u.sub, TarefasReordenarSchema.parse(body).ids);
  }

  @Patch(':id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  editar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editar(u.orgId, u.sub, id, TarefaDoDiaEditarSchema.parse(body));
  }

  @Post(':id/feita')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  alternar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.alternarFeita(u.orgId, u.sub, id, AlternarSchema.parse(body).expectedUpdatedAt);
  }
}
