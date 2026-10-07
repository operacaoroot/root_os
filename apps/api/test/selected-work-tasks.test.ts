import { describe, expect, it, vi } from 'vitest';
import { selectedWorkTasks, selectedTaskSnapshot } from '../src/work/selected-work-tasks';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { ReportsService } from '../src/reports/reports.service';
import { DashboardController } from '../src/dashboard/dashboard.controller';
import { ReportsController } from '../src/reports/reports.controller';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';

const user = { orgId: 'qa', permissions: ['tarefas.ver'] } as any;
const selection = selectedWorkTasks(user, { listId: 'qa-list', assignee: 'A' })!;
const items = Array.from({ length: 501 }, (_, i) => ({ id: `uuid-${i}`, title: `T${i}`, overdue: i !== 500 }));
function work() {
  return { tarefas: vi.fn(async (_org: string, q: any) => ({ items: items.slice((q.page - 1) * q.limit, q.page * q.limit), total: 501, source: { tool: 'trabalho-interno' } })) } as any;
}
function prisma() {
  const count = vi.fn(async () => 0);
  return { lead: { count }, pixelEvent: { findMany: async () => [] }, task: { count: vi.fn(async () => 7) }, campaign: { count, aggregate: async () => ({ _sum: { spend: 0 } }) }, report: { create: vi.fn(async ({ data }: any) => ({ ...data, id: 'report', createdAt: new Date() })) } } as any;
}
describe('seleção explícita Dashboard/Reports', () => {
  it('preserva ausência de seleção e recusa acesso/seleção vazia ou ambígua', () => {
    expect(selectedWorkTasks({ permissions: [] } as any, {})).toBeUndefined();
    expect(() => selectedWorkTasks({ permissions: [] } as any, { listId: 'qa' })).toThrow('Permissão');
    expect(() => selectedWorkTasks(user, { listId: '' })).toThrow('vazio');
    expect(() => selectedWorkTasks(user, { listId: 'qa', listIds: 'x' })).toThrow('somente um');
    for (const [controller, permission] of [[DashboardController, 'dashboard.ver'], [ReportsController, 'relatorios.ver']] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype.tarefas)).toEqual([permission, 'tarefas.ver']);
    }
  });
  it('agrega 500+1, conserva filtros/org e recusa snapshot incompleto', async () => {
    const w = work();
    const result = await selectedTaskSnapshot(w, 'qa', selection);
    expect(result.items.map((x) => x.id)).toEqual(items.map((x) => x.id));
    expect(w.tarefas.mock.calls[1]).toEqual(['qa', { ...selection, page: 2, limit: 500 }]);
    w.tarefas.mockResolvedValue({ items: [], total: 501 });
    await expect(selectedTaskSnapshot(w, 'qa', selection)).rejects.toThrow('alteradas');
  });
  it('recusa duplicação entre páginas e mudança de total', async () => {
    const w = work();
    w.tarefas.mockResolvedValueOnce({ items: items.slice(0, 500), total: 501 }).mockResolvedValueOnce({ items: [items[0]], total: 501 });
    await expect(selectedTaskSnapshot(w, 'qa', selection)).rejects.toThrow('alteradas');
    w.tarefas.mockResolvedValueOnce({ items: items.slice(0, 500), total: 501 }).mockResolvedValueOnce({ items: [items[500]], total: 502 });
    await expect(selectedTaskSnapshot(w, 'qa', selection)).rejects.toThrow('alteradas');
  });
  it('Dashboard identifica legado e selecionado sem somar Task', async () => {
    const p = prisma(), w = work(), svc = new DashboardService(p, w);
    expect(await svc.summary('qa')).toMatchObject({ overdueTasks: 7, taskSource: 'tarefas-legadas' });
    p.task.count.mockClear();
    expect(await svc.summary('qa', selection)).toMatchObject({ overdueTasks: 500, taskTotal: 501, taskIds: items.map((x) => x.id), taskSource: 'trabalho-interno' });
    expect(p.task.count).not.toHaveBeenCalled();
  });
  it('Reports persiste os mesmos UUIDs e total com provedor determinístico', async () => {
    const p = prisma(), w = work(), legacy = { list: vi.fn() };
    const llm = { configured: true, name: 'qa', model: 'deterministico', complete: vi.fn(async (_input: any) => 'Resumo QA') };
    const svc = new ReportsService(p, new DashboardService(p, w), { metrics: async () => ({ stages: [] }) } as any, { summary: async () => ({ window: { since: new Date().toISOString(), until: new Date().toISOString() } }) } as any, legacy as any, w, { list: async () => ({ items: [] }) } as any, llm as any);
    await svc.generateDaily('qa', selection);
    const data = p.report.create.mock.calls[0][0].data.data;
    expect(data.tarefas.ids).toEqual(data.dashboard.taskIds);
    expect(data.tarefas.total).toBe(501);
    expect(data.tarefasAtrasadas.total).toBe(500);
    expect(legacy.list).not.toHaveBeenCalled();
    expect(w.tarefas).toHaveBeenCalledTimes(2);
    expect(llm.complete.mock.calls[0][0].user).not.toContain('uuid-500');
  });
});
