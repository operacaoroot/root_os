import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { SessaoDaPlataformaGuard } from '../platform/sessao-da-plataforma.guard';
import { FrotaService } from './frota.service';
import { CriarCasaSchema, EditarCasaSchema, EventosConsultaSchema, OrdemSchema, RevogarSchema } from './frota.schemas';

/*
 * O PAINEL DA FROTA — tela da ROOT, como a Operação: a API recusa qualquer
 * sessão que não seja a da plataforma (403), e a tela explica em vez de quebrar.
 *
 * Ler pede `dashboard.ver`; agir (criar casa, girar token, revogar, enfileirar
 * ordem) pede `admin.usuarios`, a permissão de quem administra gente e acesso.
 * Nenhuma permissão nova: o JWT de quem já entrou continua valendo.
 */
@UseGuards(JwtAuthGuard, SessaoDaPlataformaGuard, PermissionsGuard)
@Controller('frota')
export class FrotaController {
  constructor(private readonly frota: FrotaService) {}

  @Get('resumo')
  @RequirePermissions('dashboard.ver')
  resumo(@CurrentUser() user: JwtUser) {
    return this.frota.resumo(user.orgId);
  }

  @Get('casas')
  @RequirePermissions('dashboard.ver')
  casas(@CurrentUser() user: JwtUser, @Query('arquivadas') arquivadas?: string) {
    return this.frota.listarCasas(user.orgId, arquivadas === '1');
  }

  @Post('casas')
  @RequirePermissions('admin.usuarios')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.frota.criarCasa(user.orgId, user, CriarCasaSchema.parse(body));
  }

  @Get('casas/:id')
  @RequirePermissions('dashboard.ver')
  casa(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.frota.casa(user.orgId, id);
  }

  @Patch('casas/:id')
  @RequirePermissions('admin.usuarios')
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.frota.editarCasa(user.orgId, user, id, EditarCasaSchema.parse(body));
  }

  @Post('casas/:id/token')
  @RequirePermissions('admin.usuarios')
  token(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.frota.girarToken(user.orgId, user, id);
  }

  @Post('casas/:id/ordens')
  @RequirePermissions('admin.usuarios')
  ordem(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.frota.criarOrdem(user.orgId, user, id, OrdemSchema.parse(body));
  }

  @Post('acessos/:id/revogar')
  @RequirePermissions('admin.usuarios')
  revogar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.frota.revogar(user.orgId, user, id, RevogarSchema.parse(body).motivo);
  }

  @Post('ordens/:id/cancelar')
  @RequirePermissions('admin.usuarios')
  cancelar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.frota.cancelarOrdem(user.orgId, user, id);
  }

  @Get('eventos')
  @RequirePermissions('dashboard.ver')
  eventos(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return this.frota.eventos(user.orgId, EventosConsultaSchema.parse(query));
  }

  @Get('politicas')
  @RequirePermissions('dashboard.ver')
  politicas(@CurrentUser() user: JwtUser) {
    return this.frota.politicas(user.orgId);
  }
}
