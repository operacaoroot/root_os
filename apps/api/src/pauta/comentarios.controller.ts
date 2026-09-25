import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PautaTextoDaDmSchema } from '@mktos/shared';
import { ComentariosService } from './comentarios.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MD9: a fila "quem comentou e o que responder" e o texto da DM de cada
 * matéria. Nada aqui sai do OS: a leitura dos comentários é da rotina, pela
 * porta, e a DM é mandada à mão. Ver `comentarios.service.ts`.
 *
 *   · ler a fila: `pauta.ver`;
 *   · marcar como respondido: `pauta.publicar` — é responder pelo que a marca
 *     disse a alguém, como "Marcar como postada";
 *   · preparar e editar o texto: `pauta.editar`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class ComentariosController {
  constructor(private readonly comentarios: ComentariosService) {}

  @Get('comentarios')
  @RequirePermissions('pauta.ver')
  fila(@CurrentUser() user: JwtUser) {
    return this.comentarios.fila(user.orgId);
  }

  @Post('comentarios/:id/respondido')
  @RequirePermissions('pauta.publicar')
  respondido(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.comentarios.marcarRespondido(user.orgId, id, user.sub);
  }

  @Post('episodios/:id/dm/preparar')
  @RequirePermissions('pauta.editar')
  preparar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.comentarios.prepararTextos(user.orgId, id, user.sub);
  }

  @Put('episodios/:id/dm/:itemId')
  @RequirePermissions('pauta.editar')
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.comentarios.editarTexto(user.orgId, id, itemId, PautaTextoDaDmSchema.parse(body ?? {}).texto, user.sub);
  }
}
