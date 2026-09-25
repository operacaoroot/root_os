import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PautaPrepararAprovacaoSchema } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { LoteDaSemanaService } from './lote-da-semana.service';

/*
 * MD8: aprovar a semana num ponto só. Montar o lote e cancelar a semana são
 * `pauta.publicar` (quem responde pelo que vai ao ar); pedir a assinatura é a
 * rota da MD7, `POST /approvals/lotes/:id/pedir-assinatura`. O conteúdo que a
 * titular lê em /atendimento é `aprovacoes.decidir`: o conteúdo exato vai só
 * para quem pode decidir (a regra do Pedro em `approvals.controller.ts`), e quem
 * tem só `aprovacoes.ver` vê a fila sem ele.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class LoteDaSemanaController {
  constructor(private readonly semana: LoteDaSemanaService) {}

  @Get('episodios/:id/semana/aprovacao')
  @RequirePermissions('pauta.ver')
  estado(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.semana.estado(user.orgId, id, user.sub);
  }

  @Post('episodios/:id/semana/preparar-aprovacao')
  @RequirePermissions('pauta.publicar')
  preparar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { fora } = PautaPrepararAprovacaoSchema.parse(body ?? {});
    return this.semana.preparar(user.orgId, id, user.sub, fora);
  }

  @Post('lotes/:id/cancelar')
  @RequirePermissions('pauta.publicar')
  cancelar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.semana.cancelar(user.orgId, id, user.sub);
  }

  @Get('lotes/:id/conteudo')
  @RequirePermissions('aprovacoes.decidir')
  conteudo(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.semana.conteudo(user.orgId, id);
  }
}
