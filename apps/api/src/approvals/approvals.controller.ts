import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApprovalState } from '@prisma/client';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
import { AcoesService } from '../gateway/acoes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

const CreateApprovalSchema = z.object({
  resourceType: z.enum(['lead', 'task', 'campaign', 'content']),
  resourceId: z.string().min(1),
  changes: z.record(z.unknown()),
  summary: z.string().optional(),
});

// Fluxo de aprovação de ação sensível (proposta → confirmação humana → escrita).
// A escrita real (PATCH /leads etc.) exige o token emitido aqui (ver ApprovalGuard).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly acoes: AcoesService,
  ) {}

  /*
   * A FILA. Existia proposta, confirmação e consulta por id, mas não existia
   * "o que está esperando" — e sem isso a fila não é superfície de trabalho,
   * é uma caixa que só quem já sabe o id consegue abrir.
   */
  @Get()
  @RequirePermissions('mcp.executar')
  listar(@CurrentUser() user: JwtUser, @Query('status') status?: string) {
    const valido = status && (Object.values(ApprovalState) as string[]).includes(status);
    return this.approvals.listar(
      user.orgId,
      valido ? (status as ApprovalState) : ApprovalState.pendente,
    );
  }

  @Post()
  @RequirePermissions('mcp.executar')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateApprovalSchema.parse(body);
    return this.approvals.create({ orgId: user.orgId, actorId: user.sub, ...input });
  }

  /*
   * Confirmar EXECUTA. Sem isto a fila era um museu: a ação ficava retida,
   * alguém confirmava, e nada saía.
   *
   * A execução usa os argumentos gravados na passagem pela porta, nunca os que
   * chegam nesta requisição — é o que impede trocar o texto entre a aprovação
   * e o envio.
   */
  @Post(':id/confirm')
  @RequirePermissions('mcp.executar')
  async confirm(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const confirmada = await this.approvals.confirm(user.orgId, id, user.sub);
    const execucao = await this.acoes.executarAprovada(user.orgId, id, user.sub);
    return { ...confirmada, execucao };
  }

  @Post(':id/reject')
  @RequirePermissions('mcp.executar')
  reject(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.approvals.reject(user.orgId, id, user.sub);
  }

  @Get(':id')
  @RequirePermissions('mcp.executar')
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.approvals.get(user.orgId, id);
  }
}
