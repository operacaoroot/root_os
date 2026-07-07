import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Conector ClickUp (API v2, token pessoal). Credencial PRÓPRIA do root em
// ~/.config/root/clickup.env. PREMISSA: só o espaço "root". Listas de CONTEÚDO
// (Gestão de Temas) → ContentItem (status cru + campos); demais → Task.

interface CuOption { id: string; name: string; orderindex: number }
interface CuField {
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: CuOption[] };
}
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
  list?: { id?: string; name?: string };
  custom_fields?: CuField[];
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

  /**
   * PREMISSA: só o espaço "root". Localiza por id (CLICKUP_SPACE_ID) ou nome
   * (CLICKUP_SPACE_NAME, default "root"), IGNORANDO o workspace do escritório.
   */
  private async resolveSpace(): Promise<{ spaceId: string; spaceName: string }> {
    const byId = (process.env.CLICKUP_SPACE_ID ?? '').trim();
    const wantName = (process.env.CLICKUP_SPACE_NAME ?? 'root').trim();
    if (byId) return { spaceId: byId, spaceName: wantName };

    const ignore = (process.env.CLICKUP_IGNORE_TEAMS ?? 'Cardozo & Saggioro')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const { teams } = await this.cu<{ teams: Array<{ id: string; name: string }> }>('/team');
    for (const t of teams) {
      if (ignore.includes(t.name.trim().toLowerCase())) continue; // não toca o escritório
      const { spaces } = await this.cu<{ spaces: Array<{ id: string; name: string }> }>(
        `/team/${t.id}/space?archived=false`,
      );
      const found = spaces.find((s) => s.name.trim().toLowerCase() === wantName.toLowerCase());
      if (found) return { spaceId: found.id, spaceName: found.name };
    }
    throw new Error(`Espaço "${wantName}" não encontrado (fora do escritório).`);
  }

  /** Todas as listas do espaço (com nome), pastas + sem pasta. */
  private async spaceLists(spaceId: string): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    const { folders } = await this.cu<{ folders: Array<{ lists: Array<{ id: string; name: string }> }> }>(
      `/space/${spaceId}/folder?archived=false`,
    );
    for (const f of folders) for (const l of f.lists ?? []) out.push({ id: l.id, name: l.name });
    const { lists } = await this.cu<{ lists: Array<{ id: string; name: string }> }>(
      `/space/${spaceId}/list?archived=false`,
    );
    for (const l of lists) out.push({ id: l.id, name: l.name });
    // dedup por id
    return [...new Map(out.map((l) => [l.id, l])).values()];
  }

  /** Quais listas são "de conteúdo" (env CLICKUP_CONTENT_LIST_IDS ou por nome). */
  private contentListIds(lists: Array<{ id: string; name: string }>): Set<string> {
    const byIds = (process.env.CLICKUP_CONTENT_LIST_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (byIds.length) return new Set(byIds);
    const names = (process.env.CLICKUP_CONTENT_LIST_NAMES ?? 'Gestão de Temas')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return new Set(lists.filter((l) => names.some((n) => l.name.trim().toLowerCase().includes(n))).map((l) => l.id));
  }

  // include_closed=true: senão o ClickUp esconde tarefas fechadas (ex.: "complete").
  private async fetchTasks(listId: string): Promise<CuTask[]> {
    const out: CuTask[] = [];
    for (let page = 0; page < 30; page++) {
      const { tasks } = await this.cu<{ tasks: CuTask[] }>(
        `/list/${listId}/task?archived=false&include_closed=true&subtasks=true&page=${page}`,
      );
      out.push(...tasks);
      if (tasks.length < 100) break;
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
    return p?.priority === 'urgent' || p?.priority === 'high' ? 'alta' : 'normal';
  }

  /** Resolve um custom field pelo nome (dropdown → nome da opção). */
  private cf(task: CuTask, needle: string): string | null {
    const f = (task.custom_fields ?? []).find((x) => x.name.trim().toLowerCase().includes(needle.toLowerCase()));
    if (!f || f.value === null || f.value === undefined || f.value === '') return null;
    if (f.type === 'drop_down') {
      const opts = f.type_config?.options ?? [];
      const opt = opts.find((o) => o.id === f.value || String(o.orderindex) === String(f.value));
      return opt?.name ?? null;
    }
    if (Array.isArray(f.value)) return f.value.map(String).join(', ') || null;
    return String(f.value);
  }

  async sync(orgId: string, actorId?: string): Promise<{ tasks: number; content: number; lists: number }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'ClickUp não configurado: defina CLICKUP_API_TOKEN em ~/.config/root/clickup.env e reinicie a API.',
      );
    }
    const started = Date.now();
    try {
      const { spaceId, spaceName } = await this.resolveSpace();
      const lists = await this.spaceLists(spaceId);
      const contentIds = this.contentListIds(lists);
      const taskLists = lists.filter((l) => !contentIds.has(l.id));
      const contentLists = lists.filter((l) => contentIds.has(l.id));
      this.log.log(
        `ClickUp: espaço "${spaceName}" — ${taskLists.length} lista(s) de tarefa, ${contentLists.length} de conteúdo`,
      );

      // --- Tarefas operacionais → Task ---
      const taskRows: any[] = [];
      for (const l of taskLists) {
        for (const t of await this.fetchTasks(l.id)) {
          taskRows.push({
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
          });
        }
      }

      // --- Conteúdo (pipeline) → ContentItem (status cru + campos) ---
      const contentRows: any[] = [];
      for (const l of contentLists) {
        for (const t of await this.fetchTasks(l.id)) {
          contentRows.push({
            orgId,
            source: 'clickup',
            externalId: t.id,
            listId: l.id,
            listName: l.name,
            title: t.name,
            status: t.status?.status ?? '—',
            statusType: t.status?.type ?? null,
            formato: this.cf(t, 'formato'),
            eixo: this.cf(t, 'eixo'),
            tipo: this.cf(t, 'tipo'),
            fonte: this.cf(t, 'fonte'),
            assignee: t.assignees?.[0]?.username ?? null,
            url: t.url ?? null,
            dueDate: t.date_due ? new Date(Number(t.date_due)) : null,
          });
        }
      }

      await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { orgId, tool: 'clickup' } }),
        ...(taskRows.length ? [this.prisma.task.createMany({ data: taskRows })] : []),
        this.prisma.contentItem.deleteMany({ where: { orgId, source: 'clickup' } }),
        ...(contentRows.length ? [this.prisma.contentItem.createMany({ data: contentRows })] : []),
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
        after: { tasks: taskRows.length, content: contentRows.length },
      });
      this.log.log(
        `ClickUp sync: ${taskRows.length} tarefa(s) + ${contentRows.length} conteúdo(s) em ${latencyMs}ms`,
      );
      return { tasks: taskRows.length, content: contentRows.length, lists: lists.length };
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
