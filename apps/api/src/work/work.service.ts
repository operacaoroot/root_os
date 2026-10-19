import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MODELOS_DE_LISTA, TRAB_LISTA_COM_DOIS_PAIS, TRAB_PASTA_COM_DOIS_PAIS, ehValorMonetarioCanonico,
  listaDaImplantacao, LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO,
} from '@mktos/shared';
import type {
  TrabEstrutura, TrabListaDto, TrabCampoDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabTarefaCreateInput, TrabTarefaUpdateInput,
  TrabApontamentoCreateInput, TrabApontamentoDto, TrabListaDoModeloInput, ModeloDeLista,
  TrabEspacoCreateInput, TrabEspacoUpdateInput, TrabPastaCreateInput, TrabPastaUpdateInput,
  TrabListaCreateInput, TrabListaUpdateInput, TrabEstruturaSugeridaResultado,
} from '@mktos/shared';
import { Prisma, WorkFieldType, WorkPriority, WorkStatusType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutDeTarefaService } from './checkout-de-tarefa.service';
import { agentesDaCasa, type AgenteDaCasa } from './agentes-da-casa';
import { listarClientes, nomesDosClientes, resolverCliente } from './clientes-da-casa';
import { criarEstruturaSugerida, criarListaDoModeloNoBanco } from './estrutura-sugerida';
import type { WorkTaskQuery } from './work-task-query';

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

type ValorDoCampo = { optionId?: string | null; value?: string | null };
type CampoConferido = { field: Prisma.WorkFieldGetPayload<{ include: { options: true } }>; v: ValorDoCampo };

/** O pai imediato de cada nó da árvore; os dois nulos = fora de espaço. */
type PaiDaPasta = { spaceId: string | null; parentId: string | null };
type PaiDaLista = { folderId: string | null; spaceId: string | null };

const NOME_DE_PASTA_REPETIDO = 'Já existe uma pasta com esse nome neste lugar.';
const NOME_DE_ESPACO_REPETIDO = 'Já existe um espaço com esse nome.';
const PASTA_EM_CICLO = 'A pasta não pode ficar dentro dela mesma nem de uma pasta que está dentro dela.';

/**
 * `true` quando o pedido apaga o valor do campo. Num `moeda` só o valor decide:
 * o campo não tem opção, e `optionId` preenchido já é recusado antes.
 */
function apagaOValor(tipo: WorkFieldType, v: ValorDoCampo): boolean {
  const semValor = v.value === null || v.value === undefined;
  if (tipo === WorkFieldType.moeda) return semValor;
  return v.optionId === null || (v.optionId === undefined && semValor);
}

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
    const [spaces, folders, lists, fields, tags, counts, byStatus, users, agentes] = await Promise.all([
      this.prisma.workSpace.findMany({ where: { orgId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.prisma.workFolder.findMany({ where: { orgId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
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
      id: l.id, name: l.name, order: l.order, externalId: l.externalId, spaceId: l.spaceId,
      total: porLista.get(l.id) ?? 0,
      statuses: l.statuses.map((s) => ({
        id: s.id, name: s.name, type: s.type, color: s.color, order: s.order,
        total: porStatus.get(s.id) ?? 0, limite: s.limite,
      })),
      fields: l.fields.sort((a, b) => a.order - b.order).map((f) => this.mapField(f)),
    });

    return {
      espacos: spaces.map((s) => ({ id: s.id, name: s.name, order: s.order, externalId: s.externalId })),
      folders: folders.map((fo) => ({
        id: fo.id, name: fo.name, order: fo.order,
        spaceId: fo.spaceId, parentId: fo.parentId, externalId: fo.externalId,
        lists: lists.filter((l) => l.folderId === fo.id).map(toLista),
      })),
      listasSoltas: lists.filter((l) => !l.folderId).map(toLista),
      camposGlobais: fields.map((f) => this.mapField(f)),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      responsaveis: users.map((u) => u.assignee!).sort(),
      agentes,
    };
  }

  // ---------- espaços ----------

  criarEspaco(orgId: string, actorId: string, input: TrabEspacoCreateInput) {
    return this.logado(orgId, actorId, 'work.space.create', 'work_space', null, () =>
      this.semNomeRepetido(NOME_DE_ESPACO_REPETIDO, () =>
        this.prisma.workSpace.create({ data: { orgId, name: input.name } })),
    );
  }

  async editarEspaco(orgId: string, actorId: string, id: string, input: TrabEspacoUpdateInput) {
    await this.acharEspaco(orgId, id);
    return this.logado(orgId, actorId, 'work.space.update', 'work_space', id, () =>
      this.semNomeRepetido(NOME_DE_ESPACO_REPETIDO, () =>
        this.prisma.workSpace.update({ where: { id }, data: { name: input.name, order: input.order } })),
    );
  }

  async apagarEspaco(orgId: string, actorId: string, id: string) {
    await this.acharEspaco(orgId, id);
    const [pastas, listas] = await Promise.all([
      this.prisma.workFolder.count({ where: { orgId, spaceId: id } }),
      this.prisma.workList.count({ where: { orgId, spaceId: id } }),
    ]);
    if (pastas + listas > 0) throw new BadRequestException('Espaço tem pastas ou listas — mova ou apague antes.');
    return this.logado(orgId, actorId, 'work.space.delete', 'work_space', id, () =>
      this.prisma.workSpace.delete({ where: { id } }),
    );
  }

  // ---------- pastas ----------

  async criarPasta(orgId: string, actorId: string, input: TrabPastaCreateInput) {
    const pai = await this.paiDaPasta(orgId, input);
    return this.logado(orgId, actorId, 'work.folder.create', 'work_folder', null, () =>
      this.semNomeRepetido(NOME_DE_PASTA_REPETIDO, () =>
        this.prisma.workFolder.create({ data: { orgId, name: input.name, ...pai } })),
    );
  }

  /**
   * Renomeia, reordena e MOVE (`spaceId`/`parentId`, ver `TrabPastaUpdateSchema`).
   * Pôr dentro de outra pasta confere o ciclo sob o cadeado da árvore da empresa:
   * sem ele, "A para dentro de B" e "B para dentro de A" ao mesmo tempo passariam
   * cada um na sua conferência e fechariam o ciclo juntos.
   */
  async editarPasta(orgId: string, actorId: string, id: string, input: TrabPastaUpdateInput) {
    const antes = await this.prisma.workFolder.findFirst({ where: { id, orgId }, select: { spaceId: true, parentId: true, name: true, lists: { select: { id: true, name: true } } } });
    if (!antes) throw new NotFoundException('Pasta não encontrada');
    const move = input.spaceId !== undefined || input.parentId !== undefined;
    // A pasta Clientes que guarda a lista da implantação não muda de nome nem desce de nível (T1, revisão P2-4).
    const guardaAImplantacao = !!listaDaImplantacao([{ id, name: antes.name, parentId: antes.parentId, lists: antes.lists }]);
    if (guardaAImplantacao && ((input.name !== undefined && input.name !== antes.name) || (input.parentId !== undefined && input.parentId !== null))) {
      throw new BadRequestException(`A pasta ${PASTA_DA_IMPLANTACAO} guarda a lista ${LISTA_DA_IMPLANTACAO}, a porta da implantação de clientes: ela fica no primeiro nível, com este nome.`);
    }
    const pai = move ? await this.paiDaPasta(orgId, input) : null;
    const data = { name: input.name, order: input.order, ...pai };
    return this.logado(orgId, actorId, 'work.folder.update', 'work_folder', id, () =>
      this.semNomeRepetido(NOME_DE_PASTA_REPETIDO, () => {
        if (!pai?.parentId) return this.prisma.workFolder.update({ where: { id }, data });
        const mae = pai.parentId;
        return this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${orgId}`}))`;
          await this.conferirSemCiclo(tx, orgId, id, mae);
          return tx.workFolder.update({ where: { id }, data });
        });
      }),
      pai ? { before: { spaceId: antes.spaceId, parentId: antes.parentId }, after: pai } : undefined,
    );
  }

  /** Pasta com lista ou com pasta dentro não se apaga; as duas contagens só olham esta empresa. */
  async apagarPasta(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workFolder, orgId, id, 'Pasta');
    const [listas, filhas] = await Promise.all([
      this.prisma.workList.count({ where: { orgId, folderId: id } }),
      this.prisma.workFolder.count({ where: { orgId, parentId: id } }),
    ]);
    if (listas > 0) throw new BadRequestException('Pasta tem listas — mova ou apague antes.');
    if (filhas > 0) throw new BadRequestException('Pasta tem pastas dentro — mova ou apague antes.');
    return this.logado(orgId, actorId, 'work.folder.delete', 'work_folder', id, () =>
      this.prisma.workFolder.delete({ where: { id } }),
    );
  }

  // ---------- listas ----------

  async criarLista(orgId: string, actorId: string, input: TrabListaCreateInput) {
    const pai = await this.paiDaLista(orgId, input);
    return this.logado(orgId, actorId, 'work.list.create', 'work_list', null, async () => {
      const list = await this.prisma.workList.create({
        data: { orgId, ...pai, name: input.name },
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

  /** Mover lista troca só a linha da lista: as tarefas e os IDs delas ficam onde estão. */
  async editarLista(orgId: string, actorId: string, id: string, input: TrabListaUpdateInput) {
    const antes = await this.prisma.workList.findFirst({ where: { id, orgId }, select: { folderId: true, spaceId: true, name: true } });
    if (!antes) throw new NotFoundException('Lista não encontrada');
    const move = input.folderId !== undefined || input.spaceId !== undefined;
    /*
     * A LISTA DA IMPLANTAÇÃO NÃO SAI DO LUGAR (rodada do trabalho T1, 19/10/2026).
     * O item "Implantação de clientes" e o card do fechamento a acham pelo nome
     * dentro da pasta Clientes; movida ou renomeada, a tela fica vazia e o próximo
     * fechamento abre outra lista. Na homologação isso aconteceu pelo seletor de
     * pasta. Ela pode ganhar etapas e campos, não mudar de pasta nem de nome.
     */
    if ((move && input.folderId !== antes.folderId) || (input.name !== undefined && input.name !== antes.name)) {
      const pasta = antes.folderId ? await this.prisma.workFolder.findFirst({ where: { id: antes.folderId, orgId }, select: { id: true, name: true, parentId: true } }) : null;
      if (pasta && listaDaImplantacao([{ ...pasta, lists: [{ id, name: antes.name }] }])) {
        throw new BadRequestException(`A lista ${LISTA_DA_IMPLANTACAO} é a porta da implantação de clientes: ela fica na pasta ${PASTA_DA_IMPLANTACAO}, com este nome.`);
      }
    }
    const pai = move ? await this.paiDaLista(orgId, input) : null;
    const antesDoRastro = { folderId: antes.folderId, spaceId: antes.spaceId };
    return this.logado(orgId, actorId, 'work.list.update', 'work_list', id, () =>
      this.prisma.workList.update({ where: { id }, data: { name: input.name, order: input.order, ...pai } }),
      pai ? { before: antesDoRastro, after: pai } : undefined,
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
    const campo = (await this.achar(this.prisma.workField, orgId, fieldId, 'Campo')) as { type: WorkFieldType };
    // O2 da ROOT-06a-IMPL: a opção ficaria sem efeito, porque o valor `moeda`
    // recusa `optionId` e o importador recusa campo `moeda` com opções.
    if (campo.type === WorkFieldType.moeda) throw new BadRequestException('Campo moeda não tem opções.');
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
    clientes: Map<string, string>,
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
      // O nome vem de `nomesDosClientes` (escopado por empresa); ponteiro que não resolve = sem cliente.
      clienteId: t.clienteId && clientes.has(t.clienteId) ? t.clienteId : null,
      clienteNome: t.clienteId ? clientes.get(t.clienteId) ?? null : null,
    };
  }

  async tarefas(
    orgId: string,
    f: WorkTaskQuery,
  ): Promise<TrabTarefaLista> {
    const page = f.page ?? 1;
    const limit = f.limit ?? 500;
    const where: Prisma.WorkTaskWhereInput = { orgId, archived: f.arquivadas ? undefined : false };
    if (f.listId) where.listId = f.listId;
    if (f.listIds) where.listId = { in: f.listIds };
    if (f.listExternalIds) where.list = { orgId, externalId: { in: f.listExternalIds } };
    if (f.statusId) where.statusId = f.statusId;
    if (f.assignee) where.assignee = f.assignee;
    if (f.tagId) where.tags = { some: { id: f.tagId } };
    if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
    if (f.opcao) where.values = { some: { optionId: f.opcao } }; // filtro por opção de campo
    if (f.cliente === 'sem') where.clienteId = null; // T4: o filtro de limpeza das antigas
    else if (f.cliente) where.clienteId = f.cliente;
    if (f.dueFrom || f.dueTo) where.dueDate = {
      ...(f.dueFrom ? { gte: f.dueFrom } : {}),
      ...(f.dueTo ? { lt: f.dueTo } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workTask.count({ where }),
    ]);
    const now = new Date();
    /*
     * UMA consulta para todos os donos, depois da lista — não uma por tarefa.
     * `agentesDaCasa` já deduplica os ids, então o custo é fixo no número de
     * agentes travando trabalho, não no de tarefas.
     */
    const agentes = await agentesDaCasa(this.prisma, orgId, rows.map((t) => t.agenteId));
    const minutos = await this.minutosPorTarefa(orgId, rows.map((t) => t.id));
    const clientes = await nomesDosClientes(this.prisma, orgId, rows.map((t) => t.clienteId));
    return {
      items: rows.map((t) => this.mapTask(t, now, agentes, minutos, clientes)),
      total,
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
    const [agentes, clientes, apontamentos, porEtapa] = await Promise.all([
      agentesDaCasa(this.prisma, orgId, [t.agenteId]),
      nomesDosClientes(this.prisma, orgId, [t.clienteId]),
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
      ...this.mapTask(t, now, agentes, new Map([[t.id, minutosDaTarefa]]), clientes),
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

  /**
   * `exigirCliente` (rodada do trabalho T4): a rota da tela e o aceite da ata
   * exigem o cliente; subtarefa sem cliente herda o da mãe. Chamadores internos
   * que já sabem o cliente o mandam no `clienteId`.
   */
  async pessoas(orgId: string): Promise<{ id: string; nome: string }[]> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true, roles: { none: { key: { in: ['ia_servico', 'ia_acao'] } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return gente.map((g) => ({ id: g.id, nome: g.name }));
  }

  clientes(orgId: string, q?: string) {
    return listarClientes(this.prisma, orgId, q);
  }

  async criarTarefa(orgId: string, actorId: string, input: TrabTarefaCreateInput, opcoes: { exigirCliente?: boolean } = {}) {
    const list = await this.prisma.workList.findFirst({
      where: { id: input.listId, orgId },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    if (!list) throw new NotFoundException('Lista não encontrada');
    if (list.statuses.length === 0) throw new BadRequestException('Lista sem statuses.');
    // A implantação tem porta única (rodada do trabalho T1): o cartão do cliente
    // nasce do contrato assinado no comercial. Subtarefa dentro do cartão vale.
    if (!input.parentId && list.folderId) {
      const pasta = await this.prisma.workFolder.findFirst({ where: { id: list.folderId, orgId }, select: { id: true, name: true, parentId: true } });
      if (pasta && listaDaImplantacao([{ ...pasta, lists: [{ id: list.id, name: list.name }] }])) {
        throw new BadRequestException(PORTA_DA_IMPLANTACAO);
      }
    }
    const statusId = input.statusId ?? list.statuses[0].id;
    if (!list.statuses.some((s) => s.id === statusId)) {
      throw new BadRequestException('Status não pertence à lista.');
    }
    await this.conferirPaiEEtiquetas(orgId, input);
    let clienteId: string | null = input.clienteId ? await resolverCliente(this.prisma, orgId, input.clienteId) : null;
    if (!clienteId && input.parentId) {
      clienteId = (await this.prisma.workTask.findFirst({ where: { id: input.parentId, orgId }, select: { clienteId: true } }))?.clienteId ?? null;
    }
    if (!clienteId && opcoes.exigirCliente) {
      throw new BadRequestException('Escolha o cliente da tarefa. O trabalho da própria empresa vai para o cliente interno.');
    }
    const campos = input.campos ? await this.conferirCampos(orgId, list.id, input.campos) : [];
    return this.logado(orgId, actorId, 'work.task.create', 'work_task', null, async () => {
      const task = await this.prisma.$transaction(async (tx) => {
        const criada = await tx.workTask.create({
          data: {
            orgId, listId: list.id, statusId,
            title: input.title, description: input.description ?? null,
            priority: (input.priority as WorkPriority) ?? WorkPriority.normal,
            assignee: input.assignee ?? null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            startDate: input.startDate ? new Date(input.startDate) : null,
            parentId: input.parentId ?? null,
            clienteId,
            tags: input.tagIds ? { connect: input.tagIds.map((id) => ({ id })) } : undefined,
          },
        });
        await this.gravarCampos(tx, criada.id, campos);
        return criada;
      });
      return this.tarefa(orgId, task.id);
    });
  }

  /** A lista é a da implantação (Onboarding de cliente na pasta Clientes)? Porta única do T1. */
  private async ehListaDaImplantacao(orgId: string, listId: string): Promise<boolean> {
    const l = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true, name: true, folderId: true } });
    if (!l?.folderId) return false;
    const pasta = await this.prisma.workFolder.findFirst({ where: { id: l.folderId, orgId }, select: { id: true, name: true, parentId: true } });
    return !!pasta && !!listaDaImplantacao([{ ...pasta, lists: [{ id: l.id, name: l.name }] }]);
  }

  async editarTarefa(orgId: string, actorId: string, id: string, input: TrabTarefaUpdateInput) {
    const antes = await this.prisma.workTask.findFirst({ where: { id, orgId }, include: { status: true, tags: true } });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');

    if (input.listId) await this.achar(this.prisma.workList, orgId, input.listId, 'Lista');
    const listId = input.listId ?? antes.listId;
    // Porta única da implantação (T1, revisão P2-4): nenhum cartão novo entra pela edição. Mover uma
    // tarefa solta para a lista, ou promover uma subtarefa de lá a cartão, é abrir cliente pelo lado.
    const paiDepois = input.parentId === undefined ? antes.parentId : input.parentId;
    const entraNaLista = !!input.listId && input.listId !== antes.listId;
    const viraCartao = antes.parentId !== null && paiDepois === null;
    if (!paiDepois && (entraNaLista || viraCartao) && (await this.ehListaDaImplantacao(orgId, listId))) {
      throw new BadRequestException(PORTA_DA_IMPLANTACAO);
    }
    let statusId = input.statusId;
    if (input.listId && input.listId !== antes.listId && !statusId) {
      // mover de lista sem status novo → cai no primeiro status da lista destino
      const primeiro = await this.prisma.workStatus.findFirst({ where: { listId, orgId }, orderBy: { order: 'asc' } });
      if (!primeiro) throw new BadRequestException('Lista destino sem statuses.');
      statusId = primeiro.id;
    }
    if (statusId) {
      const ok = await this.prisma.workStatus.findFirst({ where: { id: statusId, listId, orgId } });
      if (!ok) throw new BadRequestException('Status não pertence à lista da tarefa.');
    }
    await this.conferirPaiEEtiquetas(orgId, input);
    const campos = input.campos ? await this.conferirCampos(orgId, listId, input.campos) : [];
    const clienteId = input.clienteId ? await resolverCliente(this.prisma, orgId, input.clienteId) : undefined;

    const { depois, camposAntes, camposDepois } = await this.prisma.$transaction(async (tx) => {
      const camposAntes = campos.length ? await this.retratoDosCampos(tx, id, campos) : null;
      const depois = await tx.workTask.update({
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
          clienteId,
          archived: input.archived,
          order: input.order,
          tags: input.tagIds ? { set: input.tagIds.map((tid) => ({ id: tid })) } : undefined,
        },
        include: { status: true },
      });
      await this.gravarCampos(tx, id, campos);
      const camposDepois = campos.length ? await this.retratoDosCampos(tx, id, campos) : null;
      return { depois, camposAntes, camposDepois };
    });

    await this.audit.log({
      orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: id,
      // `dueDate` entrou na rodada do painel P1 (18/10/2026): a caixa de entrada
      // mostra "vencimento mudou de → para" a partir DESTA linha, sem segundo
      // caminho de escrita. Linha antiga, sem a chave, não mostra a mudança.
      before: {
        status: antes.status.name, title: antes.title, assignee: antes.assignee, priority: antes.priority,
        dueDate: antes.dueDate?.toISOString() ?? null,
        ...(clienteId !== undefined ? { clienteId: antes.clienteId } : {}),
        ...(camposAntes ? { campos: camposAntes } : {}),
      },
      after: {
        status: depois.status.name, title: depois.title, assignee: depois.assignee, priority: depois.priority,
        dueDate: depois.dueDate?.toISOString() ?? null,
        ...(clienteId !== undefined ? { clienteId: depois.clienteId } : {}),
        ...(camposDepois ? { campos: camposDepois } : {}),
      },
    });
    return this.tarefa(orgId, id);
  }

  /**
   * Pai e etiquetas vêm do corpo do pedido e só valem desta empresa. A chave
   * estrangeira confere apenas que o id existe, e a conexão dona das tabelas
   * atravessa o isolamento por linha: sem esta conferência, a tarefa daqui
   * viraria filha de tarefa de outra empresa e apareceria no detalhe dela. Id
   * de outra empresa recebe o mesmo 404 de um id que não existe; etiqueta
   * repetida conta uma vez, como o Prisma grava.
   */
  private async conferirPaiEEtiquetas(orgId: string, input: { parentId?: string | null; tagIds?: string[] }) {
    if (input.parentId) await this.achar(this.prisma.workTask, orgId, input.parentId, 'Tarefa pai');
    if (input.tagIds?.length) {
      const pedidas = new Set(input.tagIds);
      const daEmpresa = await this.prisma.workTag.count({ where: { orgId, id: { in: [...pedidas] } } });
      if (daEmpresa !== pedidas.size) throw new NotFoundException('Etiqueta não encontrada');
    }
  }

  /**
   * Confere TODOS os campos do pedido antes da primeira escrita (ROOT-06a, E1):
   * o campo vale para a lista, a opção do `drop_down` é dele e o valor do
   * `moeda` é canônico. Conferir enquanto grava deixava a tarefa criada (e a
   * nova tentativa a duplicava) ou o texto do PATCH gravado ao lado de um 400.
   * A escrita da tarefa e dos valores vai depois, numa transação só.
   */
  private async conferirCampos(
    orgId: string, listId: string, campos: Record<string, ValorDoCampo>,
  ): Promise<CampoConferido[]> {
    if (Object.keys(campos).length === 0) return [];
    const fields = await this.prisma.workField.findMany({
      where: { id: { in: Object.keys(campos) }, orgId, OR: [{ listId }, { listId: null }] },
      include: { options: true },
    });
    const porId = new Map(fields.map((f) => [f.id, f]));
    return Object.entries(campos).map(([fieldId, v]) => {
      const field = porId.get(fieldId);
      if (!field) throw new BadRequestException(`Campo ${fieldId} não vale para esta lista.`);
      if (field.type === WorkFieldType.moeda) {
        if (v.optionId || (!apagaOValor(field.type, v) && !ehValorMonetarioCanonico(v.value))) {
          throw new BadRequestException(`Valor de ${field.name} fora do formato monetário (exemplo: BRL 1500.00).`);
        }
      } else if (!apagaOValor(field.type, v) && v.optionId && !field.options.some((o) => o.id === v.optionId)) {
        throw new BadRequestException(`Opção não pertence ao campo ${field.name}.`);
      }
      return { field, v };
    });
  }

  /** Grava os valores já conferidos por `conferirCampos`, dentro da transação de quem chama. */
  private async gravarCampos(db: Prisma.TransactionClient, taskId: string, campos: CampoConferido[]) {
    for (const { field, v } of campos) {
      if (apagaOValor(field.type, v)) {
        await db.workFieldValue.deleteMany({ where: { taskId, fieldId: field.id } });
        continue;
      }
      const valor = field.type === WorkFieldType.moeda
        ? { optionId: null, value: v.value ?? null }
        : { optionId: v.optionId ?? null, value: v.value ?? null };
      await db.workFieldValue.upsert({
        where: { taskId_fieldId: { taskId, fieldId: field.id } },
        update: valor,
        create: { taskId, fieldId: field.id, ...valor },
      });
    }
  }

  /**
   * O valor de cada campo do pedido, para a auditoria de `work.task.update`
   * (ROOT-06a, A4): sem isto, trocar um valor monetário não deixava rastro.
   */
  private async retratoDosCampos(db: Prisma.TransactionClient, taskId: string, campos: CampoConferido[]) {
    const linhas = await db.workFieldValue.findMany({
      where: { taskId, fieldId: { in: campos.map((c) => c.field.id) } },
      include: { option: true },
    });
    const porCampo = new Map(linhas.map((l) => [l.fieldId, l]));
    return Object.fromEntries(campos.map(({ field }) => {
      const l = porCampo.get(field.id);
      return [field.id, { campo: field.name, tipo: field.type, opcao: l?.option?.name ?? null, valor: l?.value ?? null }];
    }));
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
   * Não abre `$transaction(async ...)`, como `criarLista`; `criarTarefa` e
   * `editarTarefa` abrem uma sob a mesma sessão de banco, que carimba a empresa
   * por consulta (`prisma/sessao-de-banco.ts`). Se falhar no meio, sobra uma
   * lista incompleta, visível, editável e apagável pela tela.
   */
  async criarListaDoModelo(orgId: string, actorId: string, input: TrabListaDoModeloInput) {
    const modelo: ModeloDeLista = MODELOS_DE_LISTA[input.modelo];
    const pai = await this.paiDaLista(orgId, input);
    return this.logado(orgId, actorId, 'work.list.create_from_model', 'work_list', null, () =>
      criarListaDoModeloNoBanco(this.prisma, orgId, pai, modelo, input.name ?? modelo.nome),
    );
  }

  /**
   * A ESTRUTURA SUGERIDA (rodada do painel P2): Administrativa, Gestão e
   * Clientes, com a esteira, o onboarding e a execução dentro de Clientes. Cria
   * só o que falta pelo nome, numa transação sob o cadeado da árvore; a regra
   * inteira está em `estrutura-sugerida.ts`, que o seed da homologação também usa.
   * Uma linha de auditoria por chamada, com o que foi criado e o que já existia.
   */
  async criarEstruturaSugerida(orgId: string, actorId: string): Promise<TrabEstruturaSugeridaResultado> {
    const r = await this.prisma.$transaction((tx) => criarEstruturaSugerida(tx, orgId));
    await this.audit.log({
      orgId, actorId, action: 'work.structure.suggested', entityType: 'work_folder',
      after: r as unknown as Prisma.InputJsonValue,
    });
    return r;
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

  private async acharEspaco(orgId: string, id: string) {
    const espaco = await this.prisma.workSpace.findFirst({ where: { id, orgId } });
    if (!espaco) throw new NotFoundException('Espaço não encontrado');
    return espaco;
  }

  /**
   * O pai da pasta e o da lista, conferidos NA EMPRESA antes de gravar (resíduo
   * T3 da ROOT-12a). Id de outra empresa recebe o mesmo 404 de um id que não
   * existe; a chave composta do banco também recusaria, mas com um 500 mudo.
   */
  private async paiDaPasta(orgId: string, input: { spaceId?: string | null; parentId?: string | null }): Promise<PaiDaPasta> {
    if (input.spaceId && input.parentId) throw new BadRequestException(TRAB_PASTA_COM_DOIS_PAIS);
    if (input.spaceId) await this.acharEspaco(orgId, input.spaceId);
    if (input.parentId) await this.achar(this.prisma.workFolder, orgId, input.parentId, 'Pasta');
    return { spaceId: input.spaceId ?? null, parentId: input.parentId ?? null };
  }

  private async paiDaLista(orgId: string, input: { folderId?: string | null; spaceId?: string | null }): Promise<PaiDaLista> {
    if (input.folderId && input.spaceId) throw new BadRequestException(TRAB_LISTA_COM_DOIS_PAIS);
    if (input.folderId) await this.achar(this.prisma.workFolder, orgId, input.folderId, 'Pasta');
    if (input.spaceId) await this.acharEspaco(orgId, input.spaceId);
    return { folderId: input.folderId ?? null, spaceId: input.spaceId ?? null };
  }

  /** Recusa a pasta dentro dela mesma ou de uma descendente, subindo pelas mães a partir do destino. */
  private async conferirSemCiclo(db: Prisma.TransactionClient, orgId: string, pastaId: string, maeId: string) {
    const pastas = await db.workFolder.findMany({ where: { orgId }, select: { id: true, parentId: true } });
    const maeDe = new Map(pastas.map((p) => [p.id, p.parentId]));
    const vistas = new Set<string>();
    for (let atual: string | null = maeId; atual && !vistas.has(atual); atual = maeDe.get(atual) ?? null) {
      if (atual === pastaId) throw new BadRequestException(PASTA_EM_CICLO);
      vistas.add(atual);
    }
  }

  /** Nome repetido entre irmãs é 409 com a frase da tela, e não o 500 do índice único. */
  private async semNomeRepetido<T>(frase: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(frase);
      throw e;
    }
  }

  /** executa a escrita e registra na auditoria (entityId do resultado quando criar). */
  private async logado<T extends { id?: string }>(
    orgId: string, actorId: string, action: string, entityType: string, entityId: string | null,
    fn: () => Promise<T>,
    trilha?: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  ): Promise<T> {
    const res = await fn();
    await this.audit.log({
      orgId, actorId, action, entityType,
      entityId: entityId ?? res.id ?? undefined,
      ...trilha,
    });
    return res;
  }
}
