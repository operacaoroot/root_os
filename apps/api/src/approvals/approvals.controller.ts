import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
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
  constructor(private readonly approvals: ApprovalsService) {}

  @Post()
  @RequirePermissions('mcp.executar')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateApprovalSchema.parse(body);
    return this.approvals.create({ orgId: user.orgId, actorId: user.sub, ...input });
  }

  @Post(':id/confirm')
  @RequirePermissions('mcp.executar')
  confirm(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.approvals.confirm(user.orgId, id, user.sub);
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
