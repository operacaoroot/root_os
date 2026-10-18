import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NovaReuniaoSchema } from '@mktos/shared';
import { FichaService } from './ficha.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/** Reuniões da ficha do cliente. Mora sob `trabalho/` porque a ficha é um cartão do Trabalho. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/fichas')
export class FichaController {
  constructor(private readonly svc: FichaService) {}

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
