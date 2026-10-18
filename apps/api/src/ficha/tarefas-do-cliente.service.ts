import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LISTA_DE_TAREFAS_DO_CLIENTE,
  ROTINA_DE_SUCESSO,
  type NovaTarefaDoCliente,
  type TarefaDoCliente,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

const ETAPAS = [
  { name: 'A fazer', type: 'open' as const, color: '#87909e' },
  { name: 'Fazendo', type: 'custom' as const, color: '#4194f6' },
  { name: 'Feito', type: 'closed' as const, color: '#008844' },
];
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** Prazo é dia: grava ao meio-dia de Brasília para não virar o dia anterior em UTC. */
const prazoParaData = (dia: string) => new Date(`${dia}T12:00:00-03:00`);
const dataParaPrazo = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d) : null;

@Injectable()
export class TarefasDoClienteService {
  constructor(private readonly prisma: PrismaService) {}

  /** A lista "Tarefas dos clientes", criada na primeira tarefa, na mesma pasta do cartão do cliente. */
  private async lista(orgId: string, folderId: string | null) {
    const ja = await this.prisma.workList.findFirst({
      where: { orgId, externalId: LISTA_DE_TAREFAS_DO_CLIENTE },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    if (ja) return ja;
    return this.prisma.workList.create({
      data: {
        orgId, folderId, name: 'Tarefas dos clientes', externalId: LISTA_DE_TAREFAS_DO_CLIENTE,
        statuses: { create: ETAPAS.map((e, i) => ({ ...e, order: i })) },
      },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
  }

  private async cartao(orgId: string, taskId: string) {
    const c = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, select: { id: true, list: { select: { folderId: true } } } });
    if (!c) throw new NotFoundException('Ficha não encontrada');
    return c;
  }

  async listar(orgId: string, taskId: string): Promise<TarefaDoCliente[]> {
    await this.cartao(orgId, taskId);
    const ts = await this.prisma.workTask.findMany({
      where: { orgId, parentId: taskId, archived: false, list: { externalId: LISTA_DE_TAREFAS_DO_CLIENTE } },
      select: { id: true, title: true, dueDate: true, assignee: true, status: { select: { type: true } } },
    });
    const hoje = hojeSp();
    return ts
      .map((t) => {
        const prazo = dataParaPrazo(t.dueDate);
        const feita = t.status.type === 'closed';
        return { id: t.id, titulo: t.title, feita, prazo, responsavel: t.assignee, atrasada: !feita && !!prazo && prazo < hoje };
      })
      .sort((a, b) => Number(a.feita) - Number(b.feita) || (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'));
  }

  async criar(orgId: string, taskId: string, body: NovaTarefaDoCliente): Promise<{ id: string }> {
    const c = await this.cartao(orgId, taskId);
    const l = await this.lista(orgId, c.list.folderId);
    const t = await this.prisma.workTask.create({
      data: {
        orgId, listId: l.id, statusId: l.statuses[0].id, parentId: taskId, title: body.titulo.trim(),
        dueDate: body.prazo ? prazoParaData(body.prazo) : null, assignee: body.responsavel?.trim() || null,
      },
    });
    return { id: t.id };
  }

  /** Cria a rotina de sucesso, pulando o que o cliente já tem com o mesmo título. */
  async rotina(orgId: string, taskId: string, responsavel?: string | null): Promise<{ criadas: number }> {
    const ja = new Set((await this.listar(orgId, taskId)).map((t) => t.titulo));
    const hoje = new Date(`${hojeSp()}T12:00:00-03:00`);
    let criadas = 0;
    for (const r of ROTINA_DE_SUCESSO) {
      if (ja.has(r.titulo)) continue;
      const d = new Date(hoje.getTime() + r.dias * 86_400_000);
      await this.criar(orgId, taskId, { titulo: r.titulo, prazo: dataParaPrazo(d), responsavel });
      criadas++;
    }
    return { criadas };
  }

  /** Marca como feita ou reabre. */
  async alternar(orgId: string, id: string): Promise<{ feita: boolean }> {
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId, list: { externalId: LISTA_DE_TAREFAS_DO_CLIENTE } },
      select: { id: true, status: { select: { type: true } }, list: { select: { statuses: { orderBy: { order: 'asc' } } } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const feita = t.status.type !== 'closed';
    const alvo = t.list.statuses.find((s) => (feita ? s.type === 'closed' : s.type === 'open')) ?? t.list.statuses[0];
    await this.prisma.workTask.update({ where: { id }, data: { statusId: alvo.id } });
    return { feita };
  }

  /** Para o cartão do quadro: abertas e a próxima a vencer, por cliente. */
  async resumoPorCliente(orgId: string, clienteIds: string[]) {
    if (!clienteIds.length) return new Map<string, { abertas: number; proxima: { titulo: string; prazo: string | null; atrasada: boolean } | null }>();
    const ts = await this.prisma.workTask.findMany({
      where: {
        orgId, parentId: { in: clienteIds }, archived: false,
        list: { externalId: LISTA_DE_TAREFAS_DO_CLIENTE }, status: { type: { not: 'closed' } },
      },
      select: { parentId: true, title: true, dueDate: true },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
    });
    const hoje = hojeSp();
    const m = new Map<string, { abertas: number; proxima: { titulo: string; prazo: string | null; atrasada: boolean } | null }>();
    for (const t of ts) {
      const r = m.get(t.parentId!) ?? { abertas: 0, proxima: null };
      r.abertas++;
      if (!r.proxima) {
        const prazo = dataParaPrazo(t.dueDate);
        r.proxima = { titulo: t.title, prazo, atrasada: !!prazo && prazo < hoje };
      }
      m.set(t.parentId!, r);
    }
    return m;
  }
}
