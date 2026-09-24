import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PautaPaginaDeLinksPublicarSchema } from '@mktos/shared';
import { PaginaDeLinksService } from './pagina-de-links.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MC12: a página de links do episódio. Sub-rota de `/pauta`, governada pelo
 * módulo pauta. Publicar pede, além de `pauta.publicar`, a permissão que o
 * painel da bio pede para publicar (`bio.editar`) — e passa pelo mesmo método.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class PaginaDeLinksController {
  constructor(private readonly paginas: PaginaDeLinksService) {}

  @Post(':id/pagina-de-links')
  @RequirePermissions('pauta.editar')
  montar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.paginas.montar(user.orgId, id, { sub: user.sub, permissions: user.permissions ?? [] });
  }

  @Post(':id/pagina-de-links/publicar')
  @RequirePermissions('pauta.publicar', 'bio.editar')
  publicar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { publicada } = PautaPaginaDeLinksPublicarSchema.parse(body ?? {});
    return this.paginas.publicar(user.orgId, id, user.sub, publicada);
  }
}
