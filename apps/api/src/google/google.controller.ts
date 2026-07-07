import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleService } from './google.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('google')
export class GoogleController {
  constructor(
    private readonly svc: GoogleService,
    private readonly prisma: PrismaService,
  ) {}

  // Callback do OAuth — PÚBLICO (o browser é redirecionado pelo Google, sem token).
  // `state` carrega o orgId; validamos que é um org real.
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const org = await this.prisma.org.findUnique({ where: { id: state } });
    if (!org || !code) return res.redirect(`${process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000'}/google?erro=1`);
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

  // ---------- Leitura ----------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('calendar')
  @RequirePermissions('dashboard.ver')
  calendar(@CurrentUser() user: JwtUser, @Query('max') max?: string) {
    return this.svc.calendarUpcoming(user.orgId, max ? Number(max) : 10);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('gmail')
  @RequirePermissions('gmail.ver')
  gmail(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('max') max?: string) {
    return this.svc.gmailRecent(user.orgId, q ?? '', max ? Number(max) : 10);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('gmail/:id')
  @RequirePermissions('gmail.ver')
  gmailOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.gmailGet(user.orgId, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('drive')
  @RequirePermissions('drive.ver')
  drive(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('max') max?: string) {
    return this.svc.driveList(user.orgId, q ?? '', max ? Number(max) : 15);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('docs/:id')
  @RequirePermissions('drive.ver')
  doc(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.docGet(user.orgId, id);
  }
}
