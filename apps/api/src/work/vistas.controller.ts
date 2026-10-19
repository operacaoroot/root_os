import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { VistaAlterarSchema, VistaCriarSchema } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { VistasService } from './vistas.service';

/*
 * AS VISTAS SALVAS (rodada do trabalho T3, 19/10/2026): a preferência de ver de
 * cada pessoa, no servidor. Ler as tarefas basta (`tarefas.ver`): a vista não
 * muda tarefa nenhuma, e cada pessoa só alcança as suas.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/vistas')
export class VistasController {
  constructor(private readonly vistas: VistasService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() u: JwtUser, @Query('tela') tela: unknown) {
    return this.vistas.listar(u.orgId, u.sub, this.vistas.telaValida(tela));
  }

  @Post()
  @RequirePermissions('tarefas.ver')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.vistas.criar(u.orgId, u.sub, VistaCriarSchema.parse(body));
  }

  @Patch(':id')
  @RequirePermissions('tarefas.ver')
  alterar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.vistas.alterar(u.orgId, u.sub, id, VistaAlterarSchema.parse(body ?? {}));
  }

  @Delete(':id')
  @RequirePermissions('tarefas.ver')
  remover(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.vistas.remover(u.orgId, u.sub, id);
  }
}
