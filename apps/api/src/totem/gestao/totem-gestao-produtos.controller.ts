import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  TotemGestaoConfigSchema,
  TotemGestaoIdSchema,
  TotemGestaoProdutoCriarSchema,
  TotemGestaoProdutoEditarSchema,
  TotemGestaoProdutosQuerySchema,
} from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { TotemGestaoService } from './totem-gestao.service';

/**
 * Catálogo e configuração do totem, que valem para a empresa inteira. Ler é de
 * quem vê o painel; o gerente precisa achar o produto para repor e etiquetar.
 * Escrever produto é de `totem.produtos`; escrever configuração, de
 * `totem.lojas`.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoProdutosController {
  constructor(private readonly svc: TotemGestaoService) {}

  @Get('produtos')
  @RequirePermissions('totem.ver')
  produtos(@CurrentUser() u: JwtUser, @Query() query: unknown) {
    return this.svc.produtos(u, TotemGestaoProdutosQuerySchema.parse(query));
  }

  @Get('produtos/:id')
  @RequirePermissions('totem.ver')
  produto(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.produto(u, TotemGestaoIdSchema.parse(id));
  }

  @Post('produtos')
  @RequirePermissions('totem.produtos')
  criarProduto(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarProduto(u, TotemGestaoProdutoCriarSchema.parse(body));
  }

  @Patch('produtos/:id')
  @RequirePermissions('totem.produtos')
  editarProduto(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarProduto(u, TotemGestaoIdSchema.parse(id), TotemGestaoProdutoEditarSchema.parse(body));
  }

  @Get('configuracao')
  @RequirePermissions('totem.ver')
  configuracao(@CurrentUser() u: JwtUser) {
    return this.svc.config(u);
  }

  @Put('configuracao')
  @RequirePermissions('totem.lojas')
  salvarConfiguracao(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.salvarConfig(u, TotemGestaoConfigSchema.parse(body));
  }
}
