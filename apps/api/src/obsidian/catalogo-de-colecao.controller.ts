import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { CatalogoDeColecaoService } from './catalogo-de-colecao.service';
import { ContextoMovimentoExplicitoService } from './contexto-movimento-explicito.service';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('knowledge/colecao')
export class CatalogoDeColecaoController {
  constructor(private readonly catalogo: CatalogoDeColecaoService, private readonly movimento: ContextoMovimentoExplicitoService) {}
  @Get('notas/:notaId/versoes/:versionId')
  @RequirePermissions('obsidian.ver')
  porVersao(@CurrentUser() user: JwtUser, @Param('notaId') notaId: string, @Param('versionId') versionId: string) {
    return this.catalogo.porVersao(user.orgId, user.sub, notaId, versionId);
  }
  @Get('itens/:itemId')
  @RequirePermissions('obsidian.ver')
  porItem(@CurrentUser() user: JwtUser, @Param('itemId') itemId: string) {
    return this.catalogo.porItem(user.orgId, user.sub, itemId);
  }
  @Post('movimentos/previa')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  previa(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.movimento.previa(user.orgId, user.sub, body);
  }
  @Post('movimentos/intencoes')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  registrarIntencao(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.movimento.registrarIntencao(user.orgId, user.sub, body);
  }
  @Post('movimentos/:requestId/captura')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  captura(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string, @Body() body: unknown) {
    return this.movimento.captura(user.orgId, user.sub, requestId, body);
  }
  @Post('movimentos/:requestId/confirmar')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  confirmar(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string, @Body() body: unknown) {
    return this.movimento.confirmar(user.orgId, user.sub, requestId, body);
  }
  @Post('movimentos/:requestId/cancelamento/previa')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  cancelamentoPrevia(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string, @Body() body: unknown) {
    return this.movimento.cancelamentoPrevia(user.orgId, user.sub, requestId, body);
  }
  @Post('movimentos/:requestId/cancelar')
  @RequirePermissions('obsidian.ver', 'obsidian.editar')
  cancelar(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string, @Body() body: unknown) {
    return this.movimento.cancelar(user.orgId, user.sub, requestId, body);
  }
  @Get('movimentos/:requestId')
  @RequirePermissions('obsidian.ver')
  porPedido(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string) {
    return this.movimento.porPedido(user.orgId, user.sub, requestId);
  }
  @Get('aliases')
  @RequirePermissions('obsidian.ver')
  alias(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return this.movimento.alias(user.orgId, user.sub, query);
  }
}
