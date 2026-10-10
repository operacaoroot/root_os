import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { MarketingPreparacaoService } from './marketing-preparacao.service';

const uuid = z.string().uuid();
export const MarketingAccountSchema = z.object({
  requestId: uuid, connectionId: uuid, ownerId: uuid,
  operators: z.array(uuid).max(30).default([]),
}).strict();
export const MarketingPrepareSchema = z.object({
  requestId: uuid, accountId: uuid, expectedAccountRevision: z.number().int().positive(),
  taskId: uuid, versionId: uuid, decisionId: uuid,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  scheduledAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(80).refine((v) => {
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: v }); return true; } catch { return false; }
  }, 'Fuso horário inválido.'),
}).strict();

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/preparacao')
export class MarketingPreparacaoController {
  constructor(private readonly service: MarketingPreparacaoService) {}
  @Get()
  @RequirePermissions('pauta.ver')
  listar(@CurrentUser() user: JwtUser) { return this.service.listar(user.orgId, user.sub); }
  @Get('configuracao')
  @RequirePermissions('bio.editar', 'admin.usuarios')
  configuracao(@CurrentUser() user: JwtUser) { return this.service.configuracao(user.orgId, user.sub); }
  @Get('contas/escopo')
  @RequirePermissions('bio.editar', 'admin.usuarios')
  escopoDeConta(@CurrentUser() user: JwtUser) { return this.service.escopoDeConta(user.orgId, user.sub); }
  @Get('escopo')
  @RequirePermissions('pauta.ver', 'tarefas.ver')
  escopoDePreparo(@CurrentUser() user: JwtUser) { return this.service.escopoDePreparo(user.orgId, user.sub); }
  @Get('contas/pedidos/:requestId')
  @RequirePermissions('bio.editar', 'admin.usuarios')
  contaPorPedido(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string) {
    return this.service.contaPorPedido(user.orgId, user.sub, uuid.parse(requestId));
  }
  @Get('pedidos/:requestId')
  @RequirePermissions('pauta.ver', 'tarefas.ver')
  preparoPorPedido(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string) {
    return this.service.preparoPorPedido(user.orgId, user.sub, uuid.parse(requestId));
  }
  @Post('contas')
  @RequirePermissions('bio.editar', 'admin.usuarios')
  configurar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.service.configurar(user.orgId, user.sub, MarketingAccountSchema.parse(body));
  }
  @Put('contas/:id/disponibilidade')
  @RequirePermissions('bio.editar', 'admin.usuarios')
  disponibilidade(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = z.object({ active: z.boolean(), expectedRevision: z.number().int().positive() }).strict().parse(body);
    return this.service.disponibilidade(user.orgId, user.sub, id, input);
  }
  @Post()
  @RequirePermissions('pauta.editar', 'pauta.publicar', 'tarefas.ver', 'tarefas.editar')
  preparar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.service.preparar(user.orgId, user.sub, MarketingPrepareSchema.parse(body));
  }
  @Get(':id')
  @RequirePermissions('pauta.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('id') id: string) { return this.service.detalhe(user.orgId, user.sub, id); }
}
