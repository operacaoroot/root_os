import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: string,
    @Query('overdue') overdue?: string,
  ) {
    return this.svc.list(user.orgId, { status, overdue: overdue === '1' || overdue === 'true' });
  }
}
