import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PautaMidiaSchema, PautaTranscricaoSchema } from '@mktos/shared';
import { MidiaService } from './midia.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MC9: a estação de mídia no Mac (`tools/root-midia`) fala com estas rotas pelo
 * login normal da API. Sub-rota de `/pauta`, governada pelo módulo pauta.
 *
 * ORDEM: este controller é registrado ANTES do `EpisodioController` no
 * `PautaModule` — senão o `GET :id` de lá casa com `pendentes-midia` primeiro e
 * responde "Episódio não encontrado". `pauta-midia.test.ts` confere a ordem.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class MidiaController {
  constructor(private readonly midia: MidiaService) {}

  @Get('pendentes-midia')
  @RequirePermissions('pauta.editar')
  pendentes(@CurrentUser() user: JwtUser) {
    return this.midia.pendentes(user.orgId);
  }

  @Post(':id/midia')
  @RequirePermissions('pauta.editar')
  registrarMidia(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.midia.registrarMidia(user.orgId, id, user.sub, PautaMidiaSchema.parse(body ?? {}));
  }

  @Post(':id/transcricao')
  @RequirePermissions('pauta.editar')
  registrarTranscricao(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.midia.registrarTranscricao(user.orgId, id, user.sub, PautaTranscricaoSchema.parse(body ?? {}));
  }
}
