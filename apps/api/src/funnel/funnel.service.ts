import { Injectable } from '@nestjs/common';
import type { FunnelMetrics } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FunnelService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(orgId: string): Promise<FunnelMetrics> {
    const [sessions, byStatus] = await Promise.all([
      this.prisma.pixelEvent.findMany({
        where: { orgId, eventName: 'page_view' },
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
      this.prisma.lead.groupBy({ by: ['status'], where: { orgId }, _count: true }),
    ]);

    const count = (statuses: string[]) =>
      byStatus
        .filter((g) => statuses.includes(g.status))
        .reduce((s, g) => s + g._count, 0);

    const raw = [
      { key: 'visitante', label: 'Visitantes', count: sessions.length },
      {
        key: 'lead',
        label: 'Leads',
        count: count(['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido']),
      },
      { key: 'qualificado', label: 'Qualificados', count: count(['qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho']) },
      { key: 'oportunidade', label: 'Oportunidades', count: count(['oportunidade', 'reuniao', 'proposta', 'ganho']) },
      { key: 'reuniao', label: 'Reuniões', count: count(['reuniao', 'proposta', 'ganho']) },
      { key: 'proposta', label: 'Propostas', count: count(['proposta', 'ganho']) },
      { key: 'ganho', label: 'Ganhos', count: count(['ganho']) },
    ];

    const stages = raw.map((s, i) => {
      const prev = raw[i - 1]?.count;
      const convFromPrev =
        i === 0 || !prev ? null : Math.round((s.count / prev) * 1000) / 10;
      return { ...s, convFromPrev };
    });

    return {
      stages,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
