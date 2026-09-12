import { Controller, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MetaService } from './meta.service';
import { PrismaService } from '../prisma/prisma.service';
import { comTenantPublico, resolverOrgDaChave } from '../common/tenant-publico';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * ============================================================================
 * O RETORNO DO OAUTH DA META ABRE O CONTEXTO DA EMPRESA — fatia 5.4
 * ============================================================================
 *
 * Mesmo defeito de cadeia que o retorno do Google tinha, e aqui ele era PIOR:
 * o token da Página só é escrito neste caminho (não há renovação que o
 * reconcilie depois).
 *
 * A cadeia: rota pública não ganha empresa no contexto (`ContextoInterceptor`,
 * com todas as letras) → `CofreService.guardar` confere a empresa do contexto na
 * primeira linha e lança quando ela é nula → a gravação no cofre é "tenta e
 * segue" → o token ficava só na coluna antiga, com uma linha de erro no log.
 * Junte a revogação, que roda autenticada e portanto FUNCIONA: a credencial
 * ficava marcada como revogada, reautorizar não limpava a marca (porque a
 * gravação falhava de novo) e a leitura seguinte lançava "foi revogada,
 * reconecte o Instagram" — que era exatamente o que não resolvia.
 *
 * `comTenantPublico` é o mesmo invólucro das outras rotas públicas do produto
 * (bio e pixel). Daqui para dentro, este caminho é indistinguível de uma rota
 * autenticada.
 */
@Controller('meta')
export class MetaController {
  private readonly log = new Logger('MetaController');
  constructor(
    private readonly svc: MetaService,
    private readonly prisma: PrismaService,
    /** Para esquecer a sonda guardada assim que a autorização muda de estado. */
    private readonly contrato: RegistroDeConectores,
  ) {}

  // Callback do OAuth do Facebook — PÚBLICO (o browser é redirecionado pelo Meta).
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDesc: string,
    @Res() res: Response,
  ) {
    const web = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';
    if (error) {
      this.log.warn(`OAuth negado/erro do Facebook: ${error} — ${errorDesc}`);
      return res.redirect(`${web}/instagram?erro=${encodeURIComponent(errorDesc || error)}`);
    }
    // Sob a sentinela de resolução pública — `Org.findUnique` é uma das três
    // consultas que a política libera para ela. Solto, sob isolamento por linha,
    // este `findUnique` é recusado e o retorno do OAuth falha para todo mundo.
    const alvo = state ? await resolverOrgDaChave(this.prisma, state) : null;
    if (!alvo || !code) return res.redirect(`${web}/instagram?erro=${encodeURIComponent('code/state ausente')}`);
    try {
      const to = await comTenantPublico(alvo.orgId, async () => {
        const destino = await this.svc.handleCallback(alvo.orgId, code);
        // Autorizar muda o estado da ligação: a medição guardada é de antes.
        this.contrato.esquecer(alvo.orgId, 'meta');
        return destino;
      });
      return res.redirect(to);
    } catch (e) {
      const msg = (e as Error).message ?? 'falha na troca de token';
      this.log.error(`handleCallback falhou: ${msg}`);
      return res.redirect(`${web}/instagram?erro=${encodeURIComponent(msg.slice(0, 300))}`);
    }
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
   * DESCONECTAR — e, desde a fatia 5.4, isto REVOGA de verdade: os tokens
   * guardados no cofre são queimados junto com a linha. Ver
   * `MetaService.disconnect`.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('disconnect')
  @RequirePermissions('admin.usuarios')
  async disconnect(@CurrentUser() user: JwtUser) {
    try {
      return await this.svc.disconnect(user.orgId, {
        actorId: user.sub,
        motivo: 'desconectado pela tela do Instagram',
      });
    } finally {
      // Desconectar aqui é REVOGAR (queima no cofre + apaga a linha): a medição
      // guardada é de antes, e vale mesmo quando a queima falha no meio.
      this.contrato.esquecer(user.orgId, 'meta');
    }
  }

  // ---------- Métricas do Instagram ----------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('instagram/overview')
  @RequirePermissions('instagram.ver')
  overview(@CurrentUser() user: JwtUser) {
    return this.svc.overview(user.orgId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('instagram/media')
  @RequirePermissions('instagram.ver')
  media(@CurrentUser() user: JwtUser, @Query('limit') limit?: string) {
    return this.svc.media(user.orgId, limit ? Number(limit) : 12);
  }
}
