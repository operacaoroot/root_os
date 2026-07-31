import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { LoginSchema } from '@mktos/shared';
import { AuthService } from './auth.service';
import { GoogleLoginService } from './google-login.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, JwtUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleLoginService,
  ) {}

  @Post('login')
  async login(@Body() body: unknown, @Req() req: any) {
    const { email, password } = LoginSchema.parse(body);
    return this.auth.login(email, password, req.ip);
  }

  // Login com o Google — PÚBLICOS: o browser sai daqui pro Google e volta sem token.
  @Get('google/start')
  googleStart(@Res() res: Response) {
    return res.redirect(this.google.authUrl());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    return res.redirect(await this.google.completeToRedirect(code, state, req.ip));
  }

  /** A tela de login usa p/ decidir se mostra o botão do Google. */
  @Get('google/disponivel')
  googleAvailable() {
    return { disponivel: this.google.configured };
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
