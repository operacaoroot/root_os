import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  AjusteDoAtendimentoSchema,
  ConversaEditarSchema,
  EncerrarSchema,
  FILTROS_DE_CONVERSA,
  type FiltroDeConversa,
  ResponderSchema,
  VirarTarefaSchema,
} from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AtendimentoService } from './atendimento.service';

/**
 * Dia a dia › Conversas. Três permissões, separadas de propósito:
 *   · `atendimento.ver`        ler conversas e anexos, marcar como lida;
 *   · `atendimento.responder`  propor resposta (sai só com assinatura de OUTRA
 *                              pessoa), responsável, cliente, encerrar, tarefa;
 *   · `atendimento.configurar` ligar e desligar a caixa da empresa.
 * A empresa vem sempre do token: nenhuma rota aceita `orgId` de fora.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('atendimento')
export class AtendimentoController {
  constructor(private readonly svc: AtendimentoService) {}

  @Get('estado')
  @RequirePermissions('atendimento.ver')
  estado(@CurrentUser() u: JwtUser) {
    return this.svc.estado(u.orgId);
  }

  @Put('ajuste')
  @RequirePermissions('atendimento.configurar')
  ajustar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.ajustar(u.orgId, u.sub, AjusteDoAtendimentoSchema.parse(body).ativo);
  }

  @Get('apoio')
  @RequirePermissions('atendimento.ver')
  apoio(@CurrentUser() u: JwtUser) {
    return this.svc.apoio(u.orgId);
  }

  @Get('conversas')
  @RequirePermissions('atendimento.ver')
  conversas(
    @CurrentUser() u: JwtUser,
    @Query('filtro') filtro?: string,
    @Query('busca') busca?: string,
    @Query('pagina') pagina?: string,
  ) {
    const f: FiltroDeConversa = (FILTROS_DE_CONVERSA as readonly string[]).includes(filtro ?? '')
      ? (filtro as FiltroDeConversa)
      : 'todas';
    const p = Math.max(0, Math.min(1000, Number.parseInt(pagina ?? '0', 10) || 0));
    return this.svc.conversas(u.orgId, u.sub, f, busca, p);
  }

  @Get('conversas/:id')
  @RequirePermissions('atendimento.ver')
  conversa(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.conversa(u.orgId, id);
  }

  @Get('conversas/:id/mensagens')
  @RequirePermissions('atendimento.ver')
  mensagens(@CurrentUser() u: JwtUser, @Param('id') id: string, @Query('antes') antes?: string) {
    return this.svc.mensagens(u.orgId, id, antes);
  }

  @Post('conversas/:id/lida')
  @RequirePermissions('atendimento.ver')
  lida(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.marcarLida(u.orgId, id);
  }

  @Patch('conversas/:id')
  @RequirePermissions('atendimento.responder')
  editar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editar(u.orgId, u.sub, id, ConversaEditarSchema.parse(body));
  }

  @Post('conversas/:id/encerrar')
  @RequirePermissions('atendimento.responder')
  encerrar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.encerrar(u.orgId, u.sub, id, EncerrarSchema.parse(body).versao, true);
  }

  @Post('conversas/:id/reabrir')
  @RequirePermissions('atendimento.responder')
  reabrir(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.encerrar(u.orgId, u.sub, id, EncerrarSchema.parse(body).versao, false);
  }

  @Post('conversas/:id/responder')
  @RequirePermissions('atendimento.responder')
  responder(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.responder(u.orgId, u.sub, id, ResponderSchema.parse(body));
  }

  @Get('mensagens/busca')
  @RequirePermissions('atendimento.ver')
  buscar(@CurrentUser() u: JwtUser, @Query('q') q?: string) {
    return this.svc.buscarMensagens(u.orgId, q ?? '');
  }

  @Post('mensagens/:id/tarefa')
  @RequirePermissions('atendimento.responder', 'tarefas.editar')
  virarTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.virarTarefa(u.orgId, u.sub, id, VirarTarefaSchema.parse(body));
  }

  /** O anexo, servido pela própria API: o MinIO não é público. */
  @Get('mensagens/:id/anexo')
  @RequirePermissions('atendimento.ver')
  async anexo(@CurrentUser() u: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const a = await this.svc.anexo(u.orgId, id);
    res.setHeader('Content-Type', a.tipo);
    if (a.size) res.setHeader('Content-Length', a.size);
    const nome = a.nome ?? `anexo-${id.slice(0, 8)}`;
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    a.stream.pipe(res);
  }
}
