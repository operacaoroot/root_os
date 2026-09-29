import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ConcorrentesService } from './concorrentes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK2: concorrentes com números. Sub-rota de `/pauta`, governada pelo módulo
// pauta. Só leitura e a geração do dossiê — a fonte do perfil continua sendo
// criada e coletada em `/referencias`, que é onde ela já mora.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/concorrentes')
export class ConcorrentesController {
  constructor(private readonly concorrentes: ConcorrentesService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  listar(@CurrentUser() user: JwtUser) {
    return this.concorrentes.listar(user.orgId);
  }

  @Get(':id')
  @RequirePermissions('pauta.ver')
  async analise(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    const [analise, dossie] = await Promise.all([
      this.concorrentes.analise(user.orgId, id),
      this.concorrentes.dossie(user.orgId, id),
    ]);
    return { ...analise, dossie };
  }

  // Gasta IA, como gerar o roteiro e aprender a voz.
  @Post(':id/dossie')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.concorrentes.gerarDossie(user.orgId, user.sub, id);
  }
}
