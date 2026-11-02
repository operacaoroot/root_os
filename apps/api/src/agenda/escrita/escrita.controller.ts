import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import type { LinhaDoHistorico, ResultadoDaEscrita } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { EscritaDaAgendaService } from './escrita.service';
import { SoGenteNaAgendaGuard } from './so-gente-na-agenda.guard';

const ID_DO_EVENTO = /^[A-Za-z0-9_@.-]{3,1024}$/;

/**
 * A ESCRITA DA AGENDA PELA TELA (agenda v2, 29/10/2026, lane G4, decisão 2).
 *
 * `POST /api/agenda/escritas` — um `PedidoDeEscrita` (marcar, alterar, cancelar,
 *   desmarcar, reabrir). `agenda.editar`, só gente (token e banco). É o ÚNICO
 *   lugar que põe `naTela: true`, e só depois de reler no banco que quem pediu é
 *   pessoa ativa desta empresa: o corpo não tem como pedir isso (o esquema é
 *   estrito e recusa um `naTela` no corpo). Com a aprovação de R2 da empresa
 *   desligada (sobrescrita assinada), o R2 sai no clique; sem ela, vai à fila de
 *   `/atendimento` como sempre. R3 (reabrir) nunca sai no clique.
 * `GET /api/agenda/historico?eventoId=&limite=` — o que o OS gravou no Google,
 *   por quem, com o desfazer onde existe. `dashboard.ver`, a mesma da tela.
 * `GET /api/agenda/aprovacao-r2` — o cartão de Configurações (só leitura).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda')
export class EscritaDaAgendaController {
  constructor(private readonly escrita: EscritaDaAgendaService) {}

  @Post('escritas')
  @HttpCode(200)
  @UseGuards(SoGenteNaAgendaGuard)
  @RequirePermissions('agenda.editar')
  async escrever(@CurrentUser() user: JwtUser, @Body() corpo: unknown): Promise<ResultadoDaEscrita> {
    const gente = await this.escrita.ehGente(user.orgId, user.sub);
    return this.escrita.executar({ orgId: user.orgId, actorType: 'user', actorId: user.sub, naTela: gente }, corpo);
  }

  @Get('historico')
  @RequirePermissions('dashboard.ver')
  historico(
    @CurrentUser() user: JwtUser,
    @Query('eventoId') eventoId?: string,
    @Query('limite') limite?: string,
  ): Promise<LinhaDoHistorico[]> {
    const id = eventoId && ID_DO_EVENTO.test(eventoId) ? eventoId : null;
    return this.escrita.historico(user.orgId, { eventoId: id, limite: limite ? Number(limite) : undefined });
  }

  @Get('aprovacao-r2')
  @RequirePermissions('dashboard.ver')
  aprovacaoR2(@CurrentUser() user: JwtUser) {
    return this.escrita.aprovacaoR2(user.orgId);
  }
}
