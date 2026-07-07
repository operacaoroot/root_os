import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

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
}
