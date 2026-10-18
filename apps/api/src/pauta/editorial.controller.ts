import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EditorialService } from './editorial.service';
import { EditorialCreateSchema, EditorialVersionSchema, EditorialDecisionSchema, EditorialProductionSchema, EditorialRevokeSchema } from './editorial-contrato';
const uuid = (v: string) => z.string().uuid().parse(v);
@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('pauta/editorial')
export class EditorialController {
  constructor(private readonly editorial: EditorialService) {}
  @Get('tarefas/:taskId')
  @RequirePermissions('pauta.ver', 'tarefas.ver')
  obter(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) { return this.editorial.obter(u.orgId, u.sub, uuid(taskId)); }
  @Post('materiais')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) { return this.editorial.criar(u.orgId, u.sub, EditorialCreateSchema.parse(body)); }
  @Post('materiais/:materialId/versoes')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  versao(@CurrentUser() u: JwtUser, @Param('materialId') id: string, @Body() body: unknown) { return this.editorial.prepararVersao(u.orgId, u.sub, uuid(id), EditorialVersionSchema.parse(body)); }
  @Post('decisoes')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  decidir(@CurrentUser() u: JwtUser, @Body() body: unknown) { return this.editorial.decidir(u.orgId, u.sub, EditorialDecisionSchema.parse(body)); }
  @Post('decisoes/:decisionId/revogar')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  revogar(@CurrentUser() u: JwtUser, @Param('decisionId') id: string, @Body() body: unknown) { return this.editorial.revogar(u.orgId, u.sub, uuid(id), EditorialRevokeSchema.parse(body).reason); }
  @Get('versoes/:versionId/producao')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  conferir(@CurrentUser() u: JwtUser, @Param('versionId') id: string, @Query() query: Record<string, string>) { const input = EditorialProductionSchema.omit({ requestId: true }).parse({ ...query, versionId: uuid(id) }); return this.editorial.conferirProducao(u.orgId, u.sub, input); }
  @Post('producoes')
  @RequirePermissions('pauta.ver', 'tarefas.ver', 'pauta.editar', 'tarefas.editar')
  produzir(@CurrentUser() u: JwtUser, @Body() body: unknown) { return this.editorial.produzir(u.orgId, u.sub, EditorialProductionSchema.parse(body)); }
}
