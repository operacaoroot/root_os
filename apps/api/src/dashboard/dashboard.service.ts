import { Injectable } from '@nestjs/common';
import type { DashboardSummary } from '@mktos/shared';
import { WorkService } from '../work/work.service';
import type { WorkTaskQuery } from '../work/work-task-query';
import { selectedTaskSnapshot } from '../work/selected-work-tasks';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly work: WorkService) {}

  async summary(orgId: string, selection?: WorkTaskQuery, snapshot?: Awaited<ReturnType<typeof selectedTaskSnapshot>>): Promise<DashboardSummary & { taskSource: string; taskTotal?: number; taskIds?: string[] }> {
    const canonical = selection ? snapshot ?? await selectedTaskSnapshot(this.work, orgId, selection) : undefined;
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(now);
    startWeek.setDate(now.getDate() - 7);
    const startMonth = new Date(now);
    startMonth.setDate(now.getDate() - 30);

    const [
      leadsToday,
      leadsWeek,
      leadsMonth,
      conversions,
      purchases,
      overdueTasks,
      activeCampaigns,
      campaignsAtRisk,
      spendAgg,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { orgId, enteredAt: { gte: startToday } } }),
      this.prisma.lead.count({ where: { orgId, enteredAt: { gte: startWeek } } }),
      this.prisma.lead.count({ where: { orgId, enteredAt: { gte: startMonth } } }),
      this.prisma.lead.count({ where: { orgId, status: 'ganho', enteredAt: { gte: startMonth } } }),
      this.prisma.pixelEvent.findMany({
        where: { orgId, eventName: 'purchase' },
        select: { value: true },
      }),
      canonical ? Promise.resolve(canonical.items.filter((t) => t.overdue).length) : this.prisma.task.count({
        where: { orgId, dueDate: { lt: now }, status: { not: 'concluida' } },
      }),
      this.prisma.campaign.count({ where: { orgId, status: 'ativa' } }),
      this.prisma.campaign.count({ where: { orgId, status: 'problema' } }),
      this.prisma.campaign.aggregate({ where: { orgId }, _sum: { spend: true } }),
    ]);

    const revenue = purchases.reduce((s, p) => s + Number(p.value ?? 0), 0);
    const sales = purchases.length;
    const spend = Number(spendAgg._sum.spend ?? 0);
    const conversionRate = leadsMonth > 0 ? (conversions / leadsMonth) * 100 : 0;
    const cpl = leadsMonth > 0 ? spend / leadsMonth : null;

    return {
      taskSource: canonical ? 'trabalho-interno' : 'tarefas-legadas',
      ...(canonical ? { taskTotal: canonical.total, taskIds: canonical.items.map((t) => t.id) } : {}),
      leadsToday,
      leadsWeek,
      leadsMonth,
      conversions,
      sales,
      revenue,
      conversionRate: Math.round(conversionRate * 10) / 10,
      cpl: cpl === null ? null : Math.round(cpl * 100) / 100,
      overdueTasks,
      activeCampaigns,
      campaignsAtRisk,
      criticalAlerts: campaignsAtRisk,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
