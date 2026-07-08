import { Controller, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MetaService } from './meta.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('meta')
export class MetaController {
  private readonly log = new Logger('MetaController');
  constructor(
    private readonly svc: MetaService,
    private readonly prisma: PrismaService,
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
    const org = state ? await this.prisma.org.findUnique({ where: { id: state } }) : null;
    if (!org || !code) return res.redirect(`${web}/instagram?erro=${encodeURIComponent('code/state ausente')}`);
    try {
      const to = await this.svc.handleCallback(org.id, code);
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

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('disconnect')
  @RequirePermissions('admin.usuarios')
  disconnect(@CurrentUser() user: JwtUser) {
    return this.svc.disconnect(user.orgId);
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
