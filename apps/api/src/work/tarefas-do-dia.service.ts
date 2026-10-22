import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkListaNatureza, WorkStatusType } from '@prisma/client';
import {
  AREAS_PADRAO, CARTOES_QUE_NAO_SAO_TAREFA, faseDaEtapa, DOMINIO_DAS_CONTAS_DO_SISTEMA, equipeDasContas, mesmaTarefa, naoPareceTarefa, notaDeSemelhanca, situacaoDoPrazo, tarefaIgual,
  type AreaDeTarefa, type PainelDeTarefas, type ResultadoDeCriar, type ResumoDaPessoa, type TarefaDoDia,
  type TarefaDoDiaCriar, type TarefaDoDiaEditar,
  RecorrenciaSchema, proximaOcorrencia, type RecorrenciaDaTarefa,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkService, hojeEmBrasilia } from './work.service';
import { acharOuCriarClientePorNome } from './clientes-da-casa';
import { tarefaDeListaVisivel } from './arquivadas';

/*
 * TAREFAS DE TODAS AS ÁREAS — a visão "Tudo" do Trabalho (19/10/2026).
 *
 * Não é uma segunda tabela de tarefas: lê e escreve WorkTask, e toda escrita de
 * título, status, responsável e prazo passa pelo WorkService (auditoria,
 * versão, permissão). O que este serviço acrescenta são as três regras que
 * impedem card repetido:
 *
 *   1. Só entra card de lista de natureza `tarefas`. Lead, cliente, contrato,
 *      peça de conteúdo e esteira são `cadastro` e ficam nas telas deles.
 *   2. Subtarefa de tarefa fica dentro da tarefa; só sobe para a visão a tarefa
 *      cujo pai é um CADASTRO (a tarefa feita pela ficha do cliente).
 *   3. Criar uma tarefa aberta IGUAL a outra (mesmo título, mesmo cliente) é
 *      recusado; PARECIDA ou com cara de lead/post pede confirmação.
 */

const INCLUDE = {
  status: true,
  list: { select: { id: true, name: true, natureza: true } },
  area: true,
  assigneeUser: { select: { id: true, name: true } },
  // Versão final (19/10/2026): o cliente da tarefa é o `Partner` (conciliação
  // `20261019230000_conciliacao_cliente_da_tarefa`), não mais o card de cadastro.
  cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
  parent: { select: { id: true, title: true, list: { select: { natureza: true } } } },
} satisfies Prisma.WorkTaskInclude;
type Linha = Prisma.WorkTaskGetPayload<{ include: typeof INCLUDE }>;
type Equipe = { pessoas: { id: string; nome: string }[]; canonica: Map<string, string>; nomeDe: Map<string, string> };

const STATUS_DA_LISTA_DE_AREA = [
  { name: 'A fazer', type: WorkStatusType.open, color: '#87909e' },
  { name: 'Fazendo', type: WorkStatusType.custom, color: '#f9a400' },
  { name: 'Feito', type: WorkStatusType.closed, color: '#30a46c' },
];

/** Dia de Brasília (AAAA-MM-DD) de um instante. O prazo do ClickUp chega às 03:00 UTC = 00:00 aqui. */
function diaEmBrasilia(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Meia-noite de Brasília do dia, que é como o prazo de dia inteiro é guardado. */
function instanteDoDia(dia: string): string {
  return new Date(`${dia}T03:00:00.000Z`).toISOString();
}

@Injectable()
export class TarefasDoDiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trabalho: WorkService,
  ) {}

  // ---------- áreas ----------

  /** As áreas da empresa; na primeira vez cria as padrão (idempotente pelo nome). */
  async areas(orgId: string): Promise<AreaDeTarefa[]> {
    let areas = await this.prisma.workArea.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
    if (areas.length === 0) {
      await this.prisma.workArea.createMany({
        data: AREAS_PADRAO.map((a, i) => ({ orgId, nome: a.nome, cor: a.cor, ordem: i })),
        skipDuplicates: true,
      });
      areas = await this.prisma.workArea.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
    }
    return areas.map((a) => ({ id: a.id, nome: a.nome, cor: a.cor, ordem: a.ordem }));
  }

  async criarArea(orgId: string, actorId: string, input: { nome: string; cor?: string }): Promise<AreaDeTarefa> {
    const atuais = await this.areas(orgId);
    if (atuais.some((a) => a.nome.toLowerCase() === input.nome.trim().toLowerCase())) {
      throw new ConflictException('Já existe uma área com esse nome.');
    }
    const a = await this.prisma.workArea.create({
      data: { orgId, nome: input.nome.trim(), cor: input.cor ?? '#8b8d98', ordem: atuais.length },
    });
    await this.audit.log({ orgId, actorId, action: 'work.area.create', entityType: 'work_area', entityId: a.id, after: { nome: a.nome } });
    return { id: a.id, nome: a.nome, cor: a.cor, ordem: a.ordem };
  }

  // ---------- cliente novo (é Partner, como no Trabalho) ----------

  /**
   * Depois da conciliação (`20261019230000`) o cliente da tarefa é o `Partner`
   * cliente, o mesmo cadastro do fechamento comercial, do Financeiro e do seletor
   * do Trabalho. "Novo cliente" acha o que já existe pelo nome (régua normalizada
   * da conciliação) ou cria o `Partner`; nenhum card de lista nasce daqui
   * (revisão final, achado 1.7: o card devolvido caía em "Cliente não encontrado").
   */
  async criarCliente(orgId: string, actorId: string, nome: string): Promise<{ id: string; titulo: string; jaExistia: boolean }> {
    const c = await acharOuCriarClientePorNome(this.prisma, orgId, nome);
    if (!c.jaExistia) {
      await this.audit.log({ orgId, actorId, action: 'finance.partner.create', entityType: 'partner', entityId: c.id, after: { razaoSocial: c.nome, isCliente: true, origem: 'tarefas' } });
    }
    return { id: c.id, titulo: c.nome, jaExistia: c.jaExistia };
  }

  // ---------- leitura ----------

  private ondeSaoTarefas(orgId: string): Prisma.WorkTaskWhereInput {
    return {
      orgId, archived: false,
      list: { natureza: WorkListaNatureza.tarefas },
      AND: [
        { OR: [{ parentId: null }, { parent: { list: { natureza: WorkListaNatureza.cadastro } } }] },
        // externalId nulo precisa de ramo próprio: em SQL, NULL NOT IN (...) é desconhecido e a linha some.
        { OR: [{ externalId: null }, { externalId: { notIn: [...CARTOES_QUE_NAO_SAO_TAREFA] } }] },
        // Lista ou pasta arquivada sai do Dia a dia inteiro: painel, contadores e criação (21/10/2026).
        tarefaDeListaVisivel(),
      ],
    };
  }

  /** A equipe da empresa: uma pessoa por nome, sem as contas do sistema nem a da empresa. */
  private async equipe(orgId: string): Promise<Equipe> {
    const [org, contas] = await Promise.all([
      this.prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
      this.prisma.user.findMany({
        where: { orgId, isActive: true, NOT: { email: { endsWith: DOMINIO_DAS_CONTAS_DO_SISTEMA } } },
        select: { id: true, name: true, lastLoginAt: true },
      }),
    ]);
    const { pessoas, canonica } = equipeDasContas(
      contas.map((c) => ({ id: c.id, nome: c.name, ultimoAcesso: c.lastLoginAt?.toISOString() ?? null })),
      { nome: org?.name ?? '', slug: org?.slug ?? '' },
    );
    return { pessoas, canonica, nomeDe: new Map(pessoas.map((p) => [p.id, p.nome])) };
  }

  private mapear(t: Linha, hoje: string, equipe: Equipe): TarefaDoDia {
    const feita = t.status.type === WorkStatusType.closed;
    const prazo = t.dueDate ? diaEmBrasilia(t.dueDate) : null;
    // O cliente é o Partner da tarefa; a tarefa antiga feita pela ficha, sem cliente, mostra o card pai.
    const cliente = t.cliente
      ? { id: t.cliente.id, title: t.cliente.nomeFantasia ?? t.cliente.razaoSocial }
      : t.parent && t.parent.list.natureza === WorkListaNatureza.cadastro ? t.parent : null;
    // A conta vira a pessoa da equipe (Pedro com duas contas é um só); conta fora da equipe fica como texto.
    const idDaPessoa = t.assigneeUserId ? equipe.canonica.get(t.assigneeUserId) : undefined;
    return {
      id: t.id,
      titulo: t.title,
      area: t.area ? { id: t.area.id, nome: t.area.nome, cor: t.area.cor } : null,
      cliente: cliente ? { id: cliente.id, titulo: cliente.title } : null,
      pessoa: idDaPessoa ? { id: idDaPessoa, nome: equipe.nomeDe.get(idDaPessoa)! } : null,
      pessoas: [...new Set([idDaPessoa, ...t.outrosResponsaveisIds.map((u) => equipe.canonica.get(u))].filter((x): x is string => !!x))]
        .map((id) => ({ id, nome: equipe.nomeDe.get(id)! })),
      responsavelTexto: idDaPessoa ? null : (t.assigneeUser?.name ?? t.assignee),
      prazo,
      situacao: situacaoDoPrazo(prazo, hoje, feita),
      status: {
        nome: t.status.name, cor: t.status.color,
        tipo: t.status.type === WorkStatusType.closed ? 'concluida' : t.status.type === WorkStatusType.custom ? 'andamento' : 'aberta',
      },
      lista: { id: t.list.id, nome: t.list.name },
      externalUrl: t.externalUrl,
      descricao: t.description,
      recorrencia: regraDe(t.recorrencia),
      ordem: t.order,
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async painel(orgId: string): Promise<PainelDeTarefas> {
    const hoje = hojeEmBrasilia();
    const [areas, abertas, concluidas, equipe, clientes] = await Promise.all([
      this.areas(orgId),
      this.prisma.workTask.findMany({
        where: { AND: [this.ondeSaoTarefas(orgId), { status: { type: { not: WorkStatusType.closed } } }] },
        include: INCLUDE,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 2000,
      }),
      // As concluídas também vêm (filtro "Concluídas" e "Todas"): as 500 mais recentes.
      this.prisma.workTask.findMany({
        where: { AND: [this.ondeSaoTarefas(orgId), { status: { type: WorkStatusType.closed } }] },
        include: INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
      this.equipe(orgId),
      this.prisma.partner.findMany({
        where: { orgId, ativo: true, OR: [{ isCliente: true }, { interno: true }] },
        select: { id: true, razaoSocial: true, nomeFantasia: true }, orderBy: { razaoSocial: 'asc' },
      }),
    ]);
    const tarefas = [...abertas, ...concluidas].map((t) => this.mapear(t, hoje, equipe));
    return {
      hoje,
      areas,
      pessoas: equipe.pessoas,
      clientes: clientes.map((c) => ({ id: c.id, titulo: c.nomeFantasia ?? c.razaoSocial, fase: 'cliente' as const })),
      resumo: this.resumir(tarefas, equipe.pessoas),
      tarefas,
    };
  }

  /** Uma linha por pessoa ativa (mesmo zerada) e uma "sem dono" se houver. */
  private resumir(tarefas: TarefaDoDia[], pessoas: { id: string; nome: string }[]): ResumoDaPessoa[] {
    const seteDiasAtras = new Date(Date.now() - 7 * 86400e3).toISOString();
    const linha = (pessoa: { id: string; nome: string } | null): ResumoDaPessoa => {
      // Tarefa de várias pessoas conta para cada uma delas.
      const dela = tarefas.filter((t) => (pessoa ? t.pessoas.some((x) => x.id === pessoa.id) : !t.pessoa));
      return {
        pessoa,
        atrasadas: dela.filter((t) => t.situacao === 'atrasada').length,
        emDia: dela.filter((t) => t.situacao === 'hoje' || t.situacao === 'proximos_7' || t.situacao === 'mais_tarde').length,
        semPrazo: dela.filter((t) => t.situacao === 'sem_prazo').length,
        feitasNaSemana: dela.filter((t) => t.situacao === 'feita' && t.updatedAt >= seteDiasAtras).length,
      };
    };
    const resumo = pessoas.map(linha);
    const semDono = linha(null);
    if (semDono.atrasadas + semDono.emDia + semDono.semPrazo > 0) resumo.push(semDono);
    return resumo;
  }

  private async uma(orgId: string, id: string): Promise<TarefaDoDia> {
    const t = await this.prisma.workTask.findFirst({ where: { ...this.ondeSaoTarefas(orgId), id }, include: INCLUDE });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    return this.mapear(t, hojeEmBrasilia(), await this.equipe(orgId));
  }

  // ---------- escrita ----------

  /** A lista de tarefas da área: a que tem a área como padrão; se não houver, cria "Tarefas · <área>". */
  private async listaDaArea(orgId: string, actorId: string, areaId: string) {
    const area = await this.prisma.workArea.findFirst({ where: { id: areaId, orgId } });
    if (!area) throw new NotFoundException('Área não encontrada');
    const ja = await this.prisma.workList.findFirst({
      // Lista arquivada não recebe tarefa nova (a lista "Comercial" antiga sai depois do importador, 21/10/2026).
      where: { orgId, areaPadraoId: area.id, natureza: WorkListaNatureza.tarefas, arquivadaEm: null },
      include: { statuses: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    if (ja) return { area, lista: ja };
    const espaco = await this.prisma.workSpace.upsert({
      where: { orgId_name: { orgId, name: 'Tarefas' } },
      update: {},
      create: { orgId, name: 'Tarefas', order: 0 },
    });
    const lista = await this.prisma.workList.create({
      data: {
        orgId, spaceId: espaco.id, name: area.nome, natureza: WorkListaNatureza.tarefas, areaPadraoId: area.id,
        statuses: { create: STATUS_DA_LISTA_DE_AREA.map((s, i) => ({ name: s.name, type: s.type, color: s.color, order: i })) },
      },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    await this.audit.log({ orgId, actorId, action: 'work.list.create', entityType: 'work_list', entityId: lista.id, after: { name: lista.name, area: area.nome } });
    return { area, lista };
  }

  private async conferirCliente(orgId: string, clienteId: string | null | undefined) {
    if (!clienteId) return;
    const c = await this.prisma.partner.findFirst({ where: { id: clienteId, orgId, OR: [{ isCliente: true }, { interno: true }] }, select: { id: true } });
    if (!c) throw new BadRequestException('Cliente não encontrado.');
  }

  async criar(orgId: string, actorId: string, input: TarefaDoDiaCriar): Promise<ResultadoDeCriar> {
    await this.conferirCliente(orgId, input.clienteId);
    const abertas = await this.prisma.workTask.findMany({
      where: { ...this.ondeSaoTarefas(orgId), status: { type: { not: WorkStatusType.closed } } },
      include: INCLUDE,
    });
    const hoje = hojeEmBrasilia();
    // O cliente é o Partner; o pai de cadastro (id de card) não é comparável com ele (revisão final, 1.9).
    const doCliente = (t: Linha) => (t.clienteId ?? null) === (input.clienteId ?? null);
    const igual = tarefaIgual(abertas.filter(doCliente), input.titulo, (t) => t.title);
    // Igual e aberta: não cria nunca, nem confirmando. Devolve a que já existe.
    if (igual) return { criada: false, aviso: { tipo: 'igual', tarefa: this.mapear(igual, hoje, await this.equipe(orgId)) } };
    if (!input.confirmar) {
      const fora = naoPareceTarefa(input.titulo);
      if (fora) return { criada: false, aviso: { tipo: 'nao_parece_tarefa', casa: fora.casa, motivo: fora.motivo } };
      const parecida = abertas
        .filter((t) => mesmaTarefa(t.title, input.titulo) === 'parecida')
        .sort((a, b) => notaDeSemelhanca(b.title, input.titulo) - notaDeSemelhanca(a.title, input.titulo))[0];
      if (parecida) return { criada: false, aviso: { tipo: 'parecida', tarefa: this.mapear(parecida, hoje, await this.equipe(orgId)) } };
    }
    const { area, lista } = await this.listaDaArea(orgId, actorId, input.areaId);
    const aberto = lista.statuses.find((s) => s.type !== WorkStatusType.closed) ?? lista.statuses[0];
    const criada = await this.trabalho.criarTarefa(orgId, actorId, {
      listId: lista.id, statusId: aberto.id, title: input.titulo.trim(),
      assigneeUserId: input.pessoaId ?? null,
      dueDate: input.prazo ? instanteDoDia(input.prazo) : null,
    });
    await this.prisma.workTask.update({ where: { id: criada.id }, data: { areaId: area.id, clienteId: input.clienteId ?? null } });
    return { criada: true, tarefa: await this.uma(orgId, criada.id) };
  }

  async editar(orgId: string, actorId: string, id: string, input: TarefaDoDiaEditar): Promise<TarefaDoDia> {
    const antes = await this.prisma.workTask.findFirst({ where: { ...this.ondeSaoTarefas(orgId), id }, include: { area: true } });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');
    if (input.areaId) {
      const a = await this.prisma.workArea.findFirst({ where: { id: input.areaId, orgId } });
      if (!a) throw new NotFoundException('Área não encontrada');
    }
    await this.conferirCliente(orgId, input.clienteId);
    let statusId: string | undefined;
    if (input.etapa) {
      const tipo = input.etapa === 'concluida' ? WorkStatusType.closed : input.etapa === 'andamento' ? WorkStatusType.custom : WorkStatusType.open;
      const st = await this.prisma.workStatus.findFirst({ where: { listId: antes.listId, orgId, type: tipo }, orderBy: { order: 'asc' } });
      if (!st) throw new BadRequestException('A lista desta tarefa não tem esse status.');
      statusId = st.id;
    }
    let versao = input.expectedUpdatedAt;
    const doTrabalho = {
      ...(input.titulo !== undefined ? { title: input.titulo } : {}),
      ...(statusId ? { statusId } : {}),
      ...(input.descricao !== undefined ? { description: input.descricao?.trim() ? input.descricao : null } : {}),
      ...(input.pessoaId !== undefined ? { assigneeUserId: input.pessoaId } : {}),
      ...(input.pessoasIds !== undefined ? { assigneeUserId: input.pessoasIds[0] ?? null } : {}),
      ...(input.prazo !== undefined ? { dueDate: input.prazo ? instanteDoDia(input.prazo) : null } : {}),
    };
    if (Object.keys(doTrabalho).length) {
      const d = await this.trabalho.editarTarefaHttp(orgId, actorId, id, { ...doTrabalho, expectedUpdatedAt: versao });
      versao = d.updatedAt;
    }
    const outros = input.pessoasIds !== undefined ? [...new Set(input.pessoasIds.slice(1))].filter((u) => u !== input.pessoasIds![0])
      : input.pessoaId !== undefined ? [] : undefined;
    if (outros?.length) {
      const validas = await this.prisma.user.count({ where: { orgId, isActive: true, id: { in: outros } } });
      if (validas !== outros.length) throw new BadRequestException('Algum responsável não é uma pessoa ativa desta empresa.');
    }
    if (input.areaId !== undefined || input.clienteId !== undefined || input.recorrencia !== undefined || outros !== undefined) {
      const r = await this.prisma.workTask.updateMany({
        where: { id, orgId, updatedAt: new Date(versao) },
        data: {
          ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
          ...(input.clienteId !== undefined ? { clienteId: input.clienteId } : {}),
          ...(outros !== undefined ? { outrosResponsaveisIds: outros } : {}),
          ...(input.recorrencia !== undefined
            ? { recorrencia: input.recorrencia ?? Prisma.DbNull, ...(input.recorrencia && !antes.serieId ? { serieId: id } : {}) }
            : {}),
          updatedAt: new Date(Math.max(Date.now(), new Date(versao).getTime() + 1)),
        },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'work_task_conflict', message: 'A tarefa mudou. Confira a versão atual antes de salvar.' });
      await this.audit.log({
        orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: id,
        before: { areaId: antes.areaId, clienteId: antes.clienteId },
        after: { areaId: input.areaId ?? antes.areaId, clienteId: input.clienteId === undefined ? antes.clienteId : input.clienteId },
      });
    }
    return this.uma(orgId, id);
  }

  /** Um clique: aberta → primeiro status fechado da lista; feita → primeiro aberto. */
  async alternarFeita(orgId: string, actorId: string, id: string, expectedUpdatedAt: string): Promise<TarefaDoDia & { proxima?: { id: string; prazo: string } }> {
    const t = await this.prisma.workTask.findFirst({
      where: { ...this.ondeSaoTarefas(orgId), id },
      include: { status: true, list: { include: { statuses: { orderBy: { order: 'asc' } } } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const feita = t.status.type === WorkStatusType.closed;
    const destino = feita
      ? t.list.statuses.find((s) => s.type !== WorkStatusType.closed)
      : t.list.statuses.find((s) => s.type === WorkStatusType.closed);
    if (!destino) throw new BadRequestException(feita ? 'A lista não tem status aberto.' : 'A lista não tem status de concluída.');
    await this.trabalho.editarTarefaHttp(orgId, actorId, id, { statusId: destino.id, expectedUpdatedAt });
    const regra = regraDe(t.recorrencia);
    const proxima = !feita && regra ? await this.criarProxima(orgId, actorId, t, regra) : null;
    return { ...(await this.uma(orgId, id)), ...(proxima ? { proxima } : {}) };
  }

  /**
   * Ordem manual: a sequência que a tela mandou (uma coluna, a lista, um dia)
   * vira posições 10, 20, 30… Só a posição muda; nada mais da tarefa.
   */
  async reordenar(orgId: string, actorId: string, ids: string[]): Promise<{ ok: true }> {
    const unicos = [...new Set(ids)];
    const achadas = await this.prisma.workTask.count({ where: { ...this.ondeSaoTarefas(orgId), id: { in: unicos } } });
    if (achadas !== unicos.length) throw new NotFoundException('Alguma tarefa da sequência não existe ou não é tarefa.');
    await this.prisma.$transaction(unicos.map((id, i) => this.prisma.workTask.updateMany({ where: { id, orgId }, data: { order: (i + 1) * 10 } })));
    await this.audit.log({ orgId, actorId, action: 'work.task.reorder', entityType: 'work_task', entityId: unicos[0], after: { ids: unicos } });
    return { ok: true };
  }

  /**
   * A próxima ocorrência de uma tarefa que se repete: mesma lista, título,
   * descrição, área, responsável, cliente e regra; prazo seguinte; aberta.
   * A série não ganha uma segunda aberta: concluir, reabrir e concluir de novo
   * devolve a que já existe em vez de criar outra.
   */
  private async criarProxima(
    orgId: string, actorId: string,
    t: { id: string; serieId: string | null; listId: string; title: string; description: string | null; areaId: string | null; clienteId: string | null; assigneeUserId: string | null; outrosResponsaveisIds: string[]; dueDate: Date | null; recorrencia: Prisma.JsonValue },
    regra: RecorrenciaDaTarefa,
  ): Promise<{ id: string; prazo: string }> {
    const serie = t.serieId ?? t.id;
    if (!t.serieId) await this.prisma.workTask.update({ where: { id: t.id }, data: { serieId: serie } });
    const aberta = await this.prisma.workTask.findFirst({
      where: { orgId, serieId: serie, archived: false, id: { not: t.id }, status: { type: { not: WorkStatusType.closed } } },
      select: { id: true, dueDate: true },
    });
    if (aberta) return { id: aberta.id, prazo: aberta.dueDate ? diaEmBrasilia(aberta.dueDate) : '' };
    const prazo = proximaOcorrencia(regra, t.dueDate ? diaEmBrasilia(t.dueDate) : null, hojeEmBrasilia());
    const lista = await this.prisma.workList.findFirst({ where: { id: t.listId, orgId }, include: { statuses: { orderBy: { order: 'asc' } } } });
    const aFazer = lista?.statuses.find((s) => s.type === WorkStatusType.open) ?? lista?.statuses[0];
    if (!lista || !aFazer) throw new BadRequestException('A lista da tarefa não tem status aberto para a próxima ocorrência.');
    const nova = await this.trabalho.criarTarefa(orgId, actorId, {
      listId: lista.id, statusId: aFazer.id, title: t.title, description: t.description,
      assigneeUserId: t.assigneeUserId, dueDate: instanteDoDia(prazo),
    });
    await this.prisma.workTask.update({
      where: { id: nova.id },
      data: { areaId: t.areaId, clienteId: t.clienteId, outrosResponsaveisIds: t.outrosResponsaveisIds, recorrencia: t.recorrencia ?? Prisma.DbNull, serieId: serie },
    });
    return { id: nova.id, prazo };
  }
}

/** A regra gravada, conferida (JSON que não é uma regra válida vale como "não repete"). */
function regraDe(valor: Prisma.JsonValue | null | undefined): RecorrenciaDaTarefa | null {
  if (valor == null) return null;
  const r = RecorrenciaSchema.safeParse(valor);
  return r.success ? r.data : null;
}
