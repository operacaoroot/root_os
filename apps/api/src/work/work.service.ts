import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  TrabEstrutura, TrabListaDto, TrabCampoDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabTarefaCreateInput, TrabTarefaUpdateInput,
} from '@mktos/shared';
import { Prisma, WorkFieldType, WorkPriority, WorkStatusType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Módulo TRABALHO: gestão de tarefas estilo ClickUp, nativa do mkt-os.
// Hierarquia pastas → listas → tarefas; statuses POR LISTA; campos personalizados
// com opções; etiquetas; comentários. Semente = fotografia do espaço `root`
// (25/07/2026); externalId preserva o id ClickUp p/ reconciliação futura.

const TASK_INCLUDE = {
  status: true,
  tags: true,
  values: { include: { field: true, option: true } },
  _count: { select: { subtasks: true, comments: true } },
} satisfies Prisma.WorkTaskInclude;

type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- estrutura (árvore + catálogos) ----------

  private mapField(f: Prisma.WorkFieldGetPayload<{ include: { options: true } }>): TrabCampoDto {
    return {
      id: f.id, listId: f.listId, name: f.name, type: f.type, order: f.order,
      options: f.options
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ id: o.id, name: o.name, color: o.color, order: o.order })),
    };
  }

  async estrutura(orgId: string): Promise<TrabEstrutura> {
    const [folders, lists, fields, tags, counts, byStatus, users] = await Promise.all([
      this.prisma.workFolder.findMany({ where: { orgId }, orderBy: { order: 'asc' } }),
      this.prisma.workList.findMany({
        where: { orgId },
        orderBy: { order: 'asc' },
        include: { statuses: { orderBy: { order: 'asc' } }, fields: { include: { options: true } } },
      }),
      this.prisma.workField.findMany({ where: { orgId, listId: null }, include: { options: true }, orderBy: { order: 'asc' } }),
      this.prisma.workTag.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
      this.prisma.workTask.groupBy({ by: ['listId'], where: { orgId, archived: false }, _count: true }),
      this.prisma.workTask.groupBy({ by: ['statusId'], where: { orgId, archived: false }, _count: true }),
      this.prisma.workTask.findMany({
        where: { orgId, assignee: { not: null } },
        distinct: ['assignee'], select: { assignee: true },
      }),
    ]);
    const porLista = new Map(counts.map((c) => [c.listId, c._count]));
    const porStatus = new Map(byStatus.map((c) => [c.statusId, c._count]));

    const toLista = (l: (typeof lists)[number]): TrabListaDto => ({
      id: l.id, name: l.name, order: l.order, externalId: l.externalId,
      total: porLista.get(l.id) ?? 0,
      statuses: l.statuses.map((s) => ({
        id: s.id, name: s.name, type: s.type, color: s.color, order: s.order,
        total: porStatus.get(s.id) ?? 0,
      })),
      fields: l.fields.sort((a, b) => a.order - b.order).map((f) => this.mapField(f)),
    });

    return {
      folders: folders.map((fo) => ({
        id: fo.id, name: fo.name, order: fo.order,
        lists: lists.filter((l) => l.folderId === fo.id).map(toLista),
      })),
      listasSoltas: lists.filter((l) => !l.folderId).map(toLista),
      camposGlobais: fields.map((f) => this.mapField(f)),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      responsaveis: users.map((u) => u.assignee!).sort(),
    };
  }

  // ---------- pastas ----------

  criarPasta(orgId: string, actorId: string, input: { name: string }) {
    return this.logado(orgId, actorId, 'work.folder.create', 'work_folder', null, () =>
      this.prisma.workFolder.create({ data: { orgId, name: input.name } }),
    );
  }

  async editarPasta(orgId: string, actorId: string, id: string, input: { name?: string; order?: number }) {
    await this.achar(this.prisma.workFolder, orgId, id, 'Pasta');
    return this.logado(orgId, actorId, 'work.folder.update', 'work_folder', id, () =>
      this.prisma.workFolder.update({ where: { id }, data: input }),
    );
  }

  async apagarPasta(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workFolder, orgId, id, 'Pasta');
    const listas = await this.prisma.workList.count({ where: { folderId: id } });
    if (listas > 0) throw new BadRequestException('Pasta tem listas — mova ou apague antes.');
    return this.logado(orgId, actorId, 'work.folder.delete', 'work_folder', id, () =>
      this.prisma.workFolder.delete({ where: { id } }),
    );
  }

  // ---------- listas ----------

  async criarLista(orgId: string, actorId: string, input: { folderId?: string | null; name: string }) {
    return this.logado(orgId, actorId, 'work.list.create', 'work_list', null, async () => {
      const list = await this.prisma.workList.create({
        data: { orgId, folderId: input.folderId ?? null, name: input.name },
      });
      // toda lista nasce com um pipeline mínimo (padrão ClickUp: open → custom → closed)
      const padrao = [
        { name: 'A fazer', type: WorkStatusType.open, color: '#87909e', order: 0 },
        { name: 'Em andamento', type: WorkStatusType.custom, color: '#f9d900', order: 1 },
        { name: 'Concluída', type: WorkStatusType.closed, color: '#6bc950', order: 2 },
      ];
      await this.prisma.workStatus.createMany({ data: padrao.map((s) => ({ ...s, listId: list.id })) });
      return list;
    });
  }

  async editarLista(orgId: string, actorId: string, id: string, input: { folderId?: string | null; name?: string; order?: number }) {
    await this.achar(this.prisma.workList, orgId, id, 'Lista');
    return this.logado(orgId, actorId, 'work.list.update', 'work_list', id, () =>
      this.prisma.workList.update({ where: { id }, data: input }),
    );
  }

  async apagarLista(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workList, orgId, id, 'Lista');
    const tarefas = await this.prisma.workTask.count({ where: { listId: id } });
    if (tarefas > 0) throw new BadRequestException('Lista tem tarefas — mova ou arquive antes.');
    return this.logado(orgId, actorId, 'work.list.delete', 'work_list', id, () =>
      this.prisma.workList.delete({ where: { id } }),
    );
  }

  // ---------- statuses (pipeline por lista) ----------

  async criarStatus(orgId: string, actorId: string, listId: string, input: { name: string; type: WorkStatusType; color?: string }) {
    await this.achar(this.prisma.workList, orgId, listId, 'Lista');
    const max = await this.prisma.workStatus.aggregate({ where: { listId }, _max: { order: true } });
    return this.logado(orgId, actorId, 'work.status.create', 'work_status', null, () =>
      this.prisma.workStatus.create({
        data: { listId, name: input.name, type: input.type, color: input.color ?? '#ee5e99', order: (max._max.order ?? 0) + 1 },
      }),
    );
  }

  async editarStatus(orgId: string, actorId: string, id: string, input: { name?: string; type?: WorkStatusType; color?: string; order?: number }) {
    const st = await this.prisma.workStatus.findFirst({ where: { id, list: { orgId } } });
    if (!st) throw new NotFoundException('Status não encontrado');
    return this.logado(orgId, actorId, 'work.status.update', 'work_status', id, () =>
      this.prisma.workStatus.update({ where: { id }, data: input }),
    );
  }

  async apagarStatus(orgId: string, actorId: string, id: string) {
    const st = await this.prisma.workStatus.findFirst({ where: { id, list: { orgId } } });
    if (!st) throw new NotFoundException('Status não encontrado');
    const emUso = await this.prisma.workTask.count({ where: { statusId: id } });
    if (emUso > 0) throw new BadRequestException(`Status em uso por ${emUso} tarefa(s) — mova-as antes.`);
    return this.logado(orgId, actorId, 'work.status.delete', 'work_status', id, () =>
      this.prisma.workStatus.delete({ where: { id } }),
    );
  }

  // ---------- campos personalizados + opções ----------

  async criarCampo(orgId: string, actorId: string, input: { listId?: string | null; name: string; type: WorkFieldType }) {
    if (input.listId) await this.achar(this.prisma.workList, orgId, input.listId, 'Lista');
    return this.logado(orgId, actorId, 'work.field.create', 'work_field', null, () =>
      this.prisma.workField.create({ data: { orgId, listId: input.listId ?? null, name: input.name, type: input.type } }),
    );
  }

  async editarCampo(orgId: string, actorId: string, id: string, input: { name?: string; order?: number }) {
    await this.achar(this.prisma.workField, orgId, id, 'Campo');
    return this.logado(orgId, actorId, 'work.field.update', 'work_field', id, () =>
      this.prisma.workField.update({ where: { id }, data: input }),
    );
  }

  async apagarCampo(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workField, orgId, id, 'Campo');
    return this.logado(orgId, actorId, 'work.field.delete', 'work_field', id, () =>
      this.prisma.workField.delete({ where: { id } }), // valores caem em cascata
    );
  }

  async criarOpcao(orgId: string, actorId: string, fieldId: string, input: { name: string; color?: string }) {
    await this.achar(this.prisma.workField, orgId, fieldId, 'Campo');
    const max = await this.prisma.workFieldOption.aggregate({ where: { fieldId }, _max: { order: true } });
    return this.logado(orgId, actorId, 'work.option.create', 'work_field_option', null, () =>
      this.prisma.workFieldOption.create({
        data: { fieldId, name: input.name, color: input.color ?? '#87909e', order: (max._max.order ?? 0) + 1 },
      }),
    );
  }

  async editarOpcao(orgId: string, actorId: string, id: string, input: { name?: string; color?: string; order?: number }) {
    const opt = await this.prisma.workFieldOption.findFirst({ where: { id, field: { orgId } } });
    if (!opt) throw new NotFoundException('Opção não encontrada');
    return this.logado(orgId, actorId, 'work.option.update', 'work_field_option', id, () =>
      this.prisma.workFieldOption.update({ where: { id }, data: input }),
    );
  }

  async apagarOpcao(orgId: string, actorId: string, id: string) {
    const opt = await this.prisma.workFieldOption.findFirst({ where: { id, field: { orgId } } });
    if (!opt) throw new NotFoundException('Opção não encontrada');
    return this.logado(orgId, actorId, 'work.option.delete', 'work_field_option', id, () =>
      this.prisma.workFieldOption.delete({ where: { id } }),
    );
  }

  // ---------- etiquetas ----------

  criarTag(orgId: string, actorId: string, input: { name: string; color?: string }) {
    return this.logado(orgId, actorId, 'work.tag.create', 'work_tag', null, () =>
      this.prisma.workTag.create({ data: { orgId, name: input.name, color: input.color ?? '#5f55ee' } }),
    );
  }

  async editarTag(orgId: string, actorId: string, id: string, input: { name?: string; color?: string }) {
    await this.achar(this.prisma.workTag, orgId, id, 'Etiqueta');
    return this.logado(orgId, actorId, 'work.tag.update', 'work_tag', id, () =>
      this.prisma.workTag.update({ where: { id }, data: input }),
    );
  }

  async apagarTag(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workTag, orgId, id, 'Etiqueta');
    return this.logado(orgId, actorId, 'work.tag.delete', 'work_tag', id, () =>
      this.prisma.workTag.delete({ where: { id } }),
    );
  }

  // ---------- tarefas ----------

  private mapTask(t: TaskRow, now: Date): TrabTarefaResumo {
    return {
      id: t.id, listId: t.listId, title: t.title,
      statusId: t.statusId, statusName: t.status.name, statusType: t.status.type, statusColor: t.status.color,
      priority: t.priority, assignee: t.assignee,
      dueDate: t.dueDate?.toISOString() ?? null, startDate: t.startDate?.toISOString() ?? null,
      overdue: !!t.dueDate && t.dueDate < now && t.status.type !== 'closed',
      parentId: t.parentId, subtasks: t._count.subtasks, comments: t._count.comments,
      externalId: t.externalId, externalUrl: t.externalUrl, archived: t.archived, order: t.order,
      tags: t.tags.map((tg) => ({ id: tg.id, name: tg.name, color: tg.color })),
      values: t.values.map((v) => ({
        fieldId: v.fieldId, fieldName: v.field.name, type: v.field.type,
        optionId: v.optionId, optionName: v.option?.name ?? null, optionColor: v.option?.color ?? null,
        value: v.value,
      })),
    };
  }

  async tarefas(
    orgId: string,
    f: { listId?: string; statusId?: string; assignee?: string; tagId?: string; q?: string; arquivadas?: boolean; opcao?: string },
  ): Promise<TrabTarefaLista> {
    const where: Prisma.WorkTaskWhereInput = { orgId, archived: f.arquivadas ? undefined : false };
    if (f.listId) where.listId = f.listId;
    if (f.statusId) where.statusId = f.statusId;
    if (f.assignee) where.assignee = f.assignee;
    if (f.tagId) where.tags = { some: { id: f.tagId } };
    if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
    if (f.opcao) where.values = { some: { optionId: f.opcao } }; // filtro por opção de campo
    const rows = await this.prisma.workTask.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const now = new Date();
    return {
      items: rows.map((t) => this.mapTask(t, now)),
      total: rows.length,
      source: { tool: 'trabalho-interno', generatedAt: now.toISOString() },
    };
  }

  async tarefa(orgId: string, id: string): Promise<TrabTarefaDetalhe> {
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId },
      include: {
        ...TASK_INCLUDE,
        list: true,
        comments: { orderBy: { createdAt: 'desc' } },
        subtasks: { include: { status: true } },
      },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const atividade = await this.prisma.auditLog.findMany({
      where: { orgId, entityType: 'work_task', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // AuditLog não tem relação com User (actorId é livre) → resolve nomes à parte
    const actorIds = [...new Set(atividade.map((a) => a.actorId).filter((x): x is string => !!x))];
    const atores = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const nomePorAtor = new Map(atores.map((u) => [u.id, u.name]));
    const now = new Date();
    return {
      ...this.mapTask(t, now),
      description: t.description, listName: t.list.name,
      createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      comentarios: t.comments.map((c) => ({
        id: c.id, authorId: c.authorId, authorName: c.authorName, text: c.text,
        createdAt: c.createdAt.toISOString(),
      })),
      atividade: atividade.map((a) => ({
        id: a.id, actorType: a.actorType, actorName: (a.actorId && nomePorAtor.get(a.actorId)) ?? null, action: a.action,
        before: a.before, after: a.after, createdAt: a.createdAt.toISOString(),
      })),
      filhos: t.subtasks.map((s) => ({
        id: s.id, title: s.title, statusName: s.status.name, statusColor: s.status.color,
      })),
    };
  }

  async criarTarefa(orgId: string, actorId: string, input: TrabTarefaCreateInput) {
    const list = await this.prisma.workList.findFirst({
      where: { id: input.listId, orgId },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    if (!list) throw new NotFoundException('Lista não encontrada');
    if (list.statuses.length === 0) throw new BadRequestException('Lista sem statuses.');
    const statusId = input.statusId ?? list.statuses[0].id;
    if (!list.statuses.some((s) => s.id === statusId)) {
      throw new BadRequestException('Status não pertence à lista.');
    }
    return this.logado(orgId, actorId, 'work.task.create', 'work_task', null, async () => {
      const task = await this.prisma.workTask.create({
        data: {
          orgId, listId: list.id, statusId,
          title: input.title, description: input.description ?? null,
          priority: (input.priority as WorkPriority) ?? WorkPriority.normal,
          assignee: input.assignee ?? null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          startDate: input.startDate ? new Date(input.startDate) : null,
          parentId: input.parentId ?? null,
          tags: input.tagIds ? { connect: input.tagIds.map((id) => ({ id })) } : undefined,
        },
      });
      if (input.campos) await this.gravarCampos(orgId, task.id, task.listId, input.campos);
      return this.tarefa(orgId, task.id);
    });
  }

  async editarTarefa(orgId: string, actorId: string, id: string, input: TrabTarefaUpdateInput) {
    const antes = await this.prisma.workTask.findFirst({ where: { id, orgId }, include: { status: true, tags: true } });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');

    const listId = input.listId ?? antes.listId;
    let statusId = input.statusId;
    if (input.listId && input.listId !== antes.listId && !statusId) {
      // mover de lista sem status novo → cai no primeiro status da lista destino
      const primeiro = await this.prisma.workStatus.findFirst({ where: { listId }, orderBy: { order: 'asc' } });
      if (!primeiro) throw new BadRequestException('Lista destino sem statuses.');
      statusId = primeiro.id;
    }
    if (statusId) {
      const ok = await this.prisma.workStatus.findFirst({ where: { id: statusId, listId } });
      if (!ok) throw new BadRequestException('Status não pertence à lista da tarefa.');
    }

    const depois = await this.prisma.workTask.update({
      where: { id },
      data: {
        listId: input.listId,
        statusId,
        title: input.title,
        description: input.description === undefined ? undefined : input.description,
        priority: input.priority as WorkPriority | undefined,
        assignee: input.assignee === undefined ? undefined : input.assignee,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        startDate: input.startDate === undefined ? undefined : input.startDate ? new Date(input.startDate) : null,
        parentId: input.parentId === undefined ? undefined : input.parentId,
        archived: input.archived,
        order: input.order,
        tags: input.tagIds ? { set: input.tagIds.map((tid) => ({ id: tid })) } : undefined,
      },
      include: { status: true },
    });
    if (input.campos) await this.gravarCampos(orgId, id, listId, input.campos);

    await this.audit.log({
      orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: id,
      before: { status: antes.status.name, title: antes.title, assignee: antes.assignee, priority: antes.priority },
      after: { status: depois.status.name, title: depois.title, assignee: depois.assignee, priority: depois.priority },
    });
    return this.tarefa(orgId, id);
  }

  /** Grava valores de campos personalizados; dropdown valida a opção do campo. */
  private async gravarCampos(
    orgId: string, taskId: string, listId: string,
    campos: Record<string, { optionId?: string | null; value?: string | null }>,
  ) {
    for (const [fieldId, v] of Object.entries(campos)) {
      const field = await this.prisma.workField.findFirst({
        where: { id: fieldId, orgId, OR: [{ listId }, { listId: null }] },
        include: { options: true },
      });
      if (!field) throw new BadRequestException(`Campo ${fieldId} não vale para esta lista.`);
      if (v.optionId === null || (v.optionId === undefined && (v.value === null || v.value === undefined))) {
        await this.prisma.workFieldValue.deleteMany({ where: { taskId, fieldId } });
        continue;
      }
      if (v.optionId && !field.options.some((o) => o.id === v.optionId)) {
        throw new BadRequestException(`Opção não pertence ao campo ${field.name}.`);
      }
      await this.prisma.workFieldValue.upsert({
        where: { taskId_fieldId: { taskId, fieldId } },
        update: { optionId: v.optionId ?? null, value: v.value ?? null },
        create: { taskId, fieldId, optionId: v.optionId ?? null, value: v.value ?? null },
      });
    }
  }

  async comentar(orgId: string, actorId: string, taskId: string, text: string) {
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const autor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const c = await this.prisma.workComment.create({
      data: { taskId, authorId: actorId, authorName: autor?.name ?? 'sistema', text },
    });
    await this.audit.log({
      orgId, actorId, action: 'work.comment.create', entityType: 'work_task', entityId: taskId,
      after: { comment: text.slice(0, 200) },
    });
    return { id: c.id, createdAt: c.createdAt.toISOString() };
  }

  // ---------- utilitários ----------

  /** findFirst({id, orgId}) genérico com 404. */
  private async achar(
    modelo: { findFirst(args: { where: { id: string; orgId: string } }): Promise<unknown | null> },
    orgId: string, id: string, rotulo: string,
  ) {
    const achado = await modelo.findFirst({ where: { id, orgId } });
    if (!achado) throw new NotFoundException(`${rotulo} não encontrada`);
    return achado;
  }

  /** executa a escrita e registra na auditoria (entityId do resultado quando criar). */
  private async logado<T extends { id?: string }>(
    orgId: string, actorId: string, action: string, entityType: string, entityId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const res = await fn();
    await this.audit.log({
      orgId, actorId, action, entityType,
      entityId: entityId ?? res.id ?? undefined,
    });
    return res;
  }
}
