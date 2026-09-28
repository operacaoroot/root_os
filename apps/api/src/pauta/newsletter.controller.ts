import { Body, Controller, Get, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PautaNewsletterGerarSchema, PautaNewsletterVideoSchema } from '@mktos/shared';
import { NewsletterService } from './newsletter.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MC13: a newsletter do episódio. Sub-rota de `/pauta`, governada pelo módulo
 * pauta. Não há rota de envio: o destino é a D-MC7, e até lá o texto sai por
 * `newsletter.md` e `newsletter.html` para copiar numa ferramenta de e-mail.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class NewsletterController {
  constructor(private readonly newsletters: NewsletterService) {}

  @Get(':id/newsletter')
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.newsletters.painel(user.orgId, id);
  }

  // Gasta IA, como o roteiro e o pacote.
  @Post(':id/newsletter/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { substituir, urlDoVideo } = PautaNewsletterGerarSchema.parse(body ?? {});
    return this.newsletters.gerar(user.orgId, id, user.sub, { substituir, urlDoVideo });
  }

  @Put(':id/newsletter/video')
  @RequirePermissions('pauta.editar')
  video(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { urlDoVideo } = PautaNewsletterVideoSchema.parse(body ?? {});
    return this.newsletters.definirVideo(user.orgId, id, user.sub, urlDoVideo);
  }

  @Get(':id/newsletter.md')
  @RequirePermissions('pauta.ver')
  async markdown(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { nome, conteudo } = await this.newsletters.exportar(user.orgId, id, 'md');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Cache-Control', 'no-store');
    return conteudo;
  }

  // HTML servido pela origem da API: vai como anexo e com a política mais
  // fechada que ainda deixa o estilo em linha — nenhum script roda se alguém
  // abrir o arquivo por este endereço.
  @Get(':id/newsletter.html')
  @RequirePermissions('pauta.ver')
  async html(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { nome, conteudo } = await this.newsletters.exportar(user.orgId, id, 'html');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return conteudo;
  }
}
