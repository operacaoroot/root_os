import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ConversaAberta, ConversaDaCaixa, ListaDaCaixa, RespostaEnviada } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CaixaDoWhatsappService, type QuemNaCaixa } from './caixa.service';

/** Recusa conta de máquina pelo token, antes de qualquer leitura (o serviço relê no banco). */
@Injectable()
export class SoGenteNaCaixaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) {
      throw new ForbiddenException('Responder pelo WhatsApp é de gente: conta de serviço (IA) não conversa pela caixa.');
    }
    return true;
  }
}

/**
 * Rotas `/whatsapp/conversas` (produção 22C, W2): a caixa de WhatsApp.
 *
 *   · `GET /`              lista, filtros, busca e contagens       (`leads.ver`)
 *   · `GET /:id`           a conversa, paginada para trás          (`leads.ver`)
 *   · `POST /:id/lida`     marca como lida ao abrir                (`leads.ver`)
 *   · `POST /:id/arquivar` tira ou volta da lista, auditado        (`whatsapp.conversar`, só gente)
 *   · `POST /:id/responder` texto de uma pessoa pela Evolution     (`whatsapp.conversar`, só gente)
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/conversas')
export class CaixaDoWhatsappController {
  constructor(private readonly svc: CaixaDoWhatsappService) {}

  @Get()
  @RequirePermissions('leads.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('filtro') filtro?: string,
    @Query('q') q?: string,
    @Query('limite') limite?: string,
  ): Promise<ListaDaCaixa> {
    return this.svc.listar(user.orgId, { filtro, q, limite }, quem(user));
  }

  @Get(':id')
  @RequirePermissions('leads.ver')
  abrir(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('antesDe') antesDe?: string,
    @Query('antesDeId') antesDeId?: string,
    @Query('limite') limite?: string,
  ): Promise<ConversaAberta> {
    return this.svc.abrir(user.orgId, id, { antesDe, antesDeId, limite }, quem(user));
  }

  @Post(':id/lida')
  @HttpCode(200)
  @RequirePermissions('leads.ver')
  // Revisão 22C (A5): marcar como lida é de gente; conta de máquina (o MCP tem leads.ver) não zera as não lidas da equipe.
  @UseGuards(SoGenteNaCaixaGuard)
  lida(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ lidas: number }> {
    return this.svc.marcarLida(user.orgId, id, { id: user.sub });
  }

  @Post(':id/arquivar')
  @HttpCode(200)
  @RequirePermissions('whatsapp.conversar')
  @UseGuards(SoGenteNaCaixaGuard)
  arquivar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<ConversaDaCaixa> {
    return this.svc.arquivar(user.orgId, id, body, quem(user));
  }

  @Post(':id/responder')
  @HttpCode(200)
  @RequirePermissions('whatsapp.conversar')
  @UseGuards(SoGenteNaCaixaGuard)
  responder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<RespostaEnviada> {
    return this.svc.responder(user.orgId, id, body, quem(user));
  }
}

function quem(user: JwtUser): QuemNaCaixa {
  return { id: user.sub, papeis: user.roles ?? [], permissoes: user.permissions ?? [] };
}
