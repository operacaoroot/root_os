import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  PautaMarcaAplicarSchema, PautaMarcaDestinoSchema,
  PautaMarcaSalvarSchema, PautaPilaresSalvarSchema,
} from '@mktos/shared';
import { MarcaService } from './marca.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK1: a marca e os pilares. Sub-rota de `/pauta`, governada pelo módulo pauta.
// As duas notas têm chave fixa (`pauta.marca` e `pauta.marca.pilares`) — ao
// contrário da voz, aqui não há chave configurável, então `pauta.editar` nunca
// alcança outra nota da memória por esta porta.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/marca')
export class MarcaController {
  constructor(private readonly marcas: MarcaService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.marcas.painel(user.orgId);
  }

  @Get('projecao/:destino')
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  previa(@CurrentUser() user: JwtUser, @Param('destino') destino: string) {
    return this.marcas.previa(user.orgId, PautaMarcaDestinoSchema.parse(destino));
  }

  @Post('projecao/:destino')
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  aplicar(@CurrentUser() user: JwtUser, @Param('destino') destino: string, @Body() body: unknown) {
    return this.marcas.aplicar(user.orgId, PautaMarcaDestinoSchema.parse(destino), PautaMarcaAplicarSchema.parse(body ?? {}));
  }

  @Put()
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.marcas.salvarPerfil(user.orgId, user.sub, PautaMarcaSalvarSchema.parse(body ?? {}));
  }

  @Put('pilares')
  @RequirePermissions('pauta.editar')
  salvarPilares(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.marcas.salvarPilares(user.orgId, user.sub, PautaPilaresSalvarSchema.parse(body ?? {}));
  }
}
