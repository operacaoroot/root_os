import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { LeadEntradaSchema, LeadTrocaDeDonoSchema, UpdateLeadSchema } from '@mktos/shared';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly svc: LeadsService) {}

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

  @Patch(':id')
  @RequirePermissions('leads.editar')
  @SensitiveWrite('lead')
  @UseGuards(ApprovalGuard)
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateLeadSchema.parse(body);
    return this.svc.update(user.orgId, id, input, user.sub);
  }
}
