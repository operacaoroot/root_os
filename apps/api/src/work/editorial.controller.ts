import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EditorialService } from './editorial.service';

/** P10: a versão pertence ao card; as permissões existentes seguem valendo. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/tarefas/:taskId/artefatos')
export class EditorialController {
  constructor(private readonly editorial: EditorialService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string) {
    return this.editorial.listar(user.orgId, taskId);
  }

  @Post()
  @RequirePermissions('tarefas.editar')
  criar(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.editorial.criarArtefato(user.orgId, taskId, body);
  }

  @Get(':artifactId/versoes/:numero')
  @RequirePermissions('tarefas.ver')
  lerVersao(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string,
    @Param('artifactId') artifactId: string, @Param('numero') numero: string) {
    return this.editorial.lerVersao(user.orgId, taskId, artifactId, Number(numero));
  }

  @Post(':artifactId/versoes')
  @RequirePermissions('tarefas.editar')
  criarVersao(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string,
    @Param('artifactId') artifactId: string, @Body() body: unknown) {
    return this.editorial.criarVersao(user.orgId, taskId, artifactId, user.sub, body);
  }
}
