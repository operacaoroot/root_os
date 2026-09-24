import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { EncadeamentoService } from './encadeamento.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MD1: o próximo passo que a rotina `pauta.encadear` daria sozinha neste
 * episódio, ou por que ela para. Só leitura: quem anda é a rotina (/rotinas).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class EncadeamentoController {
  constructor(private readonly encadeamento: EncadeamentoService) {}

  @Get(':id/encadeamento')
  @RequirePermissions('pauta.ver')
  doEpisodio(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.encadeamento.doEpisodio(user.orgId, id);
  }
}
