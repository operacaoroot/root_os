import { describe, expect, it, vi } from 'vitest';
import { WorkService } from '../src/work/work.service';
import { parseWorkTaskQuery } from '../src/work/work-task-query';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import type { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';

function linha(n: number, orgId = 'root', dueDate = new Date('2026-09-30T12:00:00Z')) {
  return {
    id: `t-${String(n).padStart(4, '0')}`, orgId, listId: 'lista', title: `Tarefa ${n}`,
    statusId: 'status', status: { name: 'A fazer', type: 'open', color: '#fff' },
    priority: 'normal', assignee: null, assigneeUserId: null, assigneeUser: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), agenteId: null, agenteEm: null, statusDesde: null,
    dueDate, startDate: null, parentId: null, externalId: null, externalUrl: null,
    archived: false, order: 0, createdAt: new Date('2026-09-01T00:00:00Z'),
    tags: [], values: [], _count: { subtasks: 0, comments: 0 },
  };
}

describe('projeção paginada de WorkTask', () => {
  it('valida limites, fuso explícito e filtros incompatíveis', () => {
    expect(parseWorkTaskQuery({})).toMatchObject({ page: 1, limit: 500 });
    expect(parseWorkTaskQuery({ dueFrom: '2026-09-30T00:00:00-03:00' }).dueFrom?.toISOString())
      .toBe('2026-09-30T03:00:00.000Z');
    for (const raw of [
      { page: '0' }, { limit: '501' }, { page: '1.5' },
      { dueFrom: '2026-09-30' },
      { dueFrom: '2026-02-31T00:00:00Z' },
      { dueFrom: '2026-10-01T03:00:00Z', dueTo: '2026-10-01T03:00:00Z' },
      { listId: 'uma', listExternalIds: 'outra' },
      { listIds: ',,' },
    ]) expect(() => parseWorkTaskQuery(raw)).toThrow();
  });

  it('mantém o filtro antigo de uma lista e aceita seleção por IDs internos', async () => {
    const findMany = vi.fn(async (_args: any) => []);
    const count = vi.fn(async (_args: any) => 0);
    const svc = new WorkService(
      { workTask: { findMany, count } } as unknown as PrismaService,
      {} as AuditService, {} as CheckoutDeTarefaService,
    );
    await svc.tarefas('root', parseWorkTaskQuery({ listId: 'l1' }));
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { orgId: 'root', listId: 'l1', archived: false }, skip: 0, take: 500 });
    await svc.tarefas('root', parseWorkTaskQuery({ listIds: 'l1,l2' }));
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { orgId: 'root', listId: { in: ['l1', 'l2'] }, archived: false } });
    expect(count.mock.calls[1][0].where).toEqual(findMany.mock.calls[1][0].where);
  });

  it('filtra por empresa, lista externa e dia; total 501 continua correto na segunda página', async () => {
    const start = new Date('2026-09-30T03:00:00Z');
    const end = new Date('2026-10-01T03:00:00Z');
    const all = [
      ...Array.from({ length: 501 }, (_, i) => linha(i)),
      linha(700, 'vizinha'),
      linha(701, 'root', end),
      linha(702, 'root', new Date(start.getTime() - 1)),
      { ...linha(703), archived: true },
    ];
    const matching = (where: any) => all.filter((r) =>
      r.orgId === where.orgId && !r.archived &&
      r.dueDate >= where.dueDate.gte && r.dueDate < where.dueDate.lt &&
      where.list.externalId.in.includes('901328341442'));
    const findMany = vi.fn(async ({ where, skip, take }: any) => matching(where).slice(skip, skip + take));
    const count = vi.fn(async ({ where }: any) => matching(where).length);
    const groupBy = vi.fn(async () => []);
    const prisma = { workTask: { findMany, count }, workApontamento: { groupBy } } as unknown as PrismaService;
    const svc = new WorkService(prisma, {} as AuditService, {} as CheckoutDeTarefaService);
    const filter = parseWorkTaskQuery({
      listExternalIds: '901328341442', dueFrom: start.toISOString(), dueTo: end.toISOString(),
      page: '1', limit: '500',
    });
    const first = await svc.tarefas('root', filter);
    const second = await svc.tarefas('root', { ...filter, page: 2 });
    expect(first.items).toHaveLength(500);
    expect(second.items.map((item) => item.id)).toEqual(['t-0500']);
    expect(first.total).toBe(501);
    expect(second.total).toBe(501);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { orgId: 'root', archived: false, list: { orgId: 'root', externalId: { in: ['901328341442'] } }, dueDate: { gte: start, lt: end } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], skip: 0, take: 500,
    });
    expect(findMany.mock.calls[1][0].skip).toBe(500);
    expect(count.mock.calls[0][0].where).toEqual(findMany.mock.calls[0][0].where);
  });
});
