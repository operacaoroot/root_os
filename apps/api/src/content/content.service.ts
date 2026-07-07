import { Injectable, NotFoundException } from '@nestjs/common';
import type { ContentList, ContentStats } from '@mktos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClickupService } from '../integrations/clickup.service';

// Ordem das etapas no board: open (a fazer) → custom (em andamento) → closed (feito).
function statusRank(type: string | null): number {
  if (type === 'closed' || type === 'done') return 2;
  if (type === 'custom') return 1;
  return 0;
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clickup: ClickupService,
  ) {}

  /** Muda a etapa de um tema — write-back no ClickUp (fonte da verdade) + local. */
  async setStatus(orgId: string, id: string, status: string, actorId: string) {
    const item = await this.prisma.contentItem.findFirst({ where: { id, orgId } });
    if (!item) throw new NotFoundException('Tema não encontrado');

    // escreve no ClickUp primeiro; se falhar, não altera o local
    const written = await this.clickup.writeTaskStatus(item.externalId, status);
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: { status: written.status, statusType: written.type, updatedAt: new Date() },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'content.status_change',
      entityType: 'content',
      entityId: id,
      before: { status: item.status },
      after: { status: updated.status, clickupTaskId: item.externalId },
    });
    return { ok: true, status: updated.status };
  }

  async list(orgId: string, filter: { status?: string; eixo?: string; formato?: string }): Promise<ContentList> {
    const where: Prisma.ContentItemWhereInput = { orgId };
    if (filter.status) where.status = filter.status;
    if (filter.eixo) where.eixo = filter.eixo;
    if (filter.formato) where.formato = filter.formato;

    const [items, all] = await Promise.all([
      this.prisma.contentItem.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 500 }),
      // facetas calculadas sobre TODO o conteúdo do org (não sobre o filtro)
      this.prisma.contentItem.findMany({
        where: { orgId },
        select: { status: true, statusType: true, eixo: true, formato: true },
      }),
    ]);

    const statusMeta = new Map<string, string | null>();
    const eixos = new Set<string>();
    const formatos = new Set<string>();
    for (const c of all) {
      if (!statusMeta.has(c.status)) statusMeta.set(c.status, c.statusType);
      if (c.eixo) eixos.add(c.eixo);
      if (c.formato) formatos.add(c.formato);
    }
    const statuses = [...statusMeta.entries()]
      .sort((a, b) => statusRank(a[1]) - statusRank(b[1]) || a[0].localeCompare(b[0]))
      .map(([k]) => k);

    return {
      items: items.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        listName: c.listName,
        title: c.title,
        status: c.status,
        statusType: c.statusType,
        formato: c.formato,
        eixo: c.eixo,
        tipo: c.tipo,
        fonte: c.fonte,
        assignee: c.assignee,
        url: c.url,
        dueDate: c.dueDate?.toISOString() ?? null,
        updatedAt: c.updatedAt.toISOString(),
      })),
      total: items.length,
      statuses,
      eixos: [...eixos].sort(),
      formatos: [...formatos].sort(),
      source: { tool: 'clickup', generatedAt: new Date().toISOString() },
    };
  }

  async stats(orgId: string): Promise<ContentStats> {
    const [byStatus, byEixo, byFormato, total] = await Promise.all([
      this.prisma.contentItem.groupBy({ by: ['status'], where: { orgId }, _count: true }),
      this.prisma.contentItem.groupBy({ by: ['eixo'], where: { orgId }, _count: true }),
      this.prisma.contentItem.groupBy({ by: ['formato'], where: { orgId }, _count: true }),
      this.prisma.contentItem.count({ where: { orgId } }),
    ]);
    const map = (rows: Array<{ _count: number } & Record<string, unknown>>, key: string) =>
      rows
        .map((r) => ({ key: (r[key] as string) ?? '(vazio)', count: r._count }))
        .sort((a, b) => b.count - a.count);
    return {
      total,
      byStatus: map(byStatus, 'status'),
      byEixo: map(byEixo, 'eixo'),
      byFormato: map(byFormato, 'formato'),
      source: { tool: 'clickup', generatedAt: new Date().toISOString() },
    };
  }
}
