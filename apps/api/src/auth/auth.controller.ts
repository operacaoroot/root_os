import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { LoginSchema } from '@mktos/shared';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, JwtUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: unknown, @Req() req: any) {
    const { email, password } = LoginSchema.parse(body);
    return this.auth.login(email, password, req.ip);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return {
      id: user.sub,
      name: user.name,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };
  }
}
