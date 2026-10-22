import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PORTA_DA_IMPLANTACAO, TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA, TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA, TRAB_NA_LIXEIRA,
  TRAB_TAREFA_COM_AGENTE, JA_ARQUIVADA, caminhoDaTarefa, destinoDoValorDoCampo, tituloDaCopia,
  type TrabTarefaDuplicada, type TrabTarefaMesclada, type TrabTarefaMesclarInput, type TrabTarefaMoverInput,
} from '@mktos/shared';
import { WorkListaNatureza } from '@prisma/client';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { AuditService } from '../../audit/audit.service';
import { lerAprovador } from '../../auth/aprovador';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import { PrismaService } from '../../prisma/prisma.service';
import { listaVisivel } from '../arquivadas';
import { ehListaDoComercial } from '../lista-do-comercial';
import { RECUSA_DE_MAQUINA_NO_TRABALHO } from '../so-gente-no-trabalho.guard';
import { WorkService } from '../work.service';
import { cardsDaImplantacao, idDaListaDaImplantacao } from '../lixeira/regras-da-lixeira';

const TAREFA_MUDOU = 'A tarefa mudou enquanto você confirmava. Atualize a tela e tente de novo.';

/*
 * AS AÇÕES DO MENU DA TAREFA QUE NÃO EXISTIAM (rodada de produção 3, I4, 22/10/2026).
 *
 * Renomear, arquivar e mudar de etapa continuam no PATCH de sempre. Aqui moram:
 *  · MOVER PARA (lista e etapa): as mesmas listas proibidas de "mover as tarefas"
 *    da árvore (arquivada, de cadastro, a do comercial, a da implantação), e então
 *    o PATCH de sempre, com a versão que a tela leu;
 *  · DUPLICAR: a cópia nasce na mesma lista e etapa, "cópia de" no título, com
 *    descrição, prioridade, responsáveis, cliente, área, lead, datas, etiquetas e
 *    campos; sem comentários, anexos, horas nem subtarefas. O card da implantação
 *    não se duplica (ele nasce do lead);
 *  · MESCLAR COM OUTRA: comentários, anexos e subtarefas MUDAM para a destino;
 *    etiquetas e campos são COPIADOS (o campo que a destino já preenche fica como
 *    está e o valor da origem fica guardado nela). A origem é ARQUIVADA, com o
 *    comentário "Mesclada em <link>"; nada é apagado. O card da implantação não
 *    se mescla (nem como origem nem como destino).
 * Tudo de gente (guarda pelo token e releitura no banco), com `tarefas.editar`,
 * numa transação sob o cadeado das tarefas, auditado.
 */
@Injectable()
export class AcoesDaTarefaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trabalho: WorkService,
  ) {}

  private async exigirGente(orgId: string, actorId: string): Promise<string> {
    const doBanco = await lerAprovador(this.prisma, actorId, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem mexe na tarefa precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_TRABALHO);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);
    const u = await this.prisma.user.findFirst({ where: { id: actorId, orgId }, select: { name: true } });
    return u?.name ?? 'Alguém da equipe';
  }

  // ------------------------------------------------------------------ mover

  async mover(orgId: string, actorId: string, id: string, input: TrabTarefaMoverInput) {
    await this.exigirGente(orgId, actorId);
    const t = await this.prisma.workTask.findFirst({ where: { id, orgId }, select: { id: true, listId: true, parentId: true, excluidaEm: true } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    if (t.excluidaEm) throw new ConflictException(TRAB_NA_LIXEIRA);
    if (input.listId !== t.listId) {
      const destino = await this.prisma.workList.findFirst({
        where: { id: input.listId, orgId }, select: { id: true, externalId: true, natureza: true, arquivadaEm: true },
      });
      if (!destino) throw new NotFoundException('Lista de destino não encontrada');
      const visivel = await this.prisma.workList.count({ where: { id: destino.id, orgId, AND: [listaVisivel()] } });
      if (destino.arquivadaEm || visivel !== 1) throw new BadRequestException('A lista de destino está arquivada. Escolha uma lista que aparece no Trabalho.');
      if (ehListaDoComercial(destino)) throw new BadRequestException('As tarefas do comercial moram no Funil vivo: a lista do comercial não recebe tarefas do Trabalho.');
      if (destino.natureza === WorkListaNatureza.cadastro) throw new BadRequestException('A lista de destino é de cadastro, não de tarefas. Escolha uma lista de tarefas.');
      if (!t.parentId && destino.id === (await idDaListaDaImplantacao(this.prisma, orgId))) throw new BadRequestException(PORTA_DA_IMPLANTACAO);
    }
    return this.trabalho.editarTarefaHttp(orgId, actorId, id, {
      ...(input.listId !== t.listId ? { listId: input.listId } : {}),
      ...(input.statusId ? { statusId: input.statusId } : {}),
      expectedUpdatedAt: input.expectedUpdatedAt,
    } as Parameters<WorkService['editarTarefaHttp']>[3]);
  }

  // ------------------------------------------------------------------ duplicar

  async duplicar(orgId: string, actorId: string, id: string): Promise<TrabTarefaDuplicada> {
    await this.exigirGente(orgId, actorId);
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId },
      include: { tags: { select: { id: true } }, values: true, assigneeUser: { select: { isActive: true } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    if (t.excluidaEm) throw new ConflictException(TRAB_NA_LIXEIRA);
    if ((await cardsDaImplantacao(this.prisma, orgId, [t])).has(t.id)) throw new BadRequestException(TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA);
    const titulo = tituloDaCopia(t.title).slice(0, 300);
    const nova = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.workTask.create({
        data: {
          orgId, listId: t.listId, statusId: t.statusId, title: titulo, description: t.description,
          priority: t.priority, assignee: t.assignee,
          // Responsável inativo não entra numa tarefa nova (a regra de criar).
          assigneeUserId: t.assigneeUser?.isActive ? t.assigneeUserId : null,
          outrosResponsaveisIds: t.outrosResponsaveisIds,
          clienteId: t.clienteId, areaId: t.areaId, leadId: t.leadId, parentId: t.parentId,
          dueDate: t.dueDate, startDate: t.startDate, order: t.order,
          tags: t.tags.length ? { connect: t.tags.map((tg) => ({ id: tg.id })) } : undefined,
        },
        select: { id: true, listId: true },
      });
      for (const v of t.values) {
        await tx.workFieldValue.create({ data: { taskId: criada.id, fieldId: v.fieldId, optionId: v.optionId, value: v.value } });
      }
      await this.audit.log({
        orgId, actorId, action: 'work.task.create', entityType: 'work_task', entityId: criada.id,
        after: { duplicadaDe: t.id, campos: t.values.length, etiquetas: t.tags.length },
        metadata: { origem: 'menu.duplicar', de: t.id },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
      return criada;
    });
    return { id: nova.id, listId: nova.listId, title: titulo };
  }

  // ------------------------------------------------------------------ mesclar

  async mesclar(orgId: string, actorId: string, origemId: string, input: TrabTarefaMesclarInput): Promise<TrabTarefaMesclada> {
    const autor = await this.exigirGente(orgId, actorId);
    if (input.destinoId === origemId) throw new BadRequestException('Escolha outra tarefa para receber esta.');
    const [origem, destino] = await Promise.all([
      this.prisma.workTask.findFirst({ where: { id: origemId, orgId }, include: { tags: { select: { id: true } } } }),
      this.prisma.workTask.findFirst({ where: { id: input.destinoId, orgId }, include: { tags: { select: { id: true } } } }),
    ]);
    if (!origem) throw new NotFoundException('Tarefa não encontrada');
    if (!destino) throw new NotFoundException('Tarefa de destino não encontrada');
    if (origem.excluidaEm || destino.excluidaEm) throw new ConflictException(TRAB_NA_LIXEIRA);
    if (origem.archived) throw new BadRequestException(JA_ARQUIVADA);
    if (destino.archived) throw new BadRequestException('A tarefa de destino está arquivada. Escolha uma tarefa viva.');
    if (origem.agenteId) throw new ConflictException(TRAB_TAREFA_COM_AGENTE);
    if (input.expectedUpdatedAt !== undefined && new Date(input.expectedUpdatedAt).getTime() !== origem.updatedAt.getTime()) {
      throw new ConflictException(TAREFA_MUDOU);
    }
    const cards = await cardsDaImplantacao(this.prisma, orgId, [origem, destino]);
    if (cards.size) throw new BadRequestException(TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA);

    const [camposDaOrigem, camposDoDestino] = await Promise.all([
      this.prisma.workField.findMany({ where: { orgId, OR: [{ listId: origem.listId }, { listId: null }] }, include: { options: true } }),
      this.prisma.workField.findMany({ where: { orgId, OR: [{ listId: destino.listId }, { listId: null }] }, include: { options: true }, orderBy: { order: 'asc' } }),
    ]);
    const campoDaOrigem = new Map(camposDaOrigem.map((c) => [c.id, c]));
    const idsDoDestino = new Set(camposDoDestino.map((c) => c.id));

    const r = await this.prisma.$transaction(async (tx) => {
      for (const id of [origem.id, destino.id].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-tarefa:${id}`}))`;
      }
      const agora = new Date();
      // A origem e a destino continuam como foram lidas (senão 409 e nada muda).
      const tomada = await tx.workTask.updateMany({
        where: { id: origem.id, orgId, updatedAt: origem.updatedAt, archived: false, excluidaEm: null, agenteId: null },
        data: { archived: true, updatedAt: new Date(Math.max(agora.getTime(), origem.updatedAt.getTime() + 1)) },
      });
      if (tomada.count !== 1) throw new ConflictException(TAREFA_MUDOU);
      const destinoVivo = await tx.workTask.updateMany({
        where: { id: destino.id, orgId, archived: false, excluidaEm: null },
        data: { updatedAt: new Date(Math.max(agora.getTime(), destino.updatedAt.getTime() + 1)) },
      });
      if (destinoVivo.count !== 1) throw new ConflictException(TAREFA_MUDOU);

      const comentarios = await tx.workComment.updateMany({ where: { taskId: origem.id, orgId }, data: { taskId: destino.id } });
      const anexos = await tx.workAnexo.updateMany({ where: { taskId: origem.id, orgId }, data: { taskId: destino.id } });
      const subtarefas = await tx.workTask.updateMany({ where: { orgId, parentId: origem.id, id: { not: destino.id } }, data: { parentId: destino.id } });

      const etiquetasNovas = origem.tags.map((tg) => tg.id).filter((tg) => !destino.tags.some((d) => d.id === tg));
      if (etiquetasNovas.length) {
        await tx.workTask.update({ where: { id: destino.id }, data: { tags: { connect: etiquetasNovas.map((tg) => ({ id: tg })) } } });
      }

      // Campos: copiados, nunca tirados da origem. O que a destino já preenche fica como está.
      const valoresDaOrigem = await tx.workFieldValue.findMany({ where: { taskId: origem.id } });
      const jaNoDestino = new Set((await tx.workFieldValue.findMany({ where: { taskId: destino.id }, select: { fieldId: true } })).map((v) => v.fieldId));
      let campos = 0;
      let camposGuardados = 0;
      for (const v of valoresDaOrigem) {
        const campo = campoDaOrigem.get(v.fieldId);
        const vai = idsDoDestino.has(v.fieldId)
          ? { fieldId: v.fieldId, optionId: v.optionId, value: v.value }
          : campo ? destinoDoValorDoCampo(v, campo, camposDoDestino.filter((c) => c.listId !== null)) : null;
        if (!vai || jaNoDestino.has(vai.fieldId)) { camposGuardados += 1; continue; }
        await tx.workFieldValue.create({ data: { taskId: destino.id, fieldId: vai.fieldId, optionId: vai.optionId, value: vai.value } });
        jaNoDestino.add(vai.fieldId);
        campos += 1;
      }

      await tx.workComment.create({
        data: { taskId: origem.id, authorId: actorId, authorName: autor, text: `Mesclada em [${destino.title}](${caminhoDaTarefa(destino)}).` },
      });
      await tx.workComment.create({
        data: { taskId: destino.id, authorId: actorId, authorName: autor, text: `Recebeu a tarefa mesclada [${origem.title}](${caminhoDaTarefa(origem)}): comentários, anexos, subtarefas, etiquetas e campos.` },
      });
      const contagem = {
        comentarios: comentarios.count, anexos: anexos.count, subtarefas: subtarefas.count,
        etiquetas: etiquetasNovas.length, campos, camposGuardados,
      };
      await this.audit.log({
        orgId, actorId, action: 'work.task.merge', entityType: 'work_task', entityId: origem.id,
        before: { archived: false }, after: { archived: true, destinoId: destino.id, ...contagem },
        metadata: { origem: 'menu.mesclar', papel: 'origem' },
      }, tx);
      await this.audit.log({
        orgId, actorId, action: 'work.task.merge', entityType: 'work_task', entityId: destino.id,
        after: { origemId: origem.id, ...contagem }, metadata: { origem: 'menu.mesclar', papel: 'destino' },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
      return contagem;
    }, { timeout: 60_000 });
    return { origemId: origem.id, destinoId: destino.id, ...r };
  }
}
