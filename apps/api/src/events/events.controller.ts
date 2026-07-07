import { Body, Controller, Post } from '@nestjs/common';
import { TrackEventSchema } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

// Ingestão de eventos do pixel (público). Ver docs/ARCHITECTURE.md §5.
// Fase 1: resolve org fixa 'root'. Fase 2: resolver org por pixel key / domínio.
@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });
    return { ok: true };
  }
}
