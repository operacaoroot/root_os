import { Injectable } from '@nestjs/common';
import type { TaskList } from '@mktos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    orgId: string,
    filter: { status?: string; overdue?: boolean },
  ): Promise<TaskList> {
    const now = new Date();
    const where: Prisma.TaskWhereInput = { orgId };
    if (filter.status) where.status = filter.status as any;
    if (filter.overdue) {
      where.dueDate = { lt: now };
      where.status = { not: 'concluida' };
    }

    const [rows, overdue] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }],
        take: 200,
      }),
      this.prisma.task.count({
        where: { orgId, dueDate: { lt: now }, status: { not: 'concluida' } },
      }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        tool: t.tool,
        overdue: !!t.dueDate && t.dueDate < now && t.status !== 'concluida',
      })),
      total: rows.length,
      overdue,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
