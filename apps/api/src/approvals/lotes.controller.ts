import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AssinaturaDeLoteService } from './assinatura-de-lote.service';
import { LotesService } from './lotes.service';

/*
 * MD7: o lote de aprovação. Pedir a assinatura é `pauta.publicar` (o único
 * lote de hoje é a semana de posts, e quem responde pelo que vai ao ar é quem
 * pede); ver o lote é `aprovacoes.ver`, a mesma chave da fila onde a segunda
 * pessoa o assina. Montar o lote é da MD8 (a semana), que chama `LotesService`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals/lotes')
export class LotesController {
  constructor(
    private readonly lotes: LotesService,
    private readonly assinatura: AssinaturaDeLoteService,
  ) {}

  @Get(':id')
  @RequirePermissions('aprovacoes.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.lotes.detalhe(user.orgId, id);
  }

  @Post(':id/pedir-assinatura')
  @RequirePermissions('pauta.publicar')
  pedirAssinatura(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assinatura.pedirAssinatura(user.orgId, id, user.sub);
  }
}
