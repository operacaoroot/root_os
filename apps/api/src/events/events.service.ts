import { Injectable } from '@nestjs/common';
import type { EventsSummary, EventsRecent, EventRow } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

// Leitura agregada dos eventos do pixel (para o painel /pixels e o MCP).
// Volume de MVP: buscamos a janela e agregamos em memória (sem raw SQL).
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(orgId: string, daysInput = 7): Promise<EventsSummary> {
    const days = Number.isFinite(daysInput) && daysInput > 0 ? Math.min(Math.floor(daysInput), 90) : 7;
    const until = new Date();
    const since = new Date(until);
    since.setDate(until.getDate() - days);

    const rows = await this.prisma.pixelEvent.findMany({
      where: { orgId, occurredAt: { gte: since } },
      select: {
        eventName: true,
        sessionId: true,
        anonymousId: true,
        url: true,
        utmSource: true,
        value: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'desc' },
    });

    const sessions = new Set<string>();
    const visitors = new Set<string>();
    const byEvent = new Map<string, number>();
    const bySource = new Map<string, number>();
    const byPage = new Map<string, number>();
    const dayBuckets = new Map<string, { events: number; sessions: Set<string> }>();
    let purchases = 0;
    let revenue = 0;

    for (const r of rows) {
      sessions.add(r.sessionId);
      visitors.add(r.anonymousId);
      byEvent.set(r.eventName, (byEvent.get(r.eventName) ?? 0) + 1);

      const src = r.utmSource || 'direto';
      bySource.set(src, (bySource.get(src) ?? 0) + 1);

      if (r.url) {
        const page = stripQuery(r.url);
        byPage.set(page, (byPage.get(page) ?? 0) + 1);
      }

      if (r.eventName === 'purchase') {
        purchases += 1;
        revenue += Number(r.value ?? 0);
      }

      const key = r.occurredAt.toISOString().slice(0, 10);
      const b = dayBuckets.get(key) ?? { events: 0, sessions: new Set<string>() };
      b.events += 1;
      b.sessions.add(r.sessionId);
      dayBuckets.set(key, b);
    }

    // série diária contígua (inclui dias zerados) para o mini-gráfico
    const daily: EventsSummary['daily'] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(until);
      d.setDate(until.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const b = dayBuckets.get(key);
      daily.push({ date: key, events: b?.events ?? 0, sessions: b?.sessions.size ?? 0 });
    }

    const top = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

    return {
      window: { since: since.toISOString(), until: until.toISOString(), days },
      totals: {
        events: rows.length,
        sessions: sessions.size,
        visitors: visitors.size,
        purchases,
        revenue,
      },
      lastEventAt: rows[0]?.occurredAt.toISOString() ?? null,
      byEvent: top(byEvent, 12).map(([name, count]) => ({ name, count })),
      bySource: top(bySource, 8).map(([source, count]) => ({ source, count })),
      topPages: top(byPage, 8).map(([url, count]) => ({ url, count })),
      daily,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async recent(orgId: string, limit = 50): Promise<EventsRecent> {
    const take = Math.min(Math.max(limit, 1), 200);
    const [rows, total] = await Promise.all([
      this.prisma.pixelEvent.findMany({
        where: { orgId },
        orderBy: { occurredAt: 'desc' },
        take,
      }),
      this.prisma.pixelEvent.count({ where: { orgId } }),
    ]);

    const items: EventRow[] = rows.map((r) => ({
      id: r.id,
      eventName: r.eventName,
      url: r.url,
      referrer: r.referrer,
      utmSource: r.utmSource,
      utmMedium: r.utmMedium,
      utmCampaign: r.utmCampaign,
      device: r.device,
      value: r.value != null ? Number(r.value) : null,
      sessionId: r.sessionId,
      anonymousId: r.anonymousId,
      occurredAt: r.occurredAt.toISOString(),
    }));

    return {
      items,
      total,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}

function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
