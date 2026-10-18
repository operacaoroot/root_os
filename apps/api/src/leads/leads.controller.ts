import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  LeadDecisaoSchema,
  LeadEntradaSchema,
  LeadPropostaRegistroSchema,
  LeadTrocaDeDonoSchema,
  UpdateLeadSchema,
} from '@mktos/shared';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { ComercialExercicioService } from './comercial-exercicio.service';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly svc: LeadsService, private readonly exercicio: ComercialExercicioService) {}

  @Post('exercicio/entrada')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  entradaExercicio(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.exercicio.entrada(user, body);
  }

  @Get('exercicio/entregas/:taskId')
  @RequirePermissions('leads.ver', 'tarefas.ver')
  origemDaEntrega(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string) {
    return this.exercicio.origemDaEntrega(user, taskId);
  }

  @Get(':id/exercicio')
  @RequirePermissions('leads.ver')
  lerExercicio(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.exercicio.ler(user, id);
  }

  @Post(':id/exercicio/acompanhamento')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  acompanharExercicio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.exercicio.acompanhar(user, id, body);
  }

  @Post(':id/exercicio/propostas')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  propostaExercicio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.exercicio.proposta(user, id, body);
  }

  @Post(':id/exercicio/aceites')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.ver')
  aceitarExercicio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.exercicio.aceitar(user, id, body);
  }

  @Post(':id/exercicio/entrega')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.ver', 'tarefas.editar')
  entregaExercicio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.exercicio.entregar(user, id, body);
  }

  @Get()
  @RequirePermissions('leads.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: string,
    @Query('period') period?: string,
  ) {
    return this.svc.list(user.orgId, { status, period });
  }

  /**
   * Entrada idempotente de lead (ROOT-48). Declarada ANTES de `:id` e fora do
   * `SensitiveWrite`: não toca etapa nem próxima ação. Origem da Pauta soma
   * `pauta.ver` e o módulo `pauta`, conferidos no serviço depois do parse.
   */
  @Post('entrada')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  entrada(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = LeadEntradaSchema.parse(body);
    return this.svc.entrada({ sub: user.sub, orgId: user.orgId, permissions: user.permissions }, input);
  }

  @Get(':id')
  @RequirePermissions('leads.ver')
  getOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.getOne(user.orgId, id, user.permissions);
  }

  /** Troca de dono: sem aprovação, com motivo opcional, evento e auditoria (ver `LeadsService.trocarDono`). */
  @Put(':id/dono')
  @RequirePermissions('leads.editar')
  trocarDono(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = LeadTrocaDeDonoSchema.parse(body);
    return this.svc.trocarDono(user.orgId, id, input, user.sub);
  }

  /**
   * Proposta e aceite comercial (ROOT-49, C-03). Ler o estado pede `leads.ver`;
   * ler as condições do card e registrar proposta ou decisão pedem também
   * `tarefas.ver` (R1: todas as permissões listadas). O módulo `trabalho` se
   * confere no serviço (E15). Fora do `SensitiveWrite`, como a entrada e o
   * dono: registrar a decisão do cliente não muda etapa nem dispara nada fora
   * do OS, e é idempotente por conteúdo.
   */
  @Get(':id/proposta')
  @RequirePermissions('leads.ver')
  lerProposta(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.lerProposta(user.orgId, id);
  }

  @Get(':id/proposta/condicoes')
  @RequirePermissions('leads.ver', 'tarefas.ver')
  lerCondicoes(@CurrentUser() user: JwtUser, @Param('id') id: string, @Query('cardId') cardId?: string) {
    return this.svc.lerCondicoes(user.orgId, id, LeadPropostaRegistroSchema.shape.cardId.parse(cardId));
  }

  @Post(':id/proposta')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.ver')
  registrarProposta(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = LeadPropostaRegistroSchema.parse(body);
    return this.svc.registrarProposta({ sub: user.sub, orgId: user.orgId, permissions: user.permissions }, id, input);
  }

  @Post(':id/aceite')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.ver')
  decidir(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = LeadDecisaoSchema.parse(body);
    return this.svc.decidir({ sub: user.sub, orgId: user.orgId, permissions: user.permissions }, id, input);
  }

  @Patch(':id')
  @RequirePermissions('leads.editar')
  @SensitiveWrite('lead')
  @UseGuards(ApprovalGuard)
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateLeadSchema.parse(body);
    return this.svc.update(user.orgId, id, input, user.sub);
  }
}
