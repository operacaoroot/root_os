import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BioTrackSchema } from '@mktos/shared';
import { BioService } from './bio.service';
import { BioTrackingService } from './bio-tracking.service';

const COOKIE_VISITANTE = 'rid';

/** Lê o cookie do header cru — a API não usa cookie-parser. */
function lerCookie(header: string | undefined, nome: string): string | undefined {
  if (!header) return undefined;
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Superfície PÚBLICA da bio — sem guard, igual ao /events/track do pixel.
 * Nada aqui devolve dado de outra org: a página pública é, por definição, pública.
 */
@Controller('bio')
export class BioPublicController {
  constructor(
    private readonly svc: BioService,
    private readonly tracking: BioTrackingService,
  ) {}

  @Get('public/page/:handle')
  async page(@Param('handle') handle: string) {
    const page = await this.svc.paginaPublica(handle);
    if (!page) throw new NotFoundException('página não encontrada');
    return page;
  }

  /** Pageview enviado pelo RSC da página pública (server-to-server). */
  @Post('public/track')
  async track(@Body() body: unknown) {
    const e = BioTrackSchema.parse(body);
    const page = await this.svc.pageParaTrack(e.handle);
    if (!page) return { ok: false, reason: 'page' };

    await this.tracking.registrar(
      {
        rid: e.rid,
        pageId: page.id,
        orgId: page.orgId,
        url: e.url ?? `/${e.handle}`,
        referrer: e.referrer,
        userAgent: e.userAgent,
        params: e.params ?? {},
      },
      'pageview',
    );
    return { ok: true };
  }

  /**
   * Saída passa por aqui pra registrar o clique ANTES de mandar embora.
   * O cookie `rid` chega porque o web faz proxy de /api na mesma origem.
   */
  @Get('r/:linkId')
  async redirect(@Param('linkId') linkId: string, @Req() req: Request, @Res() res: Response) {
    const alvo = await this.svc.destinoDoLink(linkId);
    if (!alvo) {
      const web = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';
      return res.redirect(`${web}/b`);
    }

    const rid = lerCookie(req.headers.cookie, COOKIE_VISITANTE);
    if (rid) {
      // Não esperamos o registro: o clique não pode ficar mais lento por causa dele.
      void this.tracking.registrar(
        {
          rid,
          pageId: alvo.link.page.id,
          orgId: alvo.link.page.orgId,
          url: req.originalUrl,
          referrer: req.headers.referer ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          params: {},
        },
        alvo.link.tipo === 'whatsapp' ? 'whatsapp_click' : 'link_click',
        { linkId: alvo.link.id, metadata: { rotulo: alvo.link.rotulo, tipo: alvo.link.tipo } },
      );
    }

    return res.redirect(302, alvo.destino);
  }
}
