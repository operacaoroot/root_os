import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MODELOS_DE_LISTA } from '@mktos/shared';
import type {
  TrabEstrutura, TrabListaDto, TrabCampoDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabTarefaCreateInput, TrabTarefaUpdateInput,
  TrabApontamentoCreateInput, TrabApontamentoDto, TrabListaDoModeloInput, ModeloDeLista,
} from '@mktos/shared';
import { Prisma, WorkFieldType, WorkPriority, WorkStatusType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutDeTarefaService } from './checkout-de-tarefa.service';
import { agentesDaCasa, type AgenteDaCasa } from './agentes-da-casa';

// Módulo TRABALHO: gestão de tarefas estilo ClickUp, nativa do mkt-os.
// Hierarquia pastas → listas → tarefas; statuses POR LISTA; campos personalizados
// com opções; etiquetas; comentários. Semente = fotografia do espaço `root`
// (25/07/2026); externalId preserva o id ClickUp p/ reconciliação futura.

/*
 * `agente` NÃO ENTRA NESTE `include`, e é decisão, não esquecimento.
 *
 * `include: { agente: true }` resolveria o nome do agente numa consulta só — e
 * traria o agente que estiver do outro lado do ponteiro, de QUALQUER empresa: o
 * Prisma não filtra relação para um dentro do include. É a mesma armadilha que
 * `agents/donos-da-casa.ts` documenta para o dono humano, e o quadro de Trabalho
 * é lido pelo cliente. Quem resolve é `agentes-da-casa.ts`, com consulta
 * escopada por empresa; ponteiro atravessado devolve nulo e a tela diz "outro
 * agente".
 */
const TASK_INCLUDE = {
  status: true,
  tags: true,
  values: { include: { field: true, option: true } },
  _count: { select: { subtasks: true, comments: true } },
} satisfies Prisma.WorkTaskInclude;

type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/**
 * O dia de HOJE no fuso de Brasília, como AAAA-MM-DD.
 *
 * Apontamento é por dia, e o dia de quem aponta é o do relógio dele: às 22h de
 * terça em Brasília o UTC já é quarta, e `toISOString()` publicaria a hora no dia
 * seguinte. A empresa é brasileira; fuso por empresa entra quando houver cliente
 * fora dele.
 */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
}

/** `true` só para data de calendário que existe (recusa 2026-02-31). */
export function diaDeCalendarioValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const d = new Date(`${dia}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly checkout: CheckoutDeTarefaService,
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
    const [folders, lists, fields, tags, counts, byStatus, users, agentes] = await Promise.all([
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
      /*
       * OS AGENTES VÊM DA MESMA CHAMADA QUE A ÁRVORE (fatia A4).
       *
       * A tela precisa deles para oferecer a quem entregar a tarefa e para dizer
       * ANTES DO CLIQUE quem pode receber (`podeAssumir`) — mesma disciplina de
       * `/atendimento`, que mostra a alçada antes de alguém tentar assinar. Numa
       * rota separada, a lista chegaria depois do quadro e o seletor apareceria
       * vazio no primeiro instante.
       */
      this.checkout.agentesParaEscolher(orgId),
    ]);
    const porLista = new Map(counts.map((c) => [c.listId, c._count]));
    const porStatus = new Map(byStatus.map((c) => [c.statusId, c._count]));

    const toLista = (l: (typeof lists)[number]): TrabListaDto => ({
      id: l.id, name: l.name, order: l.order, externalId: l.externalId,
      total: porLista.get(l.id) ?? 0,
      statuses: l.statuses.map((s) => ({
        id: s.id, name: s.name, type: s.type, color: s.color, order: s.order,
        total: porStatus.get(s.id) ?? 0, limite: s.limite,
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
      agentes,
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

  async criarStatus(orgId: string, actorId: string, listId: string, input: { name: string; type: WorkStatusType; color?: string; limite?: number | null }) {
    await this.achar(this.prisma.workList, orgId, listId, 'Lista');
    const max = await this.prisma.workStatus.aggregate({ where: { listId }, _max: { order: true } });
    return this.logado(orgId, actorId, 'work.status.create', 'work_status', null, () =>
      this.prisma.workStatus.create({
        data: {
          listId, name: input.name, type: input.type, color: input.color ?? '#ee5e99', order: (max._max.order ?? 0) + 1,
          limite: input.limite ?? null,
        },
      }),
    );
  }

  async editarStatus(orgId: string, actorId: string, id: string, input: { name?: string; type?: WorkStatusType; color?: string; order?: number; limite?: number | null }) {
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

  /**
   * `agentes` é o mapa de `agentes-da-casa.ts` — id -> agente DESTA empresa.
   * Obrigatório de propósito: parâmetro opcional faria o chamador que esquecesse
   * de carregá-lo publicar toda tarefa como "sem agente", que é uma tela
   * mentindo em silêncio. Mapa vazio é resposta válida (nenhuma tarefa travada);
   * mapa ausente, não.
   *
   * `minutos` segue a mesma regra, pelo mesmo motivo: um chamador que esquecesse
   * a soma publicaria "0 h" em cliente que consumiu quarenta.
   */
  private mapTask(
    t: TaskRow,
    now: Date,
    agentes: Map<string, AgenteDaCasa>,
    minutos: Map<string, number>,
  ): TrabTarefaResumo {
    const agente = t.agenteId ? agentes.get(t.agenteId) ?? null : null;
    return {
      id: t.id, listId: t.listId, title: t.title,
      statusId: t.statusId, statusName: t.status.name, statusType: t.status.type, statusColor: t.status.color,
      priority: t.priority, assignee: t.assignee,
      agenteId: t.agenteId, agenteSlug: agente?.slug ?? null, agenteNome: agente?.nome ?? null,
      agenteEm: t.agenteEm?.toISOString() ?? null,
      statusDesde: t.statusDesde?.toISOString() ?? null,
      minutos: minutos.get(t.id) ?? 0,
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
    /*
     * UMA consulta para todos os donos, depois da lista — não uma por tarefa.
     * `agentesDaCasa` já deduplica os ids, então o custo é fixo no número de
     * agentes travando trabalho, não no de tarefas.
     */
    const agentes = await agentesDaCasa(this.prisma, orgId, rows.map((t) => t.agenteId));
    const minutos = await this.minutosPorTarefa(orgId, rows.map((t) => t.id));
    return {
      items: rows.map((t) => this.mapTask(t, now, agentes, minutos)),
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
    const [agentes, apontamentos, porEtapa] = await Promise.all([
      agentesDaCasa(this.prisma, orgId, [t.agenteId]),
      this.prisma.workApontamento.findMany({
        where: { orgId, taskId: id },
        orderBy: [{ dia: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      /*
       * A SOMA POR ETAPA VEM DO BANCO, não dos 200 listados: cliente com mais
       * lançamentos que isso teria a conta cortada em silêncio. A ordem é a da
       * primeira hora gasta em cada etapa, que é a ordem em que o cliente andou.
       */
      this.prisma.workApontamento.groupBy({
        by: ['etapa'],
        where: { orgId, taskId: id },
        _sum: { minutos: true },
        _min: { createdAt: true },
      }),
    ]);
    const minutosDaTarefa = porEtapa.reduce((soma, g) => soma + (g._sum.minutos ?? 0), 0);
    return {
      ...this.mapTask(t, now, agentes, new Map([[t.id, minutosDaTarefa]])),
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
      apontamentos: apontamentos.map((a) => this.mapApontamento(a)),
      minutosPorEtapa: porEtapa
        .slice()
        .sort((a, b) => (a._min.createdAt?.getTime() ?? 0) - (b._min.createdAt?.getTime() ?? 0))
        .map((g) => ({ etapa: g.etapa, minutos: g._sum.minutos ?? 0 })),
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

  // ---------- horas apontadas (esteira de clientes) ----------

  /**
   * Lança horas numa tarefa. A ETAPA é a atual da tarefa, lida aqui — quem
   * aponta não escolhe, porque a pergunta que o número responde é "quanto custou
   * cada etapa" e deixar escolher a etapa deixaria a conta ser ajustada à mão.
   * Hora gasta numa etapa anterior e lançada depois fica na etapa de agora: é
   * limitação conhecida, e a alternativa (reconstruir a etapa do dia pelo
   * histórico) erra mais do que acerta.
   *
   * Não passa pela porta nem por aprovação: é escrita interna do quadro, como o
   * comentário. O gate é `tarefas.editar`.
   */
  async apontar(orgId: string, actorId: string, taskId: string, input: TrabApontamentoCreateInput): Promise<TrabApontamentoDto> {
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, include: { status: true } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const hoje = hojeEmBrasilia();
    const dia = input.dia ?? hoje;
    if (!diaDeCalendarioValido(dia)) throw new BadRequestException(`Dia inválido: ${dia}.`);
    if (dia > hoje) throw new BadRequestException('Dia no futuro: aponte a hora depois de gastá-la.');
    const autor = await this.prisma.user.findFirst({ where: { id: actorId, orgId }, select: { name: true } });
    const a = await this.prisma.workApontamento.create({
      data: {
        orgId, taskId, autorId: actorId, autorNome: autor?.name ?? 'sistema',
        minutos: input.minutos, dia: new Date(`${dia}T00:00:00.000Z`),
        etapa: t.status.name, nota: input.nota ?? null,
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'work.time.create', entityType: 'work_task', entityId: taskId,
      after: { minutos: input.minutos, dia, etapa: t.status.name },
    });
    return this.mapApontamento(a);
  }

  /**
   * Só QUEM LANÇOU apaga. `tarefas.editar` diz quem mexe no quadro; não diz quem
   * pode sumir com a hora de outra pessoa — e a hora é o número que sustenta
   * preço. O apagamento fica na atividade da tarefa, com o que foi apagado.
   */
  async apagarApontamento(orgId: string, actorId: string, id: string) {
    const a = await this.prisma.workApontamento.findFirst({ where: { id, orgId } });
    if (!a) throw new NotFoundException('Apontamento não encontrado');
    if (a.autorId !== actorId) throw new ForbiddenException('Só quem lançou a hora pode apagá-la.');
    await this.prisma.workApontamento.deleteMany({ where: { id, orgId } });
    await this.audit.log({
      orgId, actorId, action: 'work.time.delete', entityType: 'work_task', entityId: a.taskId,
      before: { minutos: a.minutos, dia: a.dia.toISOString().slice(0, 10), etapa: a.etapa },
    });
    return { id };
  }

  private mapApontamento(a: Prisma.WorkApontamentoGetPayload<object>): TrabApontamentoDto {
    return {
      id: a.id, autorId: a.autorId, autorNome: a.autorNome, minutos: a.minutos,
      dia: a.dia.toISOString().slice(0, 10), etapa: a.etapa, nota: a.nota,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** Soma de minutos por tarefa, numa consulta só (a lista tem até 500 tarefas). */
  private async minutosPorTarefa(orgId: string, taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const grupos = await this.prisma.workApontamento.groupBy({
      by: ['taskId'],
      where: { orgId, taskId: { in: taskIds } },
      _sum: { minutos: true },
    });
    return new Map(grupos.map((g) => [g.taskId, g._sum.minutos ?? 0]));
  }

  // ---------- modelos de lista ----------

  /**
   * Cria uma lista pronta a partir de `MODELOS_DE_LISTA` (hoje, a esteira de
   * clientes): etapas com cor, tipo e limite, e campos com opções.
   *
   * Sem transação interativa, como `criarLista`: a sessão de banco carimba a
   * empresa por consulta (`prisma/sessao-de-banco.ts`), e nenhum outro caminho do
   * código abre `$transaction(async ...)` sob ela. Se falhar no meio, sobra uma
   * lista incompleta — visível, editável e apagável pela tela, que é um estado
   * melhor que um caminho de transação que ninguém mais exercita.
   */
  async criarListaDoModelo(orgId: string, actorId: string, input: TrabListaDoModeloInput) {
    const modelo: ModeloDeLista = MODELOS_DE_LISTA[input.modelo];
    if (input.folderId) await this.achar(this.prisma.workFolder, orgId, input.folderId, 'Pasta');
    return this.logado(orgId, actorId, 'work.list.create_from_model', 'work_list', null, async () => {
      const list = await this.prisma.workList.create({
        data: { orgId, folderId: input.folderId ?? null, name: input.name ?? modelo.nome },
      });
      await this.prisma.workStatus.createMany({
        data: modelo.etapas.map((e, i) => ({
          orgId, listId: list.id, name: e.name, type: e.type as WorkStatusType,
          color: e.color, order: i, limite: e.limite,
        })),
      });
      for (const [i, c] of modelo.campos.entries()) {
        const campo = await this.prisma.workField.create({
          data: { orgId, listId: list.id, name: c.name, type: c.type as WorkFieldType, order: i },
        });
        if (c.opcoes && c.opcoes.length > 0) {
          await this.prisma.workFieldOption.createMany({
            data: c.opcoes.map((o, j) => ({ orgId, fieldId: campo.id, name: o.name, color: o.color, order: j })),
          });
        }
      }
      return list;
    });
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
