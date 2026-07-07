import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateUserSchema, UpdateUserSchema } from '@mktos/shared';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get('users')
  @RequirePermissions('admin.usuarios')
  list(@CurrentUser() user: JwtUser) {
    return this.svc.list(user.orgId);
  }

  @Get('roles')
  @RequirePermissions('admin.usuarios')
  roles(@CurrentUser() user: JwtUser) {
    return this.svc.roles(user.orgId);
  }

  @Post('users')
  @RequirePermissions('admin.usuarios')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateUserSchema.parse(body);
    return this.svc.create(user.orgId, input, user.sub);
  }

  @Patch('users/:id')
  @RequirePermissions('admin.usuarios')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateUserSchema.parse(body);
    return this.svc.update(user.orgId, id, input, user.sub);
  }
}
