import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TrackEventSchema } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// Ingestão de eventos do pixel (público) + leitura agregada (autenticada).
// Ver docs/ARCHITECTURE.md §5.
// Fase 1: resolve org fixa 'root'. Fase 2: resolver org por pixel key / domínio.
@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: EventsService,
  ) {}

  // --- Ingestão (público, sem auth: o pixel roda no browser do visitante) ---
  @Post('track')
  async track(@Body() body: unknown) {
    const e = TrackEventSchema.parse(body);
    const org = await this.prisma.org.findUnique({ where: { slug: 'root' } });
    if (!org) return { ok: false, reason: 'org' };

    // dedup por event_id (idempotência)
    await this.prisma.pixelEvent.upsert({
      where: { eventId: e.event_id },
      update: {},
      create: {
        orgId: org.id,
        eventId: e.event_id,
        sessionId: e.session_id,
        anonymousId: e.anonymous_id,
        eventName: e.event_name,
        url: e.url,
        referrer: e.referrer,
        utmSource: e.utm_source,
        utmMedium: e.utm_medium,
        utmCampaign: e.utm_campaign,
        utmContent: e.utm_content,
        utmTerm: e.utm_term,
        device: e.device,
        value: e.value != null ? e.value.toString() : null,
        metadata: e.metadata ? (e.metadata as Prisma.InputJsonValue) : undefined,
        occurredAt: e.ts ? new Date(e.ts) : undefined,
      },
    });
    return { ok: true };
  }

  // --- Leitura (painel /pixels e MCP) — read-only, exige dashboard.ver ---
  @Get('summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('dashboard.ver')
  summary(@CurrentUser() user: JwtUser, @Query('days') days?: string) {
    return this.svc.summary(user.orgId, days ? Number(days) : 7);
  }

  @Get('recent')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('dashboard.ver')
  recent(@CurrentUser() user: JwtUser, @Query('limit') limit?: string) {
    return this.svc.recent(user.orgId, limit ? Number(limit) : 50);
  }
}
