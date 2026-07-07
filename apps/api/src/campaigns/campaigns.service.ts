import { Injectable, NotFoundException } from '@nestjs/common';
import type { CampaignDossier, CampaignItem, CampaignList, UpdateCampaignInput } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const WON = 'ganho';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async toItem(c: {
    id: string;
    name: string;
    objective: string | null;
    channel: string | null;
    status: string;
    budget: unknown;
    spend: unknown;
  }): Promise<CampaignItem> {
    const [leads, conversions] = await Promise.all([
      this.prisma.lead.count({ where: { campaignId: c.id } }),
      this.prisma.lead.count({ where: { campaignId: c.id, status: WON } }),
    ]);
    const spend = c.spend != null ? Number(c.spend) : null;
    const cpl = spend != null && leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;
    return {
      id: c.id,
      name: c.name,
      objective: c.objective,
      channel: c.channel,
      status: c.status,
      budget: c.budget != null ? Number(c.budget) : null,
      spend,
      leads,
      conversions,
      cpl,
    };
  }

  async list(orgId: string, status?: string): Promise<CampaignList> {
    const rows = await this.prisma.campaign.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const items = await Promise.all(rows.map((c) => this.toItem(c)));
    return {
      items,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async dossier(orgId: string, id: string): Promise<CampaignDossier> {
    const c = await this.prisma.campaign.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Campanha não encontrada');
    const item = await this.toItem(c);
    const leadRows = await this.prisma.lead.findMany({
      where: { campaignId: c.id },
      orderBy: { enteredAt: 'desc' },
      include: { source: true, owner: true },
      take: 100,
    });
    const spend = item.spend;
    const cpa = spend != null && item.conversions > 0 ? Math.round((spend / item.conversions) * 100) / 100 : null;
    return {
      campaign: item,
      metrics: {
        leads: item.leads,
        conversions: item.conversions,
        revenue: null, // atribuição de valor por conversão entra na Fase 2+
        cpl: item.cpl,
        cpa,
      },
      leads: leadRows.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        source: l.source?.name ?? null,
        campaign: c.name,
        utmSource: l.utmSource,
        utmMedium: l.utmMedium,
        utmCampaign: l.utmCampaign,
        status: l.status,
        owner: l.owner?.name ?? null,
        score: l.score,
        enteredAt: l.enteredAt.toISOString(),
      })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async update(orgId: string, id: string, input: UpdateCampaignInput, actorId: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Campanha não encontrada');

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: input.status },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'campaign.update',
      entityType: 'campaign',
      entityId: id,
      before: { status: c.status },
      after: { status: updated.status },
    });
    return { ok: true, status: updated.status };
  }
}
