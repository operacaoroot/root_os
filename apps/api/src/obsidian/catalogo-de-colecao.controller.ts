import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { CatalogoDeColecaoService } from './catalogo-de-colecao.service';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('knowledge/colecao')
export class CatalogoDeColecaoController {
  constructor(private readonly catalogo: CatalogoDeColecaoService) {}
  @Get('itens/:itemId')
  @RequirePermissions('obsidian.ver')
  porItem(@CurrentUser() user: JwtUser, @Param('itemId') itemId: string) {
    return this.catalogo.porItem(user.orgId, user.sub, itemId);
  }
}
