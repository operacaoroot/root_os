import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { BrandbookAtivarSchema, BrandbookColetarSiteSchema, BrandbookSalvarSchema, BrandbookVersaoSchema } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { BrandbookService } from './brandbook.service';
import { coletarSiteDaMarca } from './brandbook-coleta';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('pauta/marca/brandbook')
export class BrandbookController {
  constructor(private readonly livros: BrandbookService) {}
  @Get()
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser) { return this.livros.painel(user.orgId); }
  @Get('referencia-root')
  @RequirePermissions('pauta.ver')
  referencia() { return this.livros.referenciaRoot(); }
  @Put('rascunho')
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  salvar(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.livros.salvar(user.orgId, BrandbookSalvarSchema.parse(body)); }
  @Post('previa')
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  previa(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.livros.previa(user.orgId, BrandbookVersaoSchema.parse(body).versaoEsperada); }
  @Post('ativar')
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  ativar(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.livros.ativar(user.orgId, user.sub, BrandbookAtivarSchema.parse(body)); }
  @Post('desativar')
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  desativar(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.livros.desativar(user.orgId, BrandbookVersaoSchema.parse(body).versaoEsperada); }
  @Post('coletar-site')
  @RequirePermissions('pauta.editar')
  coletar(@Body() body: unknown) { return coletarSiteDaMarca(BrandbookColetarSiteSchema.parse(body).url); }
}
