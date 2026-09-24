import { Body, Controller, Get, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  PautaPalavraDeCorteDoEpisodioSchema,
  PautaRoteiroGerarSchema,
  PautaRoteiroSalvarSchema,
} from '@mktos/shared';
import { RoteiroService } from './roteiro.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MC8: o roteiro do episódio. Sub-rota de `/pauta`, governada pelo módulo pauta.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class RoteiroController {
  constructor(private readonly roteiros: RoteiroService) {}

  @Get(':id/roteiro')
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.roteiros.painel(user.orgId, id);
  }

  // Gasta IA, como gerar a rodada e derivar as peças.
  @Post(':id/roteiro/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { substituir } = PautaRoteiroGerarSchema.parse(body ?? {});
    return this.roteiros.gerar(user.orgId, id, user.sub, { substituir });
  }

  @Put(':id/roteiro')
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.roteiros.salvar(user.orgId, id, user.sub, PautaRoteiroSalvarSchema.parse(body ?? {}));
  }

  @Put(':id/palavra-de-corte')
  @RequirePermissions('pauta.editar')
  palavraDeCorte(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { palavraDeCorte } = PautaPalavraDeCorteDoEpisodioSchema.parse(body ?? {});
    return this.roteiros.definirPalavraDeCorte(user.orgId, id, user.sub, palavraDeCorte);
  }

  @Get(':id/roteiro.md')
  @RequirePermissions('pauta.ver')
  async exportar(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { nome, conteudo } = await this.roteiros.exportar(user.orgId, id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Cache-Control', 'no-store');
    return conteudo;
  }
}
