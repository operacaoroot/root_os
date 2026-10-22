import { Injectable, NotFoundException } from '@nestjs/common';
import type { ComercialEtapa, TrabMovimentoDoCartao, TrabMovimentoDoQuadro, TrabPassoDoCartao } from '@mktos/shared';
import { WorkStatusType } from '@prisma/client';

import { ACOES_DA_ATIVIDADE, ENTIDADE_DA_TAREFA } from '../caixa/atividade-da-caixa';
import { seloDoCard } from '../comercial/card-da-implantacao';
import { PrismaService } from '../prisma/prisma.service';
import { tarefaViva } from './arquivadas';
import { PASSOS_NO_BALAO, passoDaAuditoria, passoDoComentario, ultimoPasso } from './movimento-do-quadro';

/*
 * O MOVIMENTO DO QUADRO (rodada da implantação I2, 18/10/2026) — `GET
 * /trabalho/quadro/movimento?listId=`.
 *
 * Uma leitura por lista aberta, separada da listagem de tarefas de propósito:
 * a listagem pagina e é usada por outras telas (caixa, MCP); o rodapé e o balão
 * são só do quadro, e falhar aqui tira o rodapé, nunca o quadro.
 *
 * Tudo com a empresa no `where` (a tarefa, a auditoria, o comentário, o
 * trilho, a ficha): o id da lista vem da tela.
 */

/** Teto de cartões por lista lidos aqui; acima disso o rodapé some dos mais velhos. */
export const TETO_DE_CARTOES = 500;
/** Linhas de auditoria lidas por chamada (as mais novas). */
const TETO_DE_AUDITORIA = 4000;

@Injectable()
export class MovimentoDoQuadroService {
  constructor(private readonly prisma: PrismaService) {}

  async daLista(orgId: string, listId: string): Promise<TrabMovimentoDoQuadro> {
    const lista = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true } });
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const tarefas = await this.prisma.workTask.findMany({
      where: { orgId, listId, archived: false, parentId: null, AND: [tarefaViva()] },
      orderBy: [{ updatedAt: 'desc' }],
      take: TETO_DE_CARTOES,
      select: { id: true, createdAt: true },
    });
    const ids = tarefas.map((t) => t.id);
    if (ids.length === 0) return { itens: [] };

    const [auditoria, comentarios, trilhos, fichas, subtarefas] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { orgId, entityType: ENTIDADE_DA_TAREFA, entityId: { in: ids }, action: { in: [...ACOES_DA_ATIVIDADE] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TETO_DE_AUDITORIA,
        select: { action: true, actorType: true, actorId: true, entityId: true, before: true, after: true, createdAt: true },
      }),
      // O último comentário de cada cartão. `distinct` com a ordem: o primeiro de cada tarefa é o mais novo.
      this.prisma.workComment.findMany({
        where: { orgId, taskId: { in: ids }, task: { orgId } },
        orderBy: [{ taskId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['taskId'],
        select: { taskId: true, authorName: true, text: true, createdAt: true },
      }),
      this.prisma.onboardingTrilho.findMany({
        where: { orgId, cardId: { in: ids } },
        select: { cardId: true, proximoPasso: true, proximoPassoDono: true, proximoPassoEm: true, kickoffEm: true },
      }),
      this.prisma.comercialFicha.findMany({
        where: { orgId, cardId: { in: ids } },
        select: { cardId: true, leadId: true, kickoffEm: true, etapa: true, motivoSaida: true, clienteAtivoEm: true },
      }),
      this.prisma.workTask.findMany({
        where: { orgId, parentId: { in: ids }, archived: false, AND: [tarefaViva()], status: { type: { not: WorkStatusType.closed } } },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { parentId: true, title: true, assignee: true, dueDate: true },
      }),
    ]);

    const idsDeGente = [...new Set(auditoria.filter((a) => a.actorType === 'user' && a.actorId).map((a) => a.actorId as string))];
    const gente = idsDeGente.length
      ? await this.prisma.user.findMany({ where: { orgId, id: { in: idsDeGente } }, select: { id: true, name: true } })
      : [];
    const nomeDe = new Map(gente.map((g) => [g.id, g.name]));

    const passosDe = new Map<string, TrabPassoDoCartao[]>();
    for (const a of auditoria) {
      if (!a.entityId) continue;
      const lista = passosDe.get(a.entityId) ?? [];
      if (lista.length >= PASSOS_NO_BALAO) continue;
      const p = passoDaAuditoria(a, nomeDe);
      if (!p) continue;
      lista.push(p);
      passosDe.set(a.entityId, lista);
    }
    const comentarioDe = new Map(comentarios.map((c) => [c.taskId, passoDoComentario(c)]));
    const trilhoDe = new Map(trilhos.filter((t) => t.cardId).map((t) => [t.cardId as string, t]));
    const fichaDe = new Map(fichas.filter((f) => f.cardId).map((f) => [f.cardId as string, f]));
    // A2: o card iniciado antes do fechamento e o fechamento registrado nele são FATOS do fio do lead;
    // o selo é lido deles (sem coluna nova). Só os leads destes cards, com a empresa no `where`.
    const fatos = fichas.length
      ? await this.prisma.leadEvent.findMany({
          where: { orgId, leadId: { in: fichas.map((f) => f.leadId) }, type: { in: ['implantacao.iniciada_antes_do_fechamento', 'implantacao.fechamento_registrado', 'implantacao.card_criado'] } },
          select: { leadId: true, type: true, occurredAt: true, payload: true },
        })
      : [];
    const antecipadoDe = new Set<string>();
    const importadoDe = new Set<string>();
    const fechadoNoCardEm = new Map<string, Date>();
    for (const f of fatos) {
      const card = String(((f.payload ?? {}) as { cardId?: unknown }).cardId ?? '');
      if (f.type === 'implantacao.card_criado') {
        // Rodada de produção 1: o card que o importador do CRM antigo abriu tem selo próprio.
        if (((f.payload ?? {}) as { origem?: unknown }).origem === 'importacao') importadoDe.add(`${f.leadId}:${card}`);
        continue;
      }
      if (f.type === 'implantacao.iniciada_antes_do_fechamento') antecipadoDe.add(`${f.leadId}:${card}`);
      else if (!fechadoNoCardEm.has(`${f.leadId}:${card}`)) fechadoNoCardEm.set(`${f.leadId}:${card}`, f.occurredAt);
    }
    const subDe = new Map<string, (typeof subtarefas)[number]>();
    for (const s of subtarefas) if (s.parentId && !subDe.has(s.parentId)) subDe.set(s.parentId, s);

    const itens: TrabMovimentoDoCartao[] = tarefas.map((t) => {
      const passos = passosDe.get(t.id) ?? [];
      const ultimoComentario = comentarioDe.get(t.id) ?? null;
      const trilho = trilhoDe.get(t.id);
      const ficha = fichaDe.get(t.id);
      const sub = subDe.get(t.id);
      let proximaAcao: TrabMovimentoDoCartao['proximaAcao'] = null;
      if (trilho?.proximoPasso) {
        proximaAcao = { texto: trilho.proximoPasso, dono: trilho.proximoPassoDono ?? null, quando: trilho.proximoPassoEm?.toISOString() ?? null, fonte: 'trilho' };
      } else if (sub) {
        proximaAcao = { texto: sub.title, dono: sub.assignee ?? null, quando: sub.dueDate?.toISOString() ?? null, fonte: 'subtarefa' };
      } else if (ficha && !ficha.kickoffEm && !trilho?.kickoffEm) {
        // Fato, não suposição: o card nasceu do fechamento e o kickoff ainda não está marcado.
        proximaAcao = { texto: 'marcar o kickoff com o cliente', dono: null, quando: null, fonte: 'implantacao' };
      }
      return {
        tarefaId: t.id,
        ultimo: ultimoPasso(passos, ultimoComentario),
        passos,
        ultimoComentario,
        proximaAcao,
        procedencia: ficha
          ? seloDoCard({
              leadId: ficha.leadId,
              criadoEm: t.createdAt,
              etapa: ficha.etapa as ComercialEtapa,
              motivoSaida: ficha.motivoSaida,
              antecipado: antecipadoDe.has(`${ficha.leadId}:${t.id}`),
              importado: importadoDe.has(`${ficha.leadId}:${t.id}`),
              fechadoEm: fechadoNoCardEm.get(`${ficha.leadId}:${t.id}`) ?? ficha.clienteAtivoEm ?? null,
            })
          : null,
      };
    });
    return { itens };
  }
}
