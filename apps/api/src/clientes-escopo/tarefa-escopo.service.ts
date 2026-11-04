import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from './cliente-escopo.service';
import type { Prisma } from '@prisma/client';

/** Autoriza também a cadeia legada antes de entregar arquivos ou metadados. */
@Injectable()
export class TarefaEscopoService {
  constructor(private readonly prisma: PrismaService, private readonly escopo: ClienteEscopoService) {}

  async exigir(orgId: string, userId: string, id: string, db: Prisma.TransactionClient = this.prisma) {
    const filtro = await this.escopo.filtro(orgId, userId, undefined, db);
    const ler = (taskId: string) => db.workTask.findFirst({
      where: { orgId, id: taskId }, select: { id: true, clienteId: true, parentId: true },
    });
    const tarefa = await ler(id);
    const negar = () => { throw new NotFoundException('Tarefa não encontrada.'); };
    if (!tarefa) return negar();
    if (!('clienteId' in filtro)) return tarefa;
    const ids = typeof filtro.clienteId === 'object' && filtro.clienteId !== null ? filtro.clienteId.in : [];
    if (!tarefa.clienteId || !ids.includes(tarefa.clienteId)) return negar();
    const vistos = new Set([id]);
    let parentId = tarefa.parentId;
    while (parentId) {
      if (vistos.has(parentId) || vistos.size >= 100) return negar();
      vistos.add(parentId);
      const pai = await ler(parentId);
      if (!pai || pai.clienteId !== tarefa.clienteId) return negar();
      parentId = pai.parentId;
    }
    return tarefa;
  }
}
