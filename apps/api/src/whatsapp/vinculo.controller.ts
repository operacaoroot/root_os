import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Optional, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { CandidatoDeVinculo, WhatsappDaFicha } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { VinculoDoWhatsappService, type ResultadoDoVinculo } from './vinculo.service';
import { ResumoDoWhatsappService } from './resumo.service';

/*
 * `/whatsapp/vinculos` (rodada de produção 4, W3, 22/10/2026): o vínculo da
 * conversa de WhatsApp com lead e cliente, e o telefone do lead e do cliente.
 *
 * Ler pede `leads.ver`. Toda escrita pede `leads.editar` e é de GENTE: a conta
 * de máquina cai no guarda pelo token (`SoGenteNoVinculoGuard`) e, no serviço,
 * na releitura do banco (ativa, desta empresa, com `leads.editar` agora). Toda
 * escrita é auditada. O prefixo `whatsapp` é do módulo `leads`.
 */

const RECUSA_DE_MAQUINA = 'Vincular conversa é de gente: conta de serviço (IA) não liga conversa a lead ou cliente.';

/** Recusa conta de máquina pelo token, antes de qualquer leitura. */
@Injectable()
export class SoGenteNoVinculoGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    return true;
  }
}

function quem(user: JwtUser) {
  return { id: user.sub, papeis: user.roles ?? [] };
}

function podeEditar(user: JwtUser): boolean {
  return (user.permissions ?? []).includes('leads.editar') && !temPapelDeMaquina(user.roles ?? []);
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/vinculos')
export class VinculoDoWhatsappController {
  constructor(
    private readonly svc: VinculoDoWhatsappService,
    /** O cartão do Dia a dia (W4): o vínculo muda a faixa das não lidas, e o cache de 30 s é esquecido. */
    @Optional() private readonly resumo?: ResumoDoWhatsappService,
  ) {}

  private async eEsquece<T>(orgId: string, p: Promise<T>): Promise<T> {
    const r = await p;
    this.resumo?.esquecer(orgId);
    return r;
  }

  /** A busca de vínculo (`tipo` = lead ou cliente, opcional): o igual ao nome da conversa primeiro, até 20. */
  @Get('candidatos')
  @RequirePermissions('leads.ver')
  candidatos(@CurrentUser() user: JwtUser, @Query('conversaId') conversaId?: string, @Query('q') q?: string, @Query('tipo') tipo?: string): Promise<CandidatoDeVinculo[]> {
    return this.svc.candidatos(user.orgId, { conversaId: conversaId || null, q: q ?? null, tipo: tipo ?? null });
  }

  /** As conversas do lead (aba WhatsApp do painel). */
  @Get('lead/:leadId')
  @RequirePermissions('leads.ver')
  doLead(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string): Promise<WhatsappDaFicha> {
    return this.svc.doLead(user.orgId, leadId, podeEditar(user));
  }

  /** As conversas do cliente (bloco WhatsApp da ficha do cliente). */
  @Get('cliente/:clienteId')
  @RequirePermissions('leads.ver')
  doCliente(@CurrentUser() user: JwtUser, @Param('clienteId') clienteId: string): Promise<WhatsappDaFicha> {
    return this.svc.doCliente(user.orgId, clienteId, podeEditar(user));
  }

  /** A ficha (cartão) do cliente, para o link "Cliente: <nome>" da caixa: `{ taskId }` ou nulo. */
  @Get('cliente/:clienteId/ficha')
  @RequirePermissions('leads.ver')
  fichaDoCliente(@CurrentUser() user: JwtUser, @Param('clienteId') clienteId: string): Promise<{ taskId: string | null }> {
    return this.svc.fichaDoCliente(user.orgId, clienteId);
  }

  /** Editar o telefone do lead (`Lead.phone`); depois as conversas 1:1 do número casam de novo. */
  @Put('lead/:leadId/telefone')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  telefoneDoLead(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown) {
    return this.eEsquece(user.orgId, this.svc.definirTelefone(user.orgId, 'lead', leadId, body, quem(user)));
  }

  /** Editar o telefone do cliente (`Partner.phone`). */
  @Put('cliente/:clienteId/telefone')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  telefoneDoCliente(@CurrentUser() user: JwtUser, @Param('clienteId') clienteId: string, @Body() body: unknown) {
    return this.eEsquece(user.orgId, this.svc.definirTelefone(user.orgId, 'cliente', clienteId, body, quem(user)));
  }

  /** Vincular a lead ou a cliente: `{ tipo, id }`. */
  @Post(':conversaId')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  vincular(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.vincular(user.orgId, conversaId, body, quem(user)));
  }

  /** Integração 26/10: cadastrar o cliente que ainda não existe e vincular a conversa: `{ nome }`. */
  @Post(':conversaId/cliente-novo')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  cadastrarCliente(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.cadastrarClienteEVincular(user.orgId, conversaId, body, quem(user)));
  }

  /** Aceitar a sugestão gravada (um clique). */
  @Post(':conversaId/sugestao')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  aceitarSugestao(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.aceitarSugestao(user.orgId, conversaId, quem(user)));
  }

  @Post(':conversaId/desvincular')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  desvincular(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.desvincular(user.orgId, conversaId, quem(user)));
  }

  /** Marcar ou tirar da equipe: `{ equipe }`. */
  @Post(':conversaId/equipe')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  equipe(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.marcarEquipe(user.orgId, conversaId, body, quem(user)));
  }

  /** "Este número não está em nenhum lead; pôr no lead X?": `{ leadId, substituir? }`. */
  @Post(':conversaId/telefone-no-lead')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNoVinculoGuard)
  telefoneNoLead(@CurrentUser() user: JwtUser, @Param('conversaId') conversaId: string, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.eEsquece(user.orgId, this.svc.telefoneNoLead(user.orgId, conversaId, body, quem(user)));
  }
}
