import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkStatusType } from '@prisma/client';
import {
  COMERCIAL_TETO_DE_CONCLUIDAS, DOMINIO_DAS_CONTAS_DO_SISTEMA, TAREFA_IGUAL_JA_EXISTE, equipeDasContas, situacaoDoPrazo, tarefaIgual,
  type TarefaDoComercial, type TarefaDoComercialCriar, type TarefaDoComercialEditar, type TarefasDoComercial,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { tarefaDeListaVisivel } from '../../work/arquivadas';
import { LISTA_DO_COMERCIAL, acharOuCriarListaDoComercial } from '../../work/lista-do-comercial';
import { WorkService } from '../../work/work.service';
import { antesNaFila, diaEmSP } from './tarefa-do-cartao';

/*
 * AS TAREFAS DO COMERCIAL (adendo da rodada de produção 1, 21/10/2026, §A1).
 *
 * Não é uma segunda tabela de tarefas: lê e escreve `WorkTask`, e toda escrita
 * de título, status, responsável e prazo passa pelo `WorkService` (versão lida,
 * permissão relida no banco, auditoria `work.task.*`), como o Dia a dia faz. O
 * que este serviço acrescenta é o RECORTE e o LEAD:
 *
 *   · é tarefa do comercial a da lista do comercial (`externalId =
 *     comercial:tarefas`, com ou sem lead) e qualquer tarefa com `leadId`; o
 *     resto do Trabalho não se lê nem se edita por aqui (404);
 *   · criar vai sempre para a lista do comercial, com a área Comercial, e o
 *     lead é conferido na empresa antes (a chave composta do banco também
 *     recusaria, mas a frase vem daqui);
 *   · ligar e desligar o lead é escrita condicionada à versão, com auditoria.
 */

const INCLUDE = {
  status: { select: { name: true, type: true } },
  assigneeUser: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true, ficha: { select: { empresa: true } } } },
} satisfies Prisma.WorkTaskInclude;
type Linha = Prisma.WorkTaskGetPayload<{ include: typeof INCLUDE }>;
type Equipe = { pessoas: { id: string; nome: string }[]; canonica: Map<string, string>; nomeDe: Map<string, string> };

export interface FiltroDasTarefasDoComercial {
  leadId?: string | null;
  semLead?: boolean;
  /** O mesmo valor do filtro "Responsável" do funil: id de uma pessoa, `eu` ou `sem`. */
  pessoa?: string | null;
}

const CONFLITO = { code: 'work_task_conflict', message: 'A tarefa mudou. Confira a versão atual antes de salvar.' };

/** Meia-noite de São Paulo do dia, que é como o prazo de dia inteiro é guardado (o mesmo do Dia a dia). */
function instanteDoDia(dia: string): string {
  return new Date(`${dia}T03:00:00.000Z`).toISOString();
}

function tipoDaEtapa(tipo: WorkStatusType): TarefaDoComercial['status']['tipo'] {
  return tipo === WorkStatusType.closed ? 'concluida' : tipo === WorkStatusType.custom ? 'andamento' : 'aberta';
}

@Injectable()
export class TarefasDoComercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trabalho: WorkService,
  ) {}

  /** O recorte: lista do comercial ou ligada a lead; não arquivada; lista e pasta vivas. */
  private onde(orgId: string): Prisma.WorkTaskWhereInput {
    return {
      orgId, archived: false,
      AND: [
        { OR: [{ list: { externalId: LISTA_DO_COMERCIAL } }, { leadId: { not: null } }] },
        tarefaDeListaVisivel(),
      ],
    };
  }

  /** A equipe: uma pessoa por nome, sem as contas do sistema nem a da empresa (a mesma régua do Dia a dia). */
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

  private mapear(t: Linha, hoje: string, equipe: Equipe): TarefaDoComercial {
    const prazo = t.dueDate ? diaEmSP(t.dueDate) : null;
    const tipo = tipoDaEtapa(t.status.type);
    const idDaPessoa = t.assigneeUserId ? equipe.canonica.get(t.assigneeUserId) : undefined;
    return {
      id: t.id,
      titulo: t.title,
      pessoa: idDaPessoa ? { id: idDaPessoa, nome: equipe.nomeDe.get(idDaPessoa)! } : null,
      responsavelTexto: idDaPessoa ? null : (t.assigneeUser?.name ?? t.assignee ?? null),
      prazo,
      situacao: situacaoDoPrazo(prazo, hoje, tipo === 'concluida'),
      status: { nome: t.status.name, tipo },
      lead: t.lead ? { id: t.lead.id, nome: t.lead.ficha?.empresa ?? t.lead.name } : null,
      criadaEm: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  /** As contas que valem para o filtro de responsável (a pessoa com duas contas conta pelas duas). */
  private contasDaPessoa(equipe: Equipe, id: string): string[] {
    const alvo = equipe.canonica.get(id) ?? id;
    return [...new Set([id, alvo, ...[...equipe.canonica.entries()].filter(([, c]) => c === alvo).map(([conta]) => conta)])];
  }

  async listar(orgId: string, quemPergunta: string, filtro: FiltroDasTarefasDoComercial = {}): Promise<TarefasDoComercial> {
    const hoje = diaEmSP(new Date());
    const equipe = await this.equipe(orgId);
    const e: Prisma.WorkTaskWhereInput[] = [this.onde(orgId)];
    if (filtro.leadId) e.push({ leadId: filtro.leadId });
    else if (filtro.semLead) e.push({ leadId: null });
    const pessoa = (filtro.pessoa ?? '').trim();
    if (pessoa === 'sem') e.push({ assigneeUserId: null });
    else if (pessoa === 'eu') e.push({ assigneeUserId: { in: this.contasDaPessoa(equipe, quemPergunta) } });
    else if (pessoa) e.push({ assigneeUserId: { in: this.contasDaPessoa(equipe, pessoa) } });
    const [abertas, concluidas] = await Promise.all([
      this.prisma.workTask.findMany({
        where: { AND: [...e, { status: { type: { not: WorkStatusType.closed } } }] },
        include: INCLUDE,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 500,
      }),
      this.prisma.workTask.findMany({
        where: { AND: [...e, { status: { type: WorkStatusType.closed } }] },
        include: INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: COMERCIAL_TETO_DE_CONCLUIDAS,
      }),
    ]);
    // A ordem da "mais antiga" é por dia de São Paulo, a mesma do cartão do funil.
    const fila = [...abertas].sort((a, b) => antesNaFila(
      { id: a.id, leadId: '', title: a.title, dueDate: a.dueDate, createdAt: a.createdAt, responsavel: null },
      { id: b.id, leadId: '', title: b.title, dueDate: b.dueDate, createdAt: b.createdAt, responsavel: null },
    ));
    return {
      hoje,
      pessoas: equipe.pessoas,
      tarefas: [...fila, ...concluidas].map((t) => this.mapear(t, hoje, equipe)),
      abertas: abertas.length,
    };
  }

  /**
   * Uma tarefa, já mapeada. `semRecorte`: depois de desligar o lead de uma tarefa
   * de outra lista, ela sai do recorte, mas quem editou ainda recebe a resposta.
   */
  private async uma(orgId: string, id: string, semRecorte = false): Promise<TarefaDoComercial> {
    const t = await this.prisma.workTask.findFirst({ where: semRecorte ? { orgId, id } : { AND: [this.onde(orgId), { id }] }, include: INCLUDE });
    if (!t) throw new NotFoundException('Tarefa do comercial não encontrada.');
    return this.mapear(t, diaEmSP(new Date()), await this.equipe(orgId));
  }

  /** O lead é desta empresa? (A chave composta do banco também recusaria; a frase vem daqui.) */
  private async conferirLead(orgId: string, leadId: string | null | undefined): Promise<void> {
    if (!leadId) return;
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new BadRequestException('Lead não encontrado nesta empresa.');
  }

  async criar(orgId: string, actorId: string, input: TarefaDoComercialCriar): Promise<TarefaDoComercial> {
    await this.conferirLead(orgId, input.leadId);
    /*
     * TÍTULO REPETIDO (rodada de produção 2, M3, 22/10/2026): a mesma regra e a
     * mesma frase do Dia a dia. Aberta IGUAL (mesmo título normalizado, ou as
     * mesmas palavras em outra ordem) e do mesmo lead (ou as duas sem lead) não
     * nasce de novo; a resposta aponta a que já existe.
     */
    const abertas = await this.prisma.workTask.findMany({
      where: { AND: [this.onde(orgId), { leadId: input.leadId ?? null }, { status: { type: { not: WorkStatusType.closed } } }] },
      select: { id: true, title: true },
    });
    const igual = tarefaIgual(abertas, input.titulo, (t) => t.title);
    if (igual) throw new ConflictException({ code: 'tarefa_igual', message: TAREFA_IGUAL_JA_EXISTE, tarefaId: igual.id });
    const lista = await acharOuCriarListaDoComercial(this.prisma, orgId);
    const aberto = lista.statuses.find((s) => s.type === WorkStatusType.open) ?? lista.statuses.find((s) => s.type !== WorkStatusType.closed);
    if (!aberto) throw new BadRequestException('A lista do comercial não tem etapa aberta.');
    // A criação é a do Trabalho (porta da implantação, responsável conferido, auditoria `work.task.create`).
    const criada = await this.trabalho.criarTarefa(orgId, actorId, {
      listId: lista.id, statusId: aberto.id, title: input.titulo.trim(),
      assigneeUserId: input.pessoaId ?? null,
      dueDate: input.prazo ? instanteDoDia(input.prazo) : null,
    });
    // A área e o lead vão depois, como a área no Dia a dia; a linha de auditoria diz os dois.
    await this.prisma.workTask.updateMany({ where: { id: criada.id, orgId }, data: { areaId: lista.areaId, leadId: input.leadId ?? null } });
    await this.audit.log({
      orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: criada.id,
      before: { areaId: null, leadId: null },
      after: { areaId: lista.areaId, leadId: input.leadId ?? null, origem: 'comercial' },
    });
    return this.uma(orgId, criada.id);
  }

  async editar(orgId: string, actorId: string, id: string, input: TarefaDoComercialEditar): Promise<TarefaDoComercial> {
    const antes = await this.prisma.workTask.findFirst({ where: { AND: [this.onde(orgId), { id }] }, select: { id: true, listId: true, leadId: true } });
    if (!antes) throw new NotFoundException('Tarefa do comercial não encontrada.');
    if (input.leadId !== undefined) await this.conferirLead(orgId, input.leadId);
    let statusId: string | undefined;
    if (input.etapa) {
      const tipo = input.etapa === 'concluida' ? WorkStatusType.closed : input.etapa === 'andamento' ? WorkStatusType.custom : WorkStatusType.open;
      const st = await this.prisma.workStatus.findFirst({ where: { listId: antes.listId, orgId, type: tipo }, orderBy: { order: 'asc' } });
      if (!st) throw new BadRequestException('A lista desta tarefa não tem esse status.');
      statusId = st.id;
    }
    let versao = input.expectedUpdatedAt;
    const doTrabalho = {
      ...(input.titulo !== undefined ? { title: input.titulo.trim() } : {}),
      ...(statusId ? { statusId } : {}),
      ...(input.pessoaId !== undefined ? { assigneeUserId: input.pessoaId } : {}),
      ...(input.prazo !== undefined ? { dueDate: input.prazo ? instanteDoDia(input.prazo) : null } : {}),
    };
    if (Object.keys(doTrabalho).length) {
      const d = await this.trabalho.editarTarefaHttp(orgId, actorId, id, { ...doTrabalho, expectedUpdatedAt: versao });
      // Concluir a que se repete cria a próxima pelo Trabalho, que já copia o lead (M3, 22/10/2026).
      versao = d.updatedAt;
    }
    if (input.leadId !== undefined && input.leadId !== antes.leadId) {
      const r = await this.prisma.workTask.updateMany({
        where: { id, orgId, updatedAt: new Date(versao) },
        data: { leadId: input.leadId, updatedAt: new Date(Math.max(Date.now(), new Date(versao).getTime() + 1)) },
      });
      if (r.count !== 1) throw new ConflictException(CONFLITO);
      await this.audit.log({
        orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: id,
        before: { leadId: antes.leadId }, after: { leadId: input.leadId, origem: 'comercial' },
      });
    }
    return this.uma(orgId, id, true);
  }
}
