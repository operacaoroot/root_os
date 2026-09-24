import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PautaEpisodioAtualizarSchema, PautaEpisodioCriarSchema, PautaEpisodioStatusSchema } from '@mktos/shared';
import { EpisodioService } from './episodio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MC7: o episódio da semana. Sub-rota de `/pauta`, governada pelo módulo pauta.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class EpisodioController {
  constructor(private readonly episodios: EpisodioService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  listar(@CurrentUser() user: JwtUser) {
    return this.episodios.listar(user.orgId);
  }

  @Get(':id')
  @RequirePermissions('pauta.ver')
  obter(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.episodios.obter(user.orgId, id);
  }

  @Post()
  @RequirePermissions('pauta.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.episodios.criar(user.orgId, user.sub, PautaEpisodioCriarSchema.parse(body ?? {}));
  }

  @Patch(':id')
  @RequirePermissions('pauta.editar')
  atualizar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { titulo } = PautaEpisodioAtualizarSchema.parse(body ?? {});
    return this.episodios.atualizarTitulo(user.orgId, id, user.sub, titulo);
  }

  @Post(':id/status')
  @RequirePermissions('pauta.editar')
  mudarStatus(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { para } = PautaEpisodioStatusSchema.parse(body ?? {});
    return this.episodios.mudarStatus(user.orgId, id, user.sub, para);
  }
}
