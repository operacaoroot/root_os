import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PublicacaoInstagramService } from './publicacao-instagram.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MD6: publicar a peça da semana no Instagram pelo OS, item a item. Pedir é
 * `pauta.publicar` (quem responde pelo que vai ao ar) e o pedido vai à porta,
 * que o retém como R3 até OUTRA pessoa confirmar em /atendimento. A rota antiga
 * `POST /pauta/pecas/:id/publicar` (WhatsApp/ClickUp) não mudou.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/pecas')
export class PublicacaoInstagramController {
  constructor(private readonly publicacao: PublicacaoInstagramService) {}

  @Post(':id/publicar-instagram')
  @RequirePermissions('pauta.publicar')
  pedir(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.publicacao.pedir(user.orgId, id, user.sub);
  }

  @Get(':id/publicacao')
  @RequirePermissions('pauta.ver')
  daPeca(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.publicacao.daPeca(user.orgId, id);
  }

  @Post(':id/publicacao/manual')
  @RequirePermissions('pauta.publicar')
  voltarAoManual(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.publicacao.voltarAoManual(user.orgId, id, user.sub);
  }
}
