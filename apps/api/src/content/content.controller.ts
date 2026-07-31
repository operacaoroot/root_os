import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UpdateContentSchema } from '@mktos/shared';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('content')
export class ContentController {
  constructor(private readonly svc: ContentService) {}

  @Get()
  @RequirePermissions('dashboard.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: string,
    @Query('eixo') eixo?: string,
    @Query('formato') formato?: string,
  ) {
    return this.svc.list(user.orgId, { status, eixo, formato });
  }

  @Get('stats')
  @RequirePermissions('dashboard.ver')
  stats(@CurrentUser() user: JwtUser) {
    return this.svc.stats(user.orgId);
  }

  // Muda a etapa do tema (write-back no ClickUp). Reusa tarefas.editar (edição operacional).
  @Patch(':id')
  @RequirePermissions('tarefas.editar')
  @SensitiveWrite('content')
  @UseGuards(ApprovalGuard)
  setStatus(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateContentSchema.parse(body);
    return this.svc.setStatus(user.orgId, id, input.status, user.sub);
  }
}
