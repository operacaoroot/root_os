import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  TotemEtiquetasFiltroSchema,
  TotemEtiquetasImpressasSchema,
  TotemEtiquetasNovasSchema,
  TotemLoteEdicaoSchema,
  TotemLoteNovoSchema,
  TotemLotePorLojaFiltroSchema,
  TotemLotesFiltroSchema,
  TotemLoteUuidSchema,
  TotemRemessaNovaSchema,
  TotemRemessaRecebimentoSchema,
  TotemRemessasFiltroSchema,
  TotemReposicaoNovaSchema,
} from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { gerarEtiquetas, listarEtiquetas, marcarEtiquetasImpressas, revogarEtiqueta } from './etiquetas';
import { criarLote, editarLote, listarLojasDoLote, listarLotes, listarProdutosDoLote } from './lotes';
import { pendenciasDasLojas } from './pendencias';
import { cancelarRemessa, criarRemessa, listarRemessas, receberRemessa } from './remessas';
import { listarReposicoes, registrarReposicao } from './reposicoes';

/**
 * `/api/totem-lotes` — lotes, remessas, reposições, pendências e etiquetas no
 * painel (frente C). Toda rota fica no escopo de lojas do usuário; o filho é
 * sempre lido pelo id E pela empresa, e o que está fora responde 404.
 *
 * Remessa, reposição e lote são lidos por quem trabalha no CD (`totem.lotes`)
 * e por quem trabalha na loja (`totem.reposicao`): essas leituras declaram
 * `totem.ver` e conferem a alternativa dentro da operação.
 */
@Controller('totem-lotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemLotesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('lojas')
  @RequirePermissions('totem.ver')
  lojas(@CurrentUser() user: JwtUser) {
    return listarLojasDoLote(this.prisma, user);
  }

  @Get('produtos')
  @RequirePermissions('totem.ver')
  produtos(@CurrentUser() user: JwtUser) {
    return listarProdutosDoLote(this.prisma, user);
  }

  @Get('lotes')
  @RequirePermissions('totem.ver')
  lotes(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    const { produtoId } = TotemLotesFiltroSchema.parse(query);
    return listarLotes(this.prisma, user, produtoId);
  }

  @Post('lotes')
  @RequirePermissions('totem.lotes')
  criarLote(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return criarLote(this.prisma, user, TotemLoteNovoSchema.parse(body));
  }

  @Patch('lotes/:id')
  @RequirePermissions('totem.lotes')
  editarLote(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return editarLote(this.prisma, user, TotemLoteUuidSchema.parse(id), TotemLoteEdicaoSchema.parse(body));
  }

  @Get('remessas')
  @RequirePermissions('totem.ver')
  remessas(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return listarRemessas(this.prisma, user, TotemRemessasFiltroSchema.parse(query));
  }

  @Post('remessas')
  @RequirePermissions('totem.lotes')
  criarRemessa(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return criarRemessa(this.prisma, user, TotemRemessaNovaSchema.parse(body));
  }

  @Post('remessas/:id/receber')
  @RequirePermissions('totem.reposicao')
  receberRemessa(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return receberRemessa(
      this.prisma,
      user,
      TotemLoteUuidSchema.parse(id),
      TotemRemessaRecebimentoSchema.parse(body ?? {}),
    );
  }

  @Post('remessas/:id/cancelar')
  @RequirePermissions('totem.lotes')
  cancelarRemessa(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return cancelarRemessa(this.prisma, user, TotemLoteUuidSchema.parse(id));
  }

  @Get('reposicoes')
  @RequirePermissions('totem.ver')
  reposicoes(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return listarReposicoes(this.prisma, user, TotemLotePorLojaFiltroSchema.parse(query));
  }

  @Post('reposicoes')
  @RequirePermissions('totem.reposicao')
  registrarReposicao(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return registrarReposicao(this.prisma, user, TotemReposicaoNovaSchema.parse(body));
  }

  @Get('pendencias')
  @RequirePermissions('totem.ver')
  pendencias(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return pendenciasDasLojas(this.prisma, user, TotemLotePorLojaFiltroSchema.parse(query));
  }

  @Get('etiquetas')
  @RequirePermissions('totem.etiquetas')
  etiquetas(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return listarEtiquetas(this.prisma, user, TotemEtiquetasFiltroSchema.parse(query));
  }

  @Post('etiquetas')
  @RequirePermissions('totem.etiquetas')
  gerarEtiquetas(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return gerarEtiquetas(this.prisma, user, TotemEtiquetasNovasSchema.parse(body));
  }

  @Post('etiquetas/impressas')
  @RequirePermissions('totem.etiquetas')
  marcarImpressas(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return marcarEtiquetasImpressas(this.prisma, user, TotemEtiquetasImpressasSchema.parse(body).ids);
  }

  @Post('etiquetas/:id/revogar')
  @RequirePermissions('totem.etiquetas')
  revogarEtiqueta(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return revogarEtiqueta(this.prisma, user, TotemLoteUuidSchema.parse(id));
  }
}
