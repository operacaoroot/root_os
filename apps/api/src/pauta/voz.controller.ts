import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { PautaVozAprenderSchema, PautaVozChaveSchema, PautaVozSalvarSchema } from '@mktos/shared';
import { VozService } from './voz.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MC10: a voz do autor. Sub-rota de `/pauta`, governada pelo módulo pauta. A
// nota só alcança chaves sob `voz.` (e a de configuração), nunca outra da memória.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/voz')
export class VozController {
  constructor(private readonly vozes: VozService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.vozes.painel(user.orgId);
  }

  // Gasta IA, como gerar o roteiro e a rodada.
  @Post('aprender')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  aprender(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.vozes.aprender(user.orgId, user.sub, PautaVozAprenderSchema.parse(body ?? {}));
  }

  @Put()
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.vozes.salvar(user.orgId, user.sub, PautaVozSalvarSchema.parse(body ?? {}));
  }

  @Put('chave')
  @RequirePermissions('pauta.editar')
  chave(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const { chave } = PautaVozChaveSchema.parse(body ?? {});
    return this.vozes.definirChave(user.orgId, user.sub, chave);
  }
}
