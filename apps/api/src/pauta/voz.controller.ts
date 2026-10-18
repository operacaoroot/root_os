import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { PautaVozAprenderSchema, PautaVozChaveHumanaSchema, PautaVozSalvarHumanoSchema } from '@mktos/shared';
import { VozService } from './voz.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MC10: a voz do autor. Sub-rota de `/pauta`, governada pelo módulo pauta. A
// nota só alcança chaves sob `voz.` (e a de configuração), nunca outra da memória.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/voz')
export class VozController {
  constructor(private readonly vozes: VozService) {}

  @Get()
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.vozes.painelHumano(user.orgId, user.sub);
  }

  // Gasta IA, como gerar o roteiro e a rodada.
  @Post('aprender')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  aprender(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.vozes.aprender(user.orgId, user.sub, PautaVozAprenderSchema.parse(body ?? {}));
  }

  @Put()
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  salvar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.vozes.salvarHumano(user.orgId, user.sub, PautaVozSalvarHumanoSchema.parse(body ?? {}));
  }

  @Put('chave')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  chave(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.vozes.definirChaveHumana(user.orgId, user.sub, PautaVozChaveHumanaSchema.parse(body ?? {}));
  }
}
