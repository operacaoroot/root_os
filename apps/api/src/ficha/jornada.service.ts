import { Injectable } from '@nestjs/common';
import { ehSaida, faseDaEtapa, type QuadroDaLista } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ContratosDoClienteService } from './contratos-do-cliente.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';

const DIA = 86_400_000;
const lerMoeda = (v: string | null | undefined) => {
  const m = /^[A-Z]{3} (-?\d+(?:\.\d+)?)$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};

/**
 * O QUADRO DO CRM: um card por lead/cliente, com a jornada nas etapas (cada
 * etapa tem a sua fase: comercial, onboarding, sucesso). As abas Leads, Funil
 * e Clientes leem daqui e mostram só as etapas da fase delas.
 */
@Injectable()
export class JornadaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tarefas: TarefasDoClienteService,
    private readonly contratos: ContratosDoClienteService,
  ) {}

  async quadro(orgId: string, chave: string, agora = new Date()): Promise<QuadroDaLista> {
    const lista = await this.prisma.workList.findFirst({
      where: { orgId, externalId: chave },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    if (!lista) return { lista: null, etapas: [], camposData: [], cartoes: [] };
    const [cs, camposData] = await Promise.all([
      this.prisma.workTask.findMany({
        where: { orgId, listId: lista.id, archived: false, parentId: null },
        select: {
          id: true, title: true, statusId: true, createdAt: true, updatedAt: true, statusDesde: true, dueDate: true,
          values: { select: { value: true, fieldId: true, option: { select: { name: true, color: true } }, field: { select: { name: true, type: true } } } },
        },
      }),
      this.prisma.workField.findMany({ where: { orgId, listId: lista.id, type: 'data' }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    ]);
    const ids = cs.map((c) => c.id);
    const [resumo, contratos] = await Promise.all([this.tarefas.resumoPorCliente(orgId, ids), this.contratos.porCliente(orgId, ids)]);

    const cartoes = cs.map((c) => {
      // O valor do card é o da proposta: a lista também tem o recorrente (mês), que não é o mesmo número.
      const proposta = c.values.find((v) => v.field.type === 'moeda' && /proposta/i.test(v.field.name) && v.value)
        ?? c.values.find((v) => v.field.type === 'moeda' && v.value);
      const contato = c.values.find((v) => /^contato/i.test(v.field.name))?.value ?? null;
      const resp = c.values.find((v) => /^(vendedor|responsavel|responsável)/i.test(v.field.name) && v.option);
      const selo = c.values.find((v) => /^produto/i.test(v.field.name) && v.option) ?? c.values.find((v) => v.option && v !== resp);
      const doCliente = contratos.get(c.id) ?? [];
      return {
        id: c.id,
        titulo: c.title,
        statusId: c.statusId,
        datas: Object.fromEntries(
          c.values.filter((v) => v.field.type === 'data' && v.value && /^\d{4}-\d{2}-\d{2}/.test(v.value)).map((v) => [v.fieldId, v.value!.slice(0, 10)]),
        ),
        prazo: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null,
        criadoEm: c.createdAt.toISOString(),
        valor: lerMoeda(proposta?.value),
        valorContratos: doCliente.reduce((s, k) => s + k.valor, 0),
        contato,
        responsavel: resp?.option?.name ?? null,
        selo: selo?.option?.name ?? null,
        seloCor: selo?.option?.color ?? null,
        diasNaEtapa: c.statusDesde ? Math.floor((agora.getTime() - c.statusDesde.getTime()) / DIA) : null,
        atualizadoEm: c.updatedAt.toISOString(),
        tarefasAbertas: resumo.get(c.id)?.abertas ?? 0,
        proximaTarefa: resumo.get(c.id)?.proxima ?? null,
      };
    });
    return {
      lista: { id: lista.id, nome: lista.name, chave },
      camposData: camposData.map((f) => ({ id: f.id, nome: f.name })),
      etapas: lista.statuses.map((s) => {
        const da = cartoes.filter((c) => c.statusId === s.id);
        return {
          id: s.id, nome: s.name, cor: s.color, fechada: s.type === 'closed',
          fase: faseDaEtapa(s.name), saida: ehSaida(s.name),
          qtd: da.length, valor: da.reduce((t, c) => t + (c.valorContratos || c.valor || 0), 0),
        };
      }),
      cartoes,
    };
  }
}
