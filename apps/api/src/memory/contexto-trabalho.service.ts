import { createHash } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContextoTarefaCreateSchema, type ContextoTarefaCreateInput, type ContextoTarefaCreateResponse, type ContextoFontesDaTarefaResponse, type ContextoFonteUtilizadaDto } from '@mktos/shared';
import { Prisma, type ContextItem, type ContextItemVersion, type WorkContextSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual, filtroDeLeitura } from './acesso-memoria';
import { hashDoCorpo, rotuloDeProcedencia } from './procedencia';

function conflito(code: string, message: string): never { throw new ConflictException({ code, message }); }
function indisponivel(): never { throw new NotFoundException('Fonte não encontrada.'); }

export function normalizarPedidoDeContexto(input: ContextoTarefaCreateInput): ContextoTarefaCreateInput {
  const p = ContextoTarefaCreateSchema.parse(input);
  return {
    requestId: p.requestId.toLowerCase(), versionId: p.versionId.toLowerCase(),
    contentHash: p.contentHash, expectedItemVersion: p.expectedItemVersion,
    listId: p.listId.toLowerCase(), ...(p.statusId ? { statusId: p.statusId.toLowerCase() } : {}),
    title: p.title, assigneeUserId: p.assigneeUserId?.toLowerCase() ?? null,
  };
}
export function fingerprintDeContexto(orgId: string, actorId: string, itemId: string, p: ContextoTarefaCreateInput): string {
  return createHash('sha256').update(JSON.stringify({
    orgId, actorId, itemId, requestId: p.requestId, versionId: p.versionId,
    contentHash: p.contentHash, expectedItemVersion: p.expectedItemVersion,
    listId: p.listId, statusId: p.statusId ?? null, title: p.title,
    assigneeUserId: p.assigneeUserId ?? null,
  })).digest('hex');
}
function conferirVersao(v: ContextItemVersion, itemId: string, hash: string): void {
  if (v.itemId !== itemId || v.contentHash !== hash || hashDoCorpo(v.body) !== hash)
    conflito('contexto_fonte_inconsistente', 'A versão da fonte não pôde ser conferida.');
}
function dto(link: WorkContextSource, v: ContextItemVersion, item: ContextItem): ContextoFonteUtilizadaDto {
  return {
    id: link.id, itemId: link.itemId, versionId: link.versionId, chave: link.chave,
    versao: link.versao, contentHash: link.contentHash, sourceType: link.sourceType,
    sourceRef: link.sourceRef, title: link.title, body: v.body,
    procedencia: rotuloDeProcedencia(link.sourceType, link.sourceRef),
    criadoEm: v.criadoEm.toISOString(), utilizadaEm: link.createdAt.toISOString(),
    versaoAtual: item.versao, arquivada: !!item.arquivadoEm,
  };
}

@Injectable()
export class ContextoTrabalhoService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async criar(orgId: string, actorId: string, itemId: string, input: ContextoTarefaCreateInput): Promise<ContextoTarefaCreateResponse> {
    const p = normalizarPedidoDeContexto(input);
    const fingerprint = fingerprintDeContexto(orgId, actorId, itemId, p);
    return this.prisma.$transaction(async (tx) => {
      // A memória usa o mesmo cadeado ao atualizar ou arquivar a fonte.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'memoria:' + orgId);
      await exigirAcessoAtual(tx, orgId, actorId, ['obsidian.ver', 'tarefas.editar']);
      const item = await tx.contextItem.findFirst({ where: { id: itemId, orgId, ...filtroDeLeitura(actorId) } });
      if (!item) indisponivel();
      const anterior = await tx.workContextSource.findUnique({ where: { orgId_requestId: { orgId, requestId: p.requestId } } });
      if (anterior) {
        if (anterior.fingerprint !== fingerprint || anterior.actorId !== actorId || anterior.itemId !== itemId)
          conflito('contexto_pedido_conflito', 'Este pedido já foi usado com outros dados.');
        const v = await tx.contextItemVersion.findFirst({ where: { id: anterior.versionId, itemId, orgId } });
        const task = await tx.workTask.findFirst({ where: { id: anterior.taskId, orgId } });
        if (!v || !task) indisponivel();
        conferirVersao(v, itemId, anterior.contentHash);
        if (v.versao !== anterior.versao || v.title !== anterior.title || v.sourceType !== anterior.sourceType || v.sourceRef !== anterior.sourceRef)
          conflito('contexto_fonte_inconsistente', 'A versão da fonte não pôde ser conferida.');
        await exigirAcessoAtual(tx, orgId, actorId, ['obsidian.ver', 'tarefas.editar']);
        return { taskId: task.id, listId: task.listId, replayed: true, fonte: dto(anterior, v, item) };
      }
      if (item.versao !== p.expectedItemVersion || item.arquivadoEm)
        conflito('contexto_fonte_alterada', 'A fonte mudou. Confira a versão atual antes de criar a tarefa.');
      const corrente = await tx.contextItemVersion.findFirst({ where: { orgId, itemId, versao: item.versao } });
      if (!corrente || corrente.body !== item.body || corrente.title !== item.title || corrente.sourceType !== item.sourceType || corrente.sourceRef !== item.sourceRef)
        conflito('contexto_fonte_inconsistente', 'A versão corrente da fonte não pôde ser conferida.');
      conferirVersao(corrente, itemId, item.contentHash);
      const v = await tx.contextItemVersion.findFirst({ where: { id: p.versionId, itemId, orgId } });
      if (!v) indisponivel();
      conferirVersao(v, itemId, p.contentHash);
      if (v.versao > item.versao) conflito('contexto_fonte_inconsistente', 'A versão escolhida ainda não é uma versão utilizável da fonte.');
      const list = await tx.workList.findFirst({ where: { id: p.listId, orgId }, include: { statuses: { orderBy: { order: 'asc' } } } });
      if (!list) throw new NotFoundException('Lista não encontrada.');
      const status = p.statusId ? list.statuses.find((s) => s.id === p.statusId && s.orgId === orgId) : list.statuses.find((s) => s.orgId === orgId);
      if (!status) throw new NotFoundException('Etapa não encontrada nesta lista.');
      if (p.assigneeUserId && !await tx.user.findFirst({ where: { id: p.assigneeUserId, orgId, isActive: true }, select: { id: true } }))
        throw new NotFoundException('Responsável não encontrado.');
      const task = await tx.workTask.create({ data: {
        orgId, listId: list.id, statusId: status.id, title: p.title,
        assigneeUserId: p.assigneeUserId ?? null,
      } });
      const link = await tx.workContextSource.create({ data: {
        orgId, taskId: task.id, itemId, versionId: v.id, requestId: p.requestId,
        fingerprint, actorId, chave: item.chave, versao: v.versao, contentHash: v.contentHash,
        sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title,
      } });
      await this.audit.log({
        orgId, actorId, action: 'work.task.create.contexto', entityType: 'work_task', entityId: task.id,
        after: { listId: list.id, requestId: p.requestId, itemId, versionId: v.id, versao: v.versao, contentHash: v.contentHash },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['obsidian.ver', 'tarefas.editar']);
      return { taskId: task.id, listId: task.listId, replayed: false, fonte: dto(link, v, item) };
    });
  }

  async fontes(orgId: string, actorId: string, taskId: string): Promise<ContextoFontesDaTarefaResponse> {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['obsidian.ver', 'tarefas.ver']);
    const task = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, select: { id: true } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    const links = await this.prisma.workContextSource.findMany({ where: { orgId, taskId }, orderBy: { createdAt: 'asc' } });
    const fontes: ContextoFonteUtilizadaDto[] = [];
    for (const link of links) {
      const item = await this.prisma.contextItem.findFirst({ where: { id: link.itemId, orgId, ...filtroDeLeitura(actorId) } });
      if (!item) indisponivel();
      const v = await this.prisma.contextItemVersion.findFirst({ where: { id: link.versionId, itemId: link.itemId, orgId } });
      if (!v) indisponivel();
      conferirVersao(v, link.itemId, link.contentHash);
      if (v.versao !== link.versao || v.title !== link.title || v.sourceType !== link.sourceType || v.sourceRef !== link.sourceRef)
        conflito('contexto_fonte_inconsistente', 'A versão da fonte não pôde ser conferida.');
      fontes.push(dto(link, v, item));
    }
    // Uma revogação ocorrida durante a leitura não entrega os dados consultados.
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['obsidian.ver', 'tarefas.ver']);
    for (const link of links) {
      if (!await this.prisma.contextItem.findFirst({ where: { id: link.itemId, orgId, ...filtroDeLeitura(actorId) }, select: { id: true } })) indisponivel();
    }
    return { fontes };
  }
}
