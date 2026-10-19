import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PautaEstrategiaSalvarHumanoSchema, PautaMesSchema } from '@mktos/shared';
import { EstrategiaService } from './estrategia.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK4: a estratégia do mês. Sub-rota de `/pauta`, governada pelo módulo pauta.
// O mês vem no caminho e é conferido pelo mesmo esquema em todas as rotas: é
// ele que vira a chave da nota, e chave torta criaria documento órfão.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/estrategia')
export class EstrategiaController {
  constructor(private readonly estrategias: EstrategiaService) {}

  @Get(':mes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.ver', 'obsidian.ver')
  painel(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.estrategias.painelHumano(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }

  @Put(':mes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('pauta.editar', 'obsidian.ver')
  salvar(@CurrentUser() user: JwtUser, @Param('mes') mes: string, @Body() body: unknown) {
    return this.estrategias.salvarHumano(
      user.orgId,
      user.sub,
      PautaMesSchema.parse(mes),
      PautaEstrategiaSalvarHumanoSchema.parse(body ?? {}),
    );
  }

  // Gasta IA, como gerar o roteiro e o dossiê.
  @Post(':mes/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('mes') mes: string) {
    return this.estrategias.gerar(user.orgId, user.sub, PautaMesSchema.parse(mes));
  }
}
