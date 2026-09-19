import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { LoginSchema } from '@mktos/shared';
import { AuthService } from './auth.service';
import { GoogleLoginService } from './google-login.service';
import { ReauthService } from './reauth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, JwtUser } from './current-user.decorator';
import { enderecoDeOrigem } from './endereco-de-origem';
import { AgentTokenService, AGENT_TOKEN_SCOPES } from './agent-token.service';

/*
 * A REAUTENTICAÇÃO É PRESA A UMA APROVAÇÃO, e por isso o `aprovacaoId` é
 * obrigatório: sem ele a prova viraria um passe genérico de cinco minutos, e
 * quem digitasse a senha uma vez carimbaria qualquer R4 que aparecesse na
 * janela. Ver `reauth.service.ts`.
 */
const ReautenticarSchema = z
  .object({
    senha: z.string().min(1),
    aprovacaoId: z.string().min(1),
  })
  .strict();

const EmitirAgentTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(AGENT_TOKEN_SCOPES)).min(1).max(AGENT_TOKEN_SCOPES.length),
    validadeDias: z.number().int().min(1).max(30).default(30),
  })
  .strict();

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleLoginService,
    private readonly reauth: ReauthService,
    private readonly agentTokens: AgentTokenService,
  ) {}

  @Post('login')
  async login(@Body() body: unknown, @Req() req: any) {
    const { email, password } = LoginSchema.parse(body);
    return this.auth.login(email, password, enderecoDeOrigem(req));
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
    return res.redirect(await this.google.completeToRedirect(code, state, enderecoDeOrigem(req)));
  }

  /** A tela de login usa p/ decidir se mostra o botão do Google. */
  @Get('google/disponivel')
  googleAvailable() {
    return { disponivel: this.google.configured };
  }

  /**
   * Troca a senha do próprio usuário por uma PROVA curta para aprovar uma ação
   * de R4/R5 (RF-A-03). A tela pede a senha uma vez e apresenta a prova em
   * `POST /approvals/:id/confirm` — assim a senha não trafega no corpo da rota
   * de aprovação. Quem prefere mandar a senha direto na confirmação também pode:
   * as duas formas passam pelo mesmo `ReauthService`.
   *
   * `sub` e `orgId` vêm do TOKEN, nunca do corpo: ninguém reautentica por outro.
   */
  @UseGuards(JwtAuthGuard)
  @Post('reautenticar')
  reautenticar(@CurrentUser() user: JwtUser, @Body() body: unknown, @Req() req: any) {
    const { senha, aprovacaoId } = ReautenticarSchema.parse(body);
    return this.reauth.provar({
      userId: user.sub,
      orgId: user.orgId,
      senha,
      aprovacaoId,
      ip: enderecoDeOrigem(req),
    });
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

  /** Tokens são geridos pelo próprio usuário; não há rota de admin para terceiros. */
  @UseGuards(JwtAuthGuard)
  @Post('agent-tokens')
  emitirAgentToken(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = EmitirAgentTokenSchema.parse(body);
    return this.agentTokens.emitir(user.orgId, user.sub, input);
  }

  @UseGuards(JwtAuthGuard)
  @Get('agent-tokens')
  listarAgentTokens(@CurrentUser() user: JwtUser) {
    return this.agentTokens.listar(user.orgId, user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('agent-tokens/:id/revogar')
  revogarAgentToken(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.agentTokens.revogar(user.orgId, user.sub, id);
  }
}
