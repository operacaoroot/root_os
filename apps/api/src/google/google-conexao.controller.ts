import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleService } from './google.service';
import { PrismaService } from '../prisma/prisma.service';
import { comTenantPublico, resolverOrgDaChave } from '../common/tenant-publico';
import { RegistroDeConectores } from '../integrations/conectores.registry';
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
 * O COFRE, E POR QUE O RETORNO DO OAUTH ABRE O CONTEXTO DA EMPRESA
 * ----------------------------------------------------------------------------
 * Guardar, ler, cifrar e revogar credencial é assunto do COFRE (fatia 5.3), e
 * desde a 5.4 o `GoogleService` grava os dois tokens lá na mesma passagem em que
 * os grava na coluna. SÓ QUE O COFRE EXIGE A EMPRESA NO CONTEXTO DE EXECUÇÃO:
 * `CofreService.guardar` compara a empresa do argumento com a do contexto e
 * lança quando o contexto está vazio (ele falha fechado sob isolamento por
 * linha, e isso é certo).
 *
 * E rota pública não ganha empresa no contexto — está escrito com todas as
 * letras no `ContextoInterceptor`: sem usuário, `orgId` fica nulo. O resultado
 * era um defeito de cadeia que a revisão percorreu inteiro: a gravação no cofre
 * é "tenta e segue", então TODA autorização nova saía com uma linha de erro no
 * log e o token só na coluna antiga. Pior, com a revogação (que roda
 * autenticada, e portanto FUNCIONA) marcando a credencial como revogada:
 * reautorizar não limpava a marca, a leitura seguinte lançava "foi revogada,
 * reautorize em Conexões" — e reautorizar era exatamente o que não resolvia.
 * Desconectar e reconectar matava o Google da empresa de forma permanente.
 *
 * Por isso o `state` é resolvido em empresa e TODO o resto roda dentro de
 * `comTenantPublico` — o mesmo invólucro que as rotas públicas da bio e do pixel
 * já usam (`bio-public.controller.ts`, `events.controller.ts`), e o mesmo
 * desenho que o cron da pauta usa com `comContexto`. A partir daqui este
 * caminho é indistinguível de uma rota autenticada: o cofre aceita a gravação,
 * e `app.org_id` sai com a empresa certa para o banco.
 */
@Controller('google')
export class GoogleConexaoController {
  constructor(
    private readonly svc: GoogleService,
    private readonly prisma: PrismaService,
    private readonly login: GoogleLoginService,
    /** Para esquecer a sonda guardada assim que a autorização muda de estado. */
    private readonly contrato: RegistroDeConectores,
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
    /*
     * A resolução roda sob a SENTINELA de resolução pública (`Org.findUnique` é
     * uma das três consultas que a política libera para ela) — e não solta, como
     * antes: sem tenant resolvido, sob isolamento por linha esta leitura é
     * recusada e o retorno do OAuth passaria a falhar para todo mundo.
     */
    const alvo = state ? await resolverOrgDaChave(this.prisma, state) : null;
    if (!alvo || !code) {
      return res.redirect(
        `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000'}/google?erro=1`,
      );
    }
    const to = await comTenantPublico(alvo.orgId, async () => {
      const destino = await this.svc.handleCallback(alvo.orgId, code);
      // Autorizar muda o estado da ligação: a medição guardada é de antes.
      this.contrato.esquecer(alvo.orgId, 'google');
      return destino;
    });
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

  /**
   * DESCONECTAR — e, desde a fatia 5.4, isto REVOGA de verdade.
   *
   * Com o cofre lido na frente da coluna, apagar só a linha de `GoogleAccount`
   * deixaria os tokens vivos no cofre: uma desconexão que não desconecta. O
   * serviço queima os dois lugares e devolve o que foi queimado — e o ator vai
   * junto, porque "quem revogou o Google desta empresa, e quando" é justamente a
   * pergunta que um incidente faz.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('disconnect')
  @RequirePermissions('admin.usuarios')
  async disconnect(@CurrentUser() user: JwtUser) {
    try {
      return await this.svc.disconnect(user.orgId, {
        actorId: user.sub,
        motivo: 'desconectado pela tela do Google',
      });
    } finally {
      // Desconectar aqui é REVOGAR: a medição guardada é de antes do clique — e
      // esquecer no `finally` vale também para a queima que falhou no meio.
      this.contrato.esquecer(user.orgId, 'google');
    }
  }
}
