import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { ForaDoPadraoDaAgenda } from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { VigiaDaAgendaService } from './vigia-da-agenda.service';

/** O mesmo formato que o `argsSchema` de `agenda.evento.padronizar` exige do id do evento. */
const ID_DO_EVENTO = /^[A-Za-z0-9_@.-]{3,1024}$/;

/**
 * O VIGIA DA AGENDA NA TELA `/agenda` (AG-01, rodada dos agentes, 21/10/2026).
 *
 * `GET /api/agenda/fora-do-padrao` — o selo "N fora do padrão" e a lista, com a
 *   proposta de cada reunião (ou a pendência, quando o vigia não teve proposta
 *   segura). Ver: `dashboard.ver`, a mesma da tela.
 * `POST /api/agenda/padronizar/:eventoId` — "aprovar aqui": leva à MESMA porta
 *   (`agenda.evento.padronizar`, R3). Devolve a aprovação viva que o vigia já
 *   abriu, ou abre uma em nome de quem clicou — e aí quem confirma é OUTRA
 *   pessoa, em `/atendimento`. Marcar: `agenda.editar`, a mesma de marcar
 *   reunião.
 * `POST /api/agenda/restaurar/:eventoId` `{tituloAtual, tituloOriginal}` —
 *   desfaz a padronização (produção 22, `agenda.evento.restaurar`, R3) pela
 *   mesma porta: retida, outra pessoa confirma. Mesma permissão.
 *
 * O prefixo `agenda` é espinha (`tenants/modulos.ts`), como o `google`: a
 * agenda da Root não é módulo que uma empresa contrata.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda')
export class AgendaController {
  constructor(private readonly vigia: VigiaDaAgendaService) {}

  @Get('fora-do-padrao')
  @RequirePermissions('dashboard.ver')
  foraDoPadrao(@CurrentUser() user: JwtUser): Promise<ForaDoPadraoDaAgenda> {
    return this.vigia.listar(user.orgId);
  }

  @Post('padronizar/:eventoId')
  @HttpCode(200)
  @RequirePermissions('agenda.editar')
  padronizar(
    @CurrentUser() user: JwtUser,
    @Param('eventoId') eventoId: string,
    @Headers('x-approval-token') token?: string,
  ): Promise<Record<string, unknown>> {
    if (!ID_DO_EVENTO.test(eventoId ?? '')) throw new BadRequestException('Esse não é um id de evento do Google Agenda.');
    return this.vigia.pedirAprovacao(user.orgId, eventoId, { id: user.sub }, token);
  }

  @Post('restaurar/:eventoId')
  @HttpCode(200)
  @RequirePermissions('agenda.editar')
  restaurar(
    @CurrentUser() user: JwtUser,
    @Param('eventoId') eventoId: string,
    @Body() corpo: { tituloAtual?: unknown; tituloOriginal?: unknown },
    @Headers('x-approval-token') token?: string,
  ): Promise<Record<string, unknown>> {
    if (!ID_DO_EVENTO.test(eventoId ?? '')) throw new BadRequestException('Esse não é um id de evento do Google Agenda.');
    const tituloAtual = typeof corpo?.tituloAtual === 'string' ? corpo.tituloAtual.trim() : '';
    const tituloOriginal = typeof corpo?.tituloOriginal === 'string' ? corpo.tituloOriginal : '';
    if (!tituloAtual || tituloAtual.length > 300 || tituloOriginal.length > 500) {
      throw new BadRequestException('Diga o título de agora (até 300 caracteres) e o título original guardado (até 500).');
    }
    return this.vigia.pedirRestauracao(user.orgId, eventoId, { tituloAtual, tituloOriginal }, { id: user.sub }, token);
  }
}
