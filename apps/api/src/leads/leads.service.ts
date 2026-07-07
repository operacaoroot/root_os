import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeadList } from '@mktos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    orgId: string,
    filter: { status?: string; period?: string },
  ): Promise<LeadList> {
    const where: Prisma.LeadWhereInput = { orgId };
    if (filter.status) where.status = filter.status as any;
    if (filter.period) {
      const d = new Date();
      if (filter.period === 'today') d.setHours(0, 0, 0, 0);
      if (filter.period === 'week') d.setDate(d.getDate() - 7);
      if (filter.period === 'month') d.setDate(d.getDate() - 30);
      where.enteredAt = { gte: d };
    }

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { enteredAt: 'desc' },
        include: { source: true, campaign: true, owner: true },
        take: 200,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      items: rows.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        source: l.source?.name ?? null,
        campaign: l.campaign?.name ?? null,
        utmSource: l.utmSource,
        utmMedium: l.utmMedium,
        utmCampaign: l.utmCampaign,
        status: l.status,
        owner: l.owner?.name ?? null,
        score: l.score,
        enteredAt: l.enteredAt.toISOString(),
      })),
      total,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async getOne(orgId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, orgId },
      include: {
        source: true,
        campaign: true,
        events: { orderBy: { occurredAt: 'desc' } },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }
}
