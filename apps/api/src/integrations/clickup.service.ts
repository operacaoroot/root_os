import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Conector ClickUp (API v2, token pessoal). Credencial PRÓPRIA do root em
// ~/.config/root/clickup.env (CLICKUP_API_TOKEN). Puxa tarefas reais → tabela Task
// (tool='clickup'), de onde o dashboard/tarefas/MCP/bot já leem.
// Escopo: CLICKUP_LIST_IDS (csv) OU auto-descoberta das listas do time.

interface CuStatus { status: string; type: string }
interface CuTask {
  id: string;
  name: string;
  description?: string | null;
  status?: CuStatus;
  date_due?: string | null;
  priority?: { priority?: string } | null;
  assignees?: Array<{ username?: string }>;
  url?: string;
  tags?: Array<{ name: string }>;
}

@Injectable()
export class ClickupService {
  private readonly log = new Logger('ClickupService');
  private readonly token = process.env.CLICKUP_API_TOKEN ?? '';
  private readonly base = (process.env.CLICKUP_BASE_URL ?? 'https://api.clickup.com/api/v2').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async cu<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { headers: { Authorization: this.token } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ClickUp ${path} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Descobre as listas a sincronizar (env override ou varredura time→espaços→listas). */
  private async resolveListIds(): Promise<string[]> {
    const override = (process.env.CLICKUP_LIST_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (override.length) return override;

    const { teams } = await this.cu<{ teams: Array<{ id: string }> }>('/team');
    const teamId = process.env.CLICKUP_TEAM_ID || teams[0]?.id;
    if (!teamId) throw new Error('Nenhum time (workspace) encontrado no ClickUp.');

    const { spaces } = await this.cu<{ spaces: Array<{ id: string }> }>(`/team/${teamId}/space?archived=false`);
    const listIds: string[] = [];
    for (const sp of spaces) {
      try {
        const { folders } = await this.cu<{ folders: Array<{ lists: Array<{ id: string }> }> }>(
          `/space/${sp.id}/folder?archived=false`,
        );
        for (const f of folders) for (const l of f.lists ?? []) listIds.push(l.id);
        const { lists } = await this.cu<{ lists: Array<{ id: string }> }>(`/space/${sp.id}/list?archived=false`);
        for (const l of lists) listIds.push(l.id);
      } catch (e) {
        this.log.warn(`Espaço ${sp.id} ignorado: ${(e as Error).message}`);
      }
    }
    return [...new Set(listIds)];
  }

  private async fetchTasks(listId: string): Promise<CuTask[]> {
    const out: CuTask[] = [];
    for (let page = 0; page < 20; page++) {
      const { tasks } = await this.cu<{ tasks: CuTask[] }>(
        `/list/${listId}/task?archived=false&subtasks=true&page=${page}`,
      );
      out.push(...tasks);
      if (tasks.length < 100) break; // ClickUp pagina de 100 em 100
    }
    return out;
  }

  private mapStatus(s?: CuStatus): TaskStatus {
    const type = s?.type ?? 'open';
    if (type === 'closed' || type === 'done') return 'concluida';
    if (type === 'custom') return 'em_andamento';
    return 'aberta';
  }

  private mapPriority(p?: { priority?: string } | null): string {
    const v = p?.priority;
    return v === 'urgent' || v === 'high' ? 'alta' : 'normal';
  }

  async sync(orgId: string, actorId?: string): Promise<{ lists: number; tasks: number }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'ClickUp não configurado: defina CLICKUP_API_TOKEN em ~/.config/root/clickup.env e reinicie a API.',
      );
    }
    const started = Date.now();
    try {
      const listIds = await this.resolveListIds();
      const all: CuTask[] = [];
      for (const id of listIds) all.push(...(await this.fetchTasks(id)));

      // ClickUp é a fonte da verdade das tarefas dele: substitui as tool='clickup'.
      const rows = all.map((t) => ({
        orgId,
        tool: 'clickup',
        externalId: t.id,
        title: t.name,
        description: t.description ?? null,
        status: this.mapStatus(t.status),
        priority: this.mapPriority(t.priority),
        assignee: t.assignees?.[0]?.username ?? null,
        dueDate: t.date_due ? new Date(Number(t.date_due)) : null,
        externalUrl: t.url ?? null,
        tags: (t.tags ?? []).map((tg) => tg.name),
      }));
      await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { orgId, tool: 'clickup' } }),
        ...(rows.length ? [this.prisma.task.createMany({ data: rows })] : []),
      ]);

      const latencyMs = Date.now() - started;
      await this.markHealth(orgId, 'ok', latencyMs, null);
      await this.audit.log({
        orgId,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'integration.sync',
        entityType: 'integration',
        entityId: 'clickup',
        after: { lists: listIds.length, tasks: rows.length },
      });
      this.log.log(`ClickUp sync: ${rows.length} tarefas de ${listIds.length} lista(s) em ${latencyMs}ms`);
      return { lists: listIds.length, tasks: rows.length };
    } catch (e) {
      await this.markHealth(orgId, 'down', Date.now() - started, (e as Error).message).catch(() => {});
      throw e;
    }
  }

  /** Atualiza IntegrationAccount(clickup) + health. */
  private async markHealth(orgId: string, health: 'ok' | 'down', latencyMs: number, lastError: string | null) {
    const status = health === 'ok' ? 'connected' : 'error';
    const acc = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: 'clickup' } });
    const account = acc
      ? await this.prisma.integrationAccount.update({
          where: { id: acc.id },
          data: { status, connectedAt: health === 'ok' ? new Date() : acc.connectedAt },
        })
      : await this.prisma.integrationAccount.create({
          data: { orgId, key: 'clickup', label: 'ClickUp (root)', status, connectedAt: new Date() },
        });
    await this.prisma.integrationHealth.upsert({
      where: { accountId: account.id },
      update: { status: health, lastSyncAt: new Date(), latencyMs, lastError },
      create: { accountId: account.id, status: health, lastSyncAt: new Date(), latencyMs, lastError },
    });
  }
}
