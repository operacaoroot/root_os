import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleService } from './google.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleLoginService, LOGIN_STATE_PREFIX } from '../auth/google-login.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * ============================================================================
 * O CICLO DE VIDA DA CREDENCIAL DO GOOGLE — e por que ele NÃO passa pela porta
 * ============================================================================
 *
 * Este arquivo foi separado do `GoogleController` na fatia 3.3. A separação não
 * é cosmética: ela existe para que a única exceção que sobra na catraca de
 * arquitetura seja PRECISA em vez de ampla.
 *
 * Antes, um arquivo só importava o `GoogleService` e nele conviviam quatro
 * escritas externas, cinco leituras e as rotas de conexão. A exceção declarada
 * cobria tudo, e ninguém que a lesse conseguia dizer o que ainda estava
 * descoberto. Agora as ações moraram para `google.controller.ts`, que não
 * conhece conector nenhum, e aqui ficou só o que segue tocando o serviço:
 * conectar, voltar do OAuth, consultar o estado da conexão e desconectar.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ISTO NÃO VIRA CAPACIDADE
 * ----------------------------------------------------------------------------
 * A régua R0–R5 classifica AÇÃO SOBRE O MUNDO: o que a empresa faz por meio de
 * um sistema de terceiro. Conectar uma conta não é ação sobre o mundo — é o
 * consentimento que TORNA a ação possível, e ele é dado pela própria pessoa, no
 * navegador dela, na tela do Google. Não há o que reter para aprovação depois:
 * a autorização JÁ É o ato de uma pessoa.
 *
 * O callback, além disso, é PÚBLICO por construção — quem chega nele é o browser
 * redirecionado pelo Google, sem token de sessão nenhum. Não existe ator para o
 * `ExecCtx` da porta antes de o `state` ser resolvido.
 *
 * ----------------------------------------------------------------------------
 * O QUE FICA DEVENDO, E DE QUEM É
 * ----------------------------------------------------------------------------
 * Guardar, ler, cifrar e revogar credencial é assunto do COFRE (fatia 5.3), que
 * corre em paralelo a esta. É por isso que este arquivo NÃO foi mexido além da
 * separação: mudar aqui como o token é guardado seria escrever por cima do
 * trabalho da outra fatia. Quando o cofre existir, é este controlador que passa
 * a falar com ele — e a exceção da catraca some junto, porque o serviço
 * injetado deixa de ser o conector.
 *
 * Até lá, a exceção `google-conexao.controller.ts -> google.service.ts` fica
 * declarada com este motivo.
 */
@Controller('google')
export class GoogleConexaoController {
  constructor(
    private readonly svc: GoogleService,
    private readonly prisma: PrismaService,
    private readonly login: GoogleLoginService,
  ) {}

  // Callback do OAuth — PÚBLICO (o browser é redirecionado pelo Google, sem token).
  // `state` carrega o orgId; validamos que é um org real.
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    // O login com o Gmail reaproveita ESTE redirect (o único autorizado no Google
    // Cloud): `state` com prefixo de login é sessão de usuário, não conexão do conector.
    if (state?.startsWith(LOGIN_STATE_PREFIX)) {
      return res.redirect(await this.login.completeToRedirect(code, state, req.ip));
    }
    const org = await this.prisma.org.findUnique({ where: { id: state } });
    if (!org || !code) {
      return res.redirect(
        `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000'}/google?erro=1`,
      );
    }
    const to = await this.svc.handleCallback(org.id, code);
    return res.redirect(to);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('connect')
  @RequirePermissions('admin.usuarios')
  connect(@CurrentUser() user: JwtUser) {
    return { url: this.svc.authUrl(user.orgId) };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('status')
  @RequirePermissions('dashboard.ver')
  status(@CurrentUser() user: JwtUser) {
    return this.svc.status(user.orgId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('disconnect')
  @RequirePermissions('admin.usuarios')
  disconnect(@CurrentUser() user: JwtUser) {
    return this.svc.disconnect(user.orgId);
  }
}
