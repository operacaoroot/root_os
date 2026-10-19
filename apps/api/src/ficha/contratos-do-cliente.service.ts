import { Injectable, NotFoundException } from '@nestjs/common';
import { LISTA_DE_CONTRATOS_DO_CLIENTE, type ContratoDoCliente, type NovoContrato } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

const ETAPAS = [
  { name: 'Ativo', type: 'open' as const, color: '#30a46c' },
  { name: 'Concluído', type: 'closed' as const, color: '#008844' },
  { name: 'Cancelado', type: 'closed' as const, color: '#6b6b6b' },
];
const lerMoeda = (v: string | null | undefined) => {
  const m = /^[A-Z]{3} (-?\d+(?:\.\d+)?)$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/**
 * CONTRATOS DO CLIENTE: filhos do card na lista "Contratos dos clientes", com
 * "Valor" (moeda) e "Fechado em" (data). Um cliente pode fechar mais de uma vez;
 * o Painel geral soma os contratos por mês.
 */
@Injectable()
export class ContratosDoClienteService {
  constructor(private readonly prisma: PrismaService) {}

  private async lista(orgId: string, folderId: string | null) {
    const ja = await this.prisma.workList.findFirst({ where: { orgId, externalId: LISTA_DE_CONTRATOS_DO_CLIENTE } });
    const l =
      ja ??
      (await this.prisma.workList.create({
        data: {
          orgId, folderId, name: 'Contratos dos clientes', externalId: LISTA_DE_CONTRATOS_DO_CLIENTE,
          statuses: { create: ETAPAS.map((e, i) => ({ ...e, order: i })) },
        },
      }));
    const campo = async (name: string, type: 'moeda' | 'data', order: number) =>
      (await this.prisma.workField.findFirst({ where: { orgId, listId: l.id, name } })) ??
      (await this.prisma.workField.create({ data: { orgId, listId: l.id, name, type, order } }));
    const [valor, fechado] = [await campo('Valor', 'moeda', 0), await campo('Fechado em', 'data', 1)];
    const statuses = await this.prisma.workStatus.findMany({ where: { listId: l.id }, orderBy: { order: 'asc' } });
    return { id: l.id, statuses, valor: valor.id, fechado: fechado.id };
  }

  /** Contratos de vários cards de uma vez (o painel e o quadro). */
  async porCliente(orgId: string, clienteIds: string[]): Promise<Map<string, ContratoDoCliente[]>> {
    const m = new Map<string, ContratoDoCliente[]>();
    if (!clienteIds.length) return m;
    const ts = await this.prisma.workTask.findMany({
      where: {
        orgId, parentId: { in: clienteIds }, archived: false,
        list: { externalId: LISTA_DE_CONTRATOS_DO_CLIENTE }, status: { name: { not: 'Cancelado' } },
      },
      select: { id: true, title: true, parentId: true, createdAt: true, values: { select: { value: true, field: { select: { name: true } } } } },
    });
    for (const t of ts) {
      const v = (n: string) => t.values.find((x) => semAcento(x.field.name) === n)?.value ?? null;
      const contrato = {
        id: t.id,
        titulo: t.title,
        valor: lerMoeda(v('valor')) ?? 0,
        fechadoEm: (v('fechado em') ?? t.createdAt.toISOString()).slice(0, 10),
      };
      m.set(t.parentId!, [...(m.get(t.parentId!) ?? []), contrato].sort((a, b) => a.fechadoEm.localeCompare(b.fechadoEm)));
    }
    return m;
  }

  async listar(orgId: string, taskId: string): Promise<ContratoDoCliente[]> {
    await this.cartao(orgId, taskId);
    return (await this.porCliente(orgId, [taskId])).get(taskId) ?? [];
  }

  private async cartao(orgId: string, taskId: string) {
    const c = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: { id: true, title: true, list: { select: { folderId: true } }, values: { select: { value: true, option: { select: { name: true } }, field: { select: { name: true, type: true } } } } },
    });
    if (!c) throw new NotFoundException('Ficha não encontrada');
    return c;
  }

  async criar(orgId: string, taskId: string, body: NovoContrato): Promise<{ id: string }> {
    const c = await this.cartao(orgId, taskId);
    const l = await this.lista(orgId, c.list.folderId);
    const t = await this.prisma.$transaction(async (db) => {
      const t = await db.workTask.create({ data: { orgId, listId: l.id, statusId: l.statuses[0].id, parentId: taskId, title: body.titulo.trim() } });
      await db.workFieldValue.create({ data: { taskId: t.id, fieldId: l.valor, value: `BRL ${body.valor.toFixed(2)}` } });
      await db.workFieldValue.create({ data: { taskId: t.id, fieldId: l.fechado, value: body.fechadoEm } });
      return t;
    });
    return { id: t.id };
  }

  /**
   * O card acabou de virar cliente (foi para "Negócio fechado" ou além) e não
   * tem contrato: registra um, com o valor da proposta, o produto e a data de hoje.
   */
  async garantir(orgId: string, taskId: string): Promise<{ criado: boolean }> {
    if ((await this.listar(orgId, taskId)).length) return { criado: false };
    const c = await this.cartao(orgId, taskId);
    const valor = lerMoeda(c.values.find((v) => v.field.type === 'moeda' && /proposta/i.test(v.field.name))?.value) ?? 0;
    const produto = c.values.find((v) => semAcento(v.field.name) === 'produto')?.option?.name;
    await this.criar(orgId, taskId, { titulo: produto ?? 'Contrato', valor, fechadoEm: hojeSp() });
    return { criado: true };
  }

  /** Tira o contrato (cancelado não entra na conta do painel). */
  async cancelar(orgId: string, id: string): Promise<{ ok: true }> {
    const t = await this.prisma.workTask.findFirst({ where: { id, orgId, list: { externalId: LISTA_DE_CONTRATOS_DO_CLIENTE } }, select: { listId: true } });
    if (!t) throw new NotFoundException('Contrato não encontrado');
    const st = await this.prisma.workStatus.findFirst({ where: { listId: t.listId, name: 'Cancelado' } });
    await this.prisma.workTask.update({ where: { id }, data: st ? { statusId: st.id } : { archived: true } });
    return { ok: true };
  }
}
