import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { EstadoDoConvitePublico } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { SoGenteNaAgendaGuard } from '../escrita/so-gente-na-agenda.guard';
import { TetoPorOrigem } from './convite-puro';
import { ConviteDaAgendaService, type ConviteDaLista, type RespostaDaConfirmacao } from './convite.service';

/**
 * O LINK DE ESCOLHA DENTRO DA CASA (agenda v2, 29/10/2026, lane G6).
 *
 * `POST /api/agenda/convites` — cria o convite e devolve `{ url, validoAte }`.
 *   `agenda.editar`, só gente. O token cru existe só nesta resposta.
 * `GET /api/agenda/convites` — os convites da empresa (sem token, sem hash).
 * `POST /api/agenda/convites/:id/revogar` — o link passa a responder 404.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda/convites')
export class ConviteDaAgendaController {
  constructor(private readonly convites: ConviteDaAgendaService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(SoGenteNaAgendaGuard)
  @RequirePermissions('agenda.editar')
  @Header('Cache-Control', 'no-store')
  criar(@CurrentUser() user: JwtUser, @Body() corpo: unknown) {
    return this.convites.criar(user.orgId, user.sub, corpo);
  }

  @Get()
  @RequirePermissions('dashboard.ver')
  listar(@CurrentUser() user: JwtUser): Promise<ConviteDaLista[]> {
    return this.convites.listar(user.orgId);
  }

  @Post(':id/revogar')
  @HttpCode(200)
  @UseGuards(SoGenteNaAgendaGuard)
  @RequirePermissions('agenda.editar')
  revogar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.convites.revogar(user.orgId, id);
  }
}
