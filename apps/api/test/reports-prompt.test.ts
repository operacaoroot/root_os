import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from '../src/reports/reports.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { selectedWorkTasks } from '../src/work/selected-work-tasks';
import type { LlmMessage } from '../src/llm/llm.provider';

const selectors = [
  { listId: 'internal-list-single' },
  { listIds: 'internal-list-a,internal-list-b' },
  { listExternalIds: 'external-list-a,external-list-b' },
];
const filters = {
  statusId: 'internal-status', tagId: 'internal-tag', opcao: 'internal-option:internal-value',
  assignee: 'internal-assignee', q: 'selection-search', arquivadas: 'true',
  dueFrom: '2026-10-01T00:00:00Z', dueTo: '2026-10-07T00:00:00Z', page: '2', limit: '1',
};
const items = Array.from({ length: 6 }, (_, i) => ({
  id: `internal-task-${i}`, title: `Revisar contrato ${i} — referência 11111111-2222-4333-8444-555555555555`, overdue: true,
}));

function fixture() {
  let saved: any;
  const count = vi.fn(async () => 2);
  const prisma = {
    lead: { count }, pixelEvent: { findMany: async () => [{ value: 120 }] },
    task: { count: vi.fn(async () => 6) }, campaign: { count, aggregate: async () => ({ _sum: { spend: 30 } }) },
    report: {
      create: vi.fn(async ({ data }: any) => (saved = { ...data, id: 'report', createdAt: new Date('2026-10-06T00:00:00Z') })),
      findFirst: vi.fn(async () => saved), findMany: vi.fn(async () => [saved]), count: vi.fn(async () => 1),
    },
  };
  const work = { tarefas: vi.fn(async () => ({ items, total: 6, source: { tool: 'trabalho-interno', listId: 'source-list-id' } })) };
  const legacy = { list: vi.fn(async () => ({ overdue: 6, items })) };
  const complete = vi.fn(async (_input: LlmMessage) => 'Resumo sintético');
  const svc = new ReportsService(
    prisma as any, new DashboardService(prisma as any, work as any),
    { metrics: async () => ({ stages: [{ label: 'Contato', count: 2, convFromPrev: null }] }) } as any,
    { summary: async () => ({ window: { since: '2026-10-01T00:00:00Z', until: '2026-10-06T00:00:00Z' }, totals: { total: 2 } }) } as any,
    legacy as any, work as any,
    { list: async () => ({ items: [{ id: 'internal-campaign', name: 'Campanha de outubro', status: 'problema', cpl: 15, leads: 2 }] }) } as any,
    { configured: true, name: 'qa', model: 'deterministico', complete } as any,
  );
  return { svc, prisma, work, legacy, complete };
}

describe('projeção do prompt de Reports', () => {
  it.each(selectors)('omite seleção e IDs de %j e preserva snapshot/API', async (selector) => {
    const selection = selectedWorkTasks({ permissions: ['tarefas.ver'] } as any, { ...selector, ...filters })!;
    const { svc, prisma, work, legacy, complete } = fixture();
    const generated = await svc.generateDaily('qa-org', selection);
    const input = complete.mock.calls[0][0];
    // A rodada dos agentes (21/10/2026) marca a função do cadastro (CE-03, o briefing antigo) em toda chamada.
    expect(input).toEqual({ funcao: 'CE-03', system: expect.any(String), user: expect.any(String), orgId: 'qa-org' });
    const fullArgument = JSON.stringify(input);
    for (const value of [...Object.values(selector).flatMap((s) => s.split(',')), filters.statusId, filters.tagId, filters.opcao, filters.assignee, filters.q, 'source-list-id', 'internal-campaign', ...items.map((t) => t.id)]) {
      expect(fullArgument).not.toContain(value);
    }
    const prompt = JSON.parse(input.user.split('Dados (JSON):\n')[1]);
    const promptJson = JSON.stringify(prompt);
    for (const key of ['selection', 'listId', 'listIds', 'listExternalIds', 'statusId', 'tagId', 'opcao', 'assignee', 'q', 'taskIds', 'ids']) {
      expect(promptJson).not.toContain(`"${key}"`);
    }
    expect(prompt.tarefas).toEqual({ source: { tool: 'trabalho-interno' }, total: 6 });
    expect(prompt.dashboard).toMatchObject({ taskSource: 'trabalho-interno', taskTotal: 6, overdueTasks: 6, revenue: 120, cpl: 15 });
    expect(prompt.tarefasAtrasadas).toEqual({ total: 6, exemplos: items.slice(0, 5).map((t) => t.title) });
    expect(prompt.campanhasEmRisco).toEqual([{ nome: 'Campanha de outubro', cpl: 15, leads: 2 }]);
    const saved = prisma.report.create.mock.calls[0][0].data.data;
    expect(saved.tarefas).toEqual({ source: { tool: 'trabalho-interno', listId: 'source-list-id' }, selection, total: 6, ids: items.map((t) => t.id) });
    expect(saved.dashboard.taskIds).toEqual(items.map((t) => t.id));
    expect(generated).toMatchObject({ taskScope: saved.tarefas, summary: 'Resumo sintético' });
    expect(await svc.latest('qa-org')).toEqual(generated);
    expect((await svc.list('qa-org')).items).toEqual([generated]);
    await expect(svc.latest('qa-org', false)).rejects.toThrow('Permissão insuficiente');
    await expect(svc.list('qa-org', 30, false)).rejects.toThrow('Permissão insuficiente');
    expect(work.tarefas).toHaveBeenCalledWith('qa-org', { ...selection, page: 1, limit: 500 });
    expect(legacy.list).not.toHaveBeenCalled();
  });

  it('mantém geração e reabertura legadas sem permissão de tarefas', async () => {
    const { svc, prisma, work, legacy, complete } = fixture();
    const generated = await svc.generateDaily('qa-org');
    const prompt = JSON.parse(complete.mock.calls[0][0].user.split('Dados (JSON):\n')[1]);
    expect(prompt.tarefas).toEqual({ source: { tool: 'tarefas-legadas' } });
    expect(prompt.dashboard).toMatchObject({ taskSource: 'tarefas-legadas', overdueTasks: 6 });
    expect(prompt.dashboard).not.toHaveProperty('taskTotal');
    expect(prompt.tarefasAtrasadas).toEqual({ total: 6, exemplos: items.slice(0, 5).map((t) => t.title) });
    expect(prisma.report.create.mock.calls[0][0].data.data.tarefas).toEqual({ source: { tool: 'tarefas-legadas' } });
    expect(await svc.latest('qa-org', false)).toEqual(generated);
    expect((await svc.list('qa-org', 30, false)).items).toEqual([generated]);
    expect(work.tarefas).not.toHaveBeenCalled();
    expect(legacy.list).toHaveBeenCalledWith('qa-org', { overdue: true });
  });
});
