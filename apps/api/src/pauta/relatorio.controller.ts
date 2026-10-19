import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PautaMesSchema, PautaRelatorioSalvarHumanoSchema } from '@mktos/shared';
import { RelatorioService } from './relatorio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK6: o relatório do mês. Sub-rota de `/pauta`, governada pelo módulo pauta.
// Ver é `pauta.ver`, e não `relatorios.ver`: este relatório é do conteúdo que a
// pauta publica, e não do módulo de relatórios da execução, que é outro assunto
// com nome parecido (o inventário da MK0 registra a diferença).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/relatorio')
export class RelatorioController {
  constructor(private readonly relatorios: RelatorioService) {}

  @Get(':mes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  painel(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.relatorios.painelHumano(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }

  @Put(':mes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  salvar(@CurrentUser() user: JwtUser, @Param('mes') mes: string, @Body() body: unknown) {
    return this.relatorios.salvarHumano(
      user.orgId,
      user.sub,
      PautaMesSchema.parse(mes),
      PautaRelatorioSalvarHumanoSchema.parse(body ?? {}),
    );
  }

  // Gasta IA, como as outras gerações da pauta.
  @Post(':mes/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.relatorios.gerar(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }
}
