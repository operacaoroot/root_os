import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ChangePasswordSchema } from '@mktos/shared';
import { ConfigService } from './config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('config')
export class ConfigController {
  constructor(private readonly svc: ConfigService) {}

  @Get()
  @RequirePermissions('dashboard.ver')
  overview(@CurrentUser() user: JwtUser) {
    return this.svc.overview(user.orgId);
  }

  // Trocar a PRÓPRIA senha — qualquer usuário logado (basta dashboard.ver).
  @Post('password')
  @RequirePermissions('dashboard.ver')
  changePassword(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = ChangePasswordSchema.parse(body);
    return this.svc.changePassword(user.sub, user.orgId, input.currentPassword, input.newPassword);
  }
}
