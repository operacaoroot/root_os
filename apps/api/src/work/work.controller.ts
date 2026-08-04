import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  TrabPastaCreateSchema, TrabPastaUpdateSchema, TrabListaCreateSchema, TrabListaUpdateSchema,
  TrabStatusCreateSchema, TrabStatusUpdateSchema, TrabCampoCreateSchema, TrabCampoUpdateSchema,
  TrabOpcaoCreateSchema, TrabOpcaoUpdateSchema, TrabTagCreateSchema, TrabTagUpdateSchema,
  TrabTarefaCreateSchema, TrabTarefaUpdateSchema, TrabComentarioSchema,
} from '@mktos/shared';
import { WorkService } from './work.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// Módulo TRABALHO (ClickUp-like). Escritas são INTERNAS ao mkt-os (sem efeito
// externo), então ficam fora do fluxo de approvals — o gate é o RBAC
// (tarefas.editar), como num board de verdade. Tudo auditado no AuditService.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho')
export class WorkController {
  constructor(private readonly svc: WorkService) {}

  // ---- estrutura ----
  @Get('estrutura')
  @RequirePermissions('tarefas.ver')
  estrutura(@CurrentUser() u: JwtUser) {
    return this.svc.estrutura(u.orgId);
  }

  // ---- pastas ----
  @Post('pastas')
  @RequirePermissions('tarefas.editar')
  criarPasta(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarPasta(u.orgId, u.sub, TrabPastaCreateSchema.parse(body));
  }

  @Patch('pastas/:id')
  @RequirePermissions('tarefas.editar')
  editarPasta(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarPasta(u.orgId, u.sub, id, TrabPastaUpdateSchema.parse(body));
  }

  @Delete('pastas/:id')
  @RequirePermissions('tarefas.editar')
  apagarPasta(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarPasta(u.orgId, u.sub, id);
  }

  // ---- listas ----
  @Post('listas')
  @RequirePermissions('tarefas.editar')
  criarLista(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarLista(u.orgId, u.sub, TrabListaCreateSchema.parse(body));
  }

  @Patch('listas/:id')
  @RequirePermissions('tarefas.editar')
  editarLista(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarLista(u.orgId, u.sub, id, TrabListaUpdateSchema.parse(body));
  }

  @Delete('listas/:id')
  @RequirePermissions('tarefas.editar')
  apagarLista(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarLista(u.orgId, u.sub, id);
  }

  // ---- statuses ----
  @Post('listas/:id/statuses')
  @RequirePermissions('tarefas.editar')
  criarStatus(@CurrentUser() u: JwtUser, @Param('id') listId: string, @Body() body: unknown) {
    return this.svc.criarStatus(u.orgId, u.sub, listId, TrabStatusCreateSchema.parse(body));
  }

  @Patch('statuses/:id')
  @RequirePermissions('tarefas.editar')
  editarStatus(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarStatus(u.orgId, u.sub, id, TrabStatusUpdateSchema.parse(body));
  }

  @Delete('statuses/:id')
  @RequirePermissions('tarefas.editar')
  apagarStatus(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarStatus(u.orgId, u.sub, id);
  }

  // ---- campos personalizados + opções ----
  @Post('campos')
  @RequirePermissions('tarefas.editar')
  criarCampo(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarCampo(u.orgId, u.sub, TrabCampoCreateSchema.parse(body));
  }

  @Patch('campos/:id')
  @RequirePermissions('tarefas.editar')
  editarCampo(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarCampo(u.orgId, u.sub, id, TrabCampoUpdateSchema.parse(body));
  }

  @Delete('campos/:id')
  @RequirePermissions('tarefas.editar')
  apagarCampo(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarCampo(u.orgId, u.sub, id);
  }

  @Post('campos/:id/opcoes')
  @RequirePermissions('tarefas.editar')
  criarOpcao(@CurrentUser() u: JwtUser, @Param('id') fieldId: string, @Body() body: unknown) {
    return this.svc.criarOpcao(u.orgId, u.sub, fieldId, TrabOpcaoCreateSchema.parse(body));
  }

  @Patch('opcoes/:id')
  @RequirePermissions('tarefas.editar')
  editarOpcao(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarOpcao(u.orgId, u.sub, id, TrabOpcaoUpdateSchema.parse(body));
  }

  @Delete('opcoes/:id')
  @RequirePermissions('tarefas.editar')
  apagarOpcao(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarOpcao(u.orgId, u.sub, id);
  }

  // ---- etiquetas ----
  @Post('tags')
  @RequirePermissions('tarefas.editar')
  criarTag(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarTag(u.orgId, u.sub, TrabTagCreateSchema.parse(body));
  }

  @Patch('tags/:id')
  @RequirePermissions('tarefas.editar')
  editarTag(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarTag(u.orgId, u.sub, id, TrabTagUpdateSchema.parse(body));
  }

  @Delete('tags/:id')
  @RequirePermissions('tarefas.editar')
  apagarTag(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarTag(u.orgId, u.sub, id);
  }

  // ---- tarefas ----
  @Get('tarefas')
  @RequirePermissions('tarefas.ver')
  tarefas(
    @CurrentUser() u: JwtUser,
    @Query('listId') listId?: string,
    @Query('statusId') statusId?: string,
    @Query('assignee') assignee?: string,
    @Query('tagId') tagId?: string,
    @Query('q') q?: string,
    @Query('opcao') opcao?: string,
    @Query('arquivadas') arquivadas?: string,
  ) {
    return this.svc.tarefas(u.orgId, {
      listId, statusId, assignee, tagId, q, opcao,
      arquivadas: arquivadas === '1' || arquivadas === 'true',
    });
  }

  @Get('tarefas/:id')
  @RequirePermissions('tarefas.ver')
  tarefa(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.tarefa(u.orgId, id);
  }

  @Post('tarefas')
  @RequirePermissions('tarefas.editar')
  criarTarefa(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarTarefa(u.orgId, u.sub, TrabTarefaCreateSchema.parse(body));
  }

  @Patch('tarefas/:id')
  @RequirePermissions('tarefas.editar')
  editarTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarTarefa(u.orgId, u.sub, id, TrabTarefaUpdateSchema.parse(body));
  }

  // "apagar" = arquivar (nada some de verdade; auditoria fica)
  @Delete('tarefas/:id')
  @RequirePermissions('tarefas.editar')
  arquivarTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.editarTarefa(u.orgId, u.sub, id, { archived: true });
  }

  @Post('tarefas/:id/comentarios')
  @RequirePermissions('tarefas.editar')
  comentar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.comentar(u.orgId, u.sub, id, TrabComentarioSchema.parse(body).text);
  }
}
