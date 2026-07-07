import { Injectable, NotFoundException } from '@nestjs/common';
import type { TaskList, UpdateTaskInput } from '@mktos/shared';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async update(orgId: string, id: string, input: UpdateTaskInput, actorId: string) {
    const task = await this.prisma.task.findFirst({ where: { id, orgId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: input.status as TaskStatus },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'task.update',
      entityType: 'task',
      entityId: id,
      before: { status: task.status },
      after: { status: updated.status },
    });
    return { ok: true, status: updated.status };
  }
}
