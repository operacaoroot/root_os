import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  JORNADA_DO_CLIENTE,
  faseDaLista,
  type ChaveDaJornada,
  type JornadaDoCliente,
  type QuadroDaLista,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FichaService } from './ficha.service';

const DIA = 86_400_000;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const lerMoeda = (v: string | null | undefined) => {
  const m = /^[A-Z]{3} (-?\d+(?:\.\d+)?)$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};

type CartaoComValores = {
  id: string; title: string; listId: string; statusId: string; createdAt: Date; updatedAt: Date; statusDesde: Date | null;
  values: { value: string | null; option: { name: string; color: string } | null; field: { name: string; type: string } }[];
};

/** O nome que liga os cartões do mesmo cliente: o campo Empresa, ou o título até o "|". */
function chaveDoCliente(c: CartaoComValores): string {
  const empresa = c.values.find((v) => semAcento(v.field.name) === 'empresa')?.value?.trim();
  return semAcento(empresa || c.title.split('|')[0]);
}

@Injectable()
export class JornadaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichaService,
  ) {}

  private async listasDaJornada(orgId: string) {
    const ls = await this.prisma.workList.findMany({
      where: { orgId, externalId: { in: JORNADA_DO_CLIENTE.map((f) => f.chave) } },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    return new Map(ls.map((l) => [l.externalId!, l]));
  }

  private cartoes(orgId: string, listIds: string[]): Promise<CartaoComValores[]> {
    return this.prisma.workTask.findMany({
      where: { orgId, listId: { in: listIds }, archived: false, parentId: null },
      select: {
        id: true, title: true, listId: true, statusId: true, createdAt: true, updatedAt: true, statusDesde: true,
        values: { select: { value: true, option: { select: { name: true, color: true } }, field: { select: { name: true, type: true } } } },
      },
    });
  }

  /** O quadro de uma lista da jornada, para o kanban de onboarding e de sucesso do cliente. */
  async quadro(orgId: string, chave: string, agora = new Date()): Promise<QuadroDaLista> {
    const lista = (await this.listasDaJornada(orgId)).get(chave);
    if (!lista) return { lista: null, etapas: [], cartoes: [] };
    const cs = await this.cartoes(orgId, [lista.id]);
    const cartoes = cs.map((c) => {
      const moeda = c.values.find((v) => v.field.type === 'moeda' && v.value);
      const contato = c.values.find((v) => /^contato/i.test(v.field.name))?.value ?? null;
      const resp = c.values.find((v) => /^(responsavel|responsável|vendedor)/i.test(v.field.name) && v.option);
      const selo = c.values.find((v) => v.option && v !== resp);
      return {
        id: c.id,
        titulo: c.title,
        statusId: c.statusId,
        valor: lerMoeda(moeda?.value),
        contato,
        responsavel: resp?.option?.name ?? null,
        selo: selo?.option?.name ?? null,
        seloCor: selo?.option?.color ?? null,
        diasNaEtapa: c.statusDesde ? Math.floor((agora.getTime() - c.statusDesde.getTime()) / DIA) : null,
        atualizadoEm: c.updatedAt.toISOString(),
      };
    });
    return {
      lista: { id: lista.id, nome: lista.name, chave },
      etapas: lista.statuses.map((s) => {
        const da = cartoes.filter((c) => c.statusId === s.id);
        return { id: s.id, nome: s.name, cor: s.color, fechada: s.type === 'closed', qtd: da.length, valor: da.reduce((t, c) => t + (c.valor ?? 0), 0) };
      }),
      cartoes,
    };
  }

  /** Todos os cartões do mesmo cliente nas três listas, e as reuniões deles juntas. */
  async jornada(orgId: string, taskId: string): Promise<JornadaDoCliente> {
    const listas = await this.listasDaJornada(orgId);
    const porId = new Map([...listas.values()].map((l) => [l.id, l]));
    const todos = await this.cartoes(orgId, [...porId.keys()]);
    const este = todos.find((c) => c.id === taskId);
    if (!este) {
      const existe = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, select: { title: true } });
      if (!existe) throw new NotFoundException('Ficha não encontrada');
      return { cliente: existe.title, passos: [], reunioes: [] };
    }
    const chave = chaveDoCliente(este);
    const doCliente = todos.filter((c) => chaveDoCliente(c) === chave);
    const ordem = (c: CartaoComValores) => JORNADA_DO_CLIENTE.findIndex((f) => f.chave === porId.get(c.listId)?.externalId);
    const passos = doCliente
      .sort((a, b) => ordem(a) - ordem(b) || a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => {
        const l = porId.get(c.listId)!;
        const s = l.statuses.find((x) => x.id === c.statusId);
        return {
          id: c.id, titulo: c.title, chave: l.externalId!, fase: faseDaLista(l.externalId)?.fase ?? l.name,
          etapa: s?.name ?? '—', etapaCor: s?.color ?? '#888', createdAt: c.createdAt.toISOString(),
        };
      });
    const reunioes = (
      await Promise.all(
        passos.map(async (p) => (await this.fichas.listar(orgId, p.id)).map((r) => ({ ...r, taskId: p.id, fase: p.fase }))),
      )
    )
      .flat()
      .sort((a, b) => b.em.localeCompare(a.em));
    const empresa = este.values.find((v) => semAcento(v.field.name) === 'empresa')?.value?.trim();
    return { cliente: empresa || este.title.split('|')[0].trim(), passos, reunioes };
  }

  /**
   * Passa o cliente para a próxima fase: cria o cartão na lista de destino, na
   * primeira etapa, copiando os dados do cliente (campos de mesmo nome), o
   * produto e o valor. O cartão de origem fica onde está: é o histórico.
   */
  async passar(orgId: string, taskId: string, destino: ChaveDaJornada): Promise<{ id: string; rota: string }> {
    const listas = await this.listasDaJornada(orgId);
    const alvo = listas.get(destino);
    if (!alvo) throw new BadRequestException('A lista de destino ainda não existe. Rode a carga do CRM (db:seed:crm).');
    const origem = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      include: { list: true, values: { include: { field: true, option: true } } },
    });
    if (!origem) throw new NotFoundException('Ficha não encontrada');
    const primeira = alvo.statuses[0];
    if (!primeira) throw new BadRequestException('A lista de destino não tem etapas.');

    const camposDoAlvo = await this.prisma.workField.findMany({ where: { orgId, listId: alvo.id }, include: { options: true } });
    const valores: { fieldId: string; optionId: string | null; value: string | null }[] = [];
    for (const f of camposDoAlvo) {
      const igual = origem.values.find((v) => semAcento(v.field.name) === semAcento(f.name) && v.field.type === f.type);
      if (igual) {
        if (f.type === 'drop_down') {
          const op = f.options.find((o) => igual.option && semAcento(o.name) === semAcento(igual.option.name));
          if (op) valores.push({ fieldId: f.id, optionId: op.id, value: null });
        } else if (igual.value) valores.push({ fieldId: f.id, optionId: null, value: igual.value });
        continue;
      }
      // O valor da proposta vira o valor do contrato: primeiro campo de moeda para primeiro campo de moeda.
      if (f.type === 'moeda' && !valores.some((v) => camposDoAlvo.find((c) => c.id === v.fieldId)?.type === 'moeda')) {
        const moeda = origem.values.find((v) => v.field.type === 'moeda' && v.value);
        if (moeda) valores.push({ fieldId: f.id, optionId: null, value: moeda.value });
      }
    }
    const fase = faseDaLista(origem.list.externalId)?.fase ?? origem.list.name;
    const novo = await this.prisma.$transaction(async (db) => {
      const t = await db.workTask.create({
        data: {
          orgId, listId: alvo.id, statusId: primeira.id, title: origem.title,
          description: `Veio do ${fase} em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
          assignee: origem.assignee,
        },
      });
      for (const v of valores) await db.workFieldValue.create({ data: { taskId: t.id, ...v } });
      return t;
    });
    return { id: novo.id, rota: `${faseDaLista(destino)!.rota}${novo.id}` };
  }
}
