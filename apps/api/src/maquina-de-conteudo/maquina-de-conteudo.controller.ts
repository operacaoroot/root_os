import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  MaquinaCadenciaSchema,
  MaquinaComentarioSchema,
  MaquinaDataSchema,
  MaquinaEtapaSchema,
  MaquinaMetricasSchema,
  MaquinaOrdemSchema,
  MaquinaPostSalvarSchema,
} from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { MaquinaDeConteudoService } from './maquina-de-conteudo.service';

// Marketing › Máquina de Conteúdo da empresa. Mesmas permissões da pauta:
// ver = pauta.ver, mexer = pauta.editar. Rotas fixas antes das com `:id`.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/maquina')
export class MaquinaDeConteudoController {
  constructor(private readonly svc: MaquinaDeConteudoService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() u: JwtUser) {
    return this.svc.painel(u.orgId);
  }

  @Post('posts')
  @RequirePermissions('pauta.editar')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criar(u.orgId, { id: u.sub, nome: u.name }, MaquinaPostSalvarSchema.parse(body));
  }

  @Post('ordem')
  @RequirePermissions('pauta.editar')
  ordem(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.ordenar(u.orgId, MaquinaOrdemSchema.parse(body).ids);
  }

  @Put('cadencia')
  @RequirePermissions('pauta.editar')
  cadencia(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.salvarCadencia(u.orgId, MaquinaCadenciaSchema.parse(body).dias);
  }

  @Put('posts/:id')
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.salvar(u.orgId, id, MaquinaPostSalvarSchema.parse(body));
  }

  @Patch('posts/:id/etapa')
  @RequirePermissions('pauta.editar')
  etapa(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.mudarEtapa(u.orgId, id, u.name, MaquinaEtapaSchema.parse(body));
  }

  @Patch('posts/:id/data')
  @RequirePermissions('pauta.editar')
  data(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.mudarData(u.orgId, id, u.name, MaquinaDataSchema.parse(body).data);
  }

  @Post('posts/:id/comentarios')
  @RequirePermissions('pauta.editar')
  comentar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.comentar(u.orgId, id, u.name, MaquinaComentarioSchema.parse(body).texto);
  }

  @Put('posts/:id/metricas')
  @RequirePermissions('pauta.editar')
  metricas(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.metricas(u.orgId, id, MaquinaMetricasSchema.parse(body));
  }
}
