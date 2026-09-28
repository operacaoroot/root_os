import { Body, Controller, Get, Optional, Param, Post, Put, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PautaPausarRegraDaDmSchema, PautaTextoDaDmSchema, type PautaFilaDeComentarios } from '@mktos/shared';
import { ComentariosService } from './comentarios.service';
import { DmAutomaticaService } from './dm-automatica.service';
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
 *
 * MD11: a fila também mostra a DM automática (a nota e as regras assinadas,
 * com "enviadas hoje") e o envio automático de cada linha. Pausar uma regra é
 * `instagram.regra_de_resposta.pausar` (R0) pela porta, com `pauta.editar`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class ComentariosController {
  constructor(
    private readonly comentarios: ComentariosService,
    @Optional() private readonly dm?: DmAutomaticaService,
  ) {}

  @Get('comentarios')
  @RequirePermissions('pauta.ver')
  async fila(@CurrentUser() user: JwtUser): Promise<PautaFilaDeComentarios> {
    const fila = await this.comentarios.fila(user.orgId);
    return this.dm ? { ...fila, dmAutomatica: await this.dm.estadoNaFila(user.orgId) } : fila;
  }

  @Post('dm/regras/:itemId/pausar')
  @RequirePermissions('pauta.editar')
  pausar(@CurrentUser() user: JwtUser, @Param('itemId') itemId: string, @Body() body: unknown) {
    if (!this.dm) throw new ServiceUnavailableException('A DM automática não está ligada nesta instância da API.');
    return this.dm.pausarPelaTela(user.orgId, itemId, PautaPausarRegraDaDmSchema.parse(body ?? {}).motivo, user.sub);
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
