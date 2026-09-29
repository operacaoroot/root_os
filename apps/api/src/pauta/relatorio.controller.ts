import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PautaMesSchema, PautaRelatorioSalvarSchema } from '@mktos/shared';
import { RelatorioService } from './relatorio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
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
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.relatorios.painel(user.orgId, PautaMesSchema.parse(mes));
  }

  @Put(':mes')
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() user: JwtUser, @Param('mes') mes: string, @Body() body: unknown) {
    return this.relatorios.salvar(
      user.orgId,
      user.sub,
      PautaMesSchema.parse(mes),
      PautaRelatorioSalvarSchema.parse(body ?? {}),
    );
  }

  // Gasta IA, como as outras gerações da pauta.
  @Post(':mes/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.relatorios.gerar(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }
}
