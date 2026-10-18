import { Injectable } from '@nestjs/common';
import {
  SEM_INFORMACAO,
  type PainelComercial,
  type PainelComercialGrupo,
  type PainelComercialMes,
  type PainelComercialNegocio,
  type ResultadoDaEtapa,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Chave da lista criada por `db:seed:crm`; o nome é o plano B (lista criada à mão no quadro). */
export const LISTA_DO_CRM_EXTERNA = 'crm-root-lista';
export const NOME_DA_LISTA_DO_CRM = 'Gestão de Leads';

const FUSO = 'America/Sao_Paulo';
const DIA = 86_400_000;

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Etapa fechada com nome de venda é ganho; qualquer outra fechada é perda. */
export function resultadoDaEtapa(tipo: string, nome: string): ResultadoDaEtapa {
  if (tipo !== 'closed') return 'aberta';
  return /fechad|ganh|contrat/.test(semAcento(nome)) ? 'ganho' : 'perdido';
}

/** `AAAA-MM` no fuso de Brasília. */
export function mesDe(data: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit' }).formatToParts(data);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

/** "BRL 1500.00" → 1500; qualquer outra coisa → nulo. */
export function lerMoeda(valor: string | null | undefined): number | null {
  const m = /^[A-Z]{3} (-?\d+(?:\.\d+)?)$/.exec(valor ?? '');
  return m ? Number(m[1]) : null;
}

/** Acha o campo da lista pelo nome sem acento; aceita prefixo ("Valor em negocição" com erro de digitação). */
function campo<T extends { name: string }>(campos: T[], ...prefixos: string[]): T | undefined {
  return campos.find((c) => prefixos.some((p) => semAcento(c.name).startsWith(p)));
}

@Injectable()
export class PainelComercialService {
  constructor(private readonly prisma: PrismaService) {}

  async painel(orgId: string, agora = new Date()): Promise<PainelComercial> {
    const ano = Number(mesDe(agora).slice(0, 4));
    const vazio: PainelComercial = {
      lista: null,
      ano,
      geradoEm: agora.toISOString(),
      totais: { emNegociacao: 0, abertos: 0, ganhosNoAno: 0, valorGanhoNoAno: 0, perdidosNoAno: 0, conversao: null, ticketMedio: null },
      etapas: [],
      fechadosPorMes: [],
      entradasPorMes: [],
      canais: [],
      vendedores: [],
      negocios: [],
    };

    const lista =
      (await this.prisma.workList.findFirst({ where: { orgId, externalId: LISTA_DO_CRM_EXTERNA } })) ??
      (await this.prisma.workList.findFirst({ where: { orgId, name: NOME_DA_LISTA_DO_CRM } }));
    if (!lista) return vazio;

    const [statuses, campos, tarefas] = await Promise.all([
      this.prisma.workStatus.findMany({ where: { listId: lista.id }, orderBy: { order: 'asc' } }),
      this.prisma.workField.findMany({ where: { orgId, OR: [{ listId: lista.id }, { listId: null }] }, include: { options: true } }),
      this.prisma.workTask.findMany({
        where: { orgId, listId: lista.id, archived: false, parentId: null },
        include: { values: { include: { option: true } } },
      }),
    ]);

    const fCanal = campo(campos, 'canal');
    const fVendedor = campo(campos, 'vendedor');
    const fValor = campos.find((c) => c.type === 'moeda') ?? campo(campos, 'valor');
    const fCadastro = campo(campos, 'data de cadastro', 'cadastro');
    const fProduto = campo(campos, 'produto');
    const fContato = campo(campos, 'contato');
    const fLink = campo(campos, 'link da proposta', 'proposta');
    const corDaOpcao = new Map<string, string>();
    for (const f of [fCanal, fVendedor]) for (const o of f?.options ?? []) corDaOpcao.set(`${f!.id}:${o.name}`, o.color);

    const etapaPorId = new Map(statuses.map((s) => [s.id, { ...s, resultado: resultadoDaEtapa(s.type, s.name) }]));

    const leads = tarefas.map((t) => {
      const v = (f?: { id: string }) => (f ? t.values.find((x) => x.fieldId === f.id) : undefined);
      const etapa = etapaPorId.get(t.statusId)!;
      const cadastro = v(fCadastro)?.value;
      const entrada = cadastro && /^\d{4}-\d{2}/.test(cadastro) ? cadastro.slice(0, 7) : mesDe(t.createdAt);
      return {
        t,
        etapa,
        valor: lerMoeda(v(fValor)?.value),
        canal: v(fCanal)?.option?.name ?? null,
        produto: v(fProduto)?.option?.name ?? v(fProduto)?.value ?? null,
        contato: v(fContato)?.value ?? null,
        linkProposta: v(fLink)?.value ?? null,
        vendedor: v(fVendedor)?.option?.name ?? t.assignee ?? null,
        entrada,
        // Quando foi para a etapa fechada: o banco carimba `statusDesde` em toda troca de etapa.
        fechadoEm: etapa.resultado !== 'aberta' && t.statusDesde ? mesDe(t.statusDesde) : null,
      };
    });

    const abertos = leads.filter((l) => l.etapa.resultado === 'aberta');
    const doAno = (mes: string | null) => !!mes && mes.startsWith(`${ano}-`);
    const ganhosAno = leads.filter((l) => l.etapa.resultado === 'ganho' && doAno(l.fechadoEm));
    const perdidosAno = leads.filter((l) => l.etapa.resultado === 'perdido' && doAno(l.fechadoEm));
    const soma = (xs: { valor: number | null }[]) => xs.reduce((s, x) => s + (x.valor ?? 0), 0);
    const valorGanhoNoAno = soma(ganhosAno);
    const fechamentos = ganhosAno.length + perdidosAno.length;

    const meses = (n: number, ate: string): string[] => {
      const [a, m] = ate.split('-').map(Number);
      return Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      });
    };
    const porMes = (lista: string[], itens: { mes: string | null; valor: number | null }[]): PainelComercialMes[] =>
      lista.map((mes) => {
        const doMes = itens.filter((x) => x.mes === mes);
        return { mes, qtd: doMes.length, valor: soma(doMes) };
      });

    const agrupar = (chave: (l: (typeof leads)[number]) => string | null, fCor?: { id: string }): PainelComercialGrupo[] => {
      const grupos = new Map<string, typeof leads>();
      for (const l of leads) {
        const k = chave(l) ?? SEM_INFORMACAO;
        grupos.set(k, [...(grupos.get(k) ?? []), l]);
      }
      return [...grupos.entries()]
        .map(([nome, ls]) => {
          const ab = ls.filter((l) => l.etapa.resultado === 'aberta');
          const gs = ls.filter((l) => l.etapa.resultado === 'ganho');
          return {
            nome,
            cor: fCor ? corDaOpcao.get(`${fCor.id}:${nome}`) ?? null : null,
            leads: ls.length,
            abertos: ab.length,
            emNegociacao: soma(ab),
            ganhos: gs.length,
            valorGanho: soma(gs),
          };
        })
        .sort((a, b) => b.leads - a.leads || b.valorGanho - a.valorGanho);
    };

    const negocios: PainelComercialNegocio[] = leads
      .map((l) => ({
        id: l.t.id,
        titulo: l.t.title,
        statusId: l.t.statusId,
        etapa: l.etapa.name,
        etapaCor: l.etapa.color,
        resultado: l.etapa.resultado,
        valor: l.valor,
        vendedor: l.vendedor,
        canal: l.canal,
        produto: l.produto,
        contato: l.contato,
        linkProposta: l.linkProposta,
        atualizadoEm: l.t.updatedAt.toISOString(),
        mesEntrada: l.entrada,
        mesFechado: l.fechadoEm,
        diasNaEtapa: l.t.statusDesde ? Math.floor((agora.getTime() - l.t.statusDesde.getTime()) / DIA) : null,
      }))
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));

    return {
      lista: { id: lista.id, nome: lista.name },
      ano,
      geradoEm: agora.toISOString(),
      totais: {
        emNegociacao: soma(abertos),
        abertos: abertos.length,
        ganhosNoAno: ganhosAno.length,
        valorGanhoNoAno,
        perdidosNoAno: perdidosAno.length,
        conversao: fechamentos ? Math.round((ganhosAno.length / fechamentos) * 100) : null,
        ticketMedio: ganhosAno.length ? valorGanhoNoAno / ganhosAno.length : null,
      },
      etapas: statuses.map((s) => {
        const ls = leads.filter((l) => l.t.statusId === s.id);
        return { id: s.id, nome: s.name, cor: s.color, resultado: etapaPorId.get(s.id)!.resultado, qtd: ls.length, valor: soma(ls) };
      }),
      fechadosPorMes: porMes(
        meses(12, `${ano}-12`),
        leads.filter((l) => l.etapa.resultado === 'ganho').map((l) => ({ mes: l.fechadoEm, valor: l.valor })),
      ),
      entradasPorMes: porMes(meses(12, mesDe(agora)), leads.map((l) => ({ mes: l.entrada, valor: l.valor }))),
      canais: agrupar((l) => l.canal, fCanal),
      vendedores: agrupar((l) => l.vendedor, fVendedor),
      negocios,
    };
  }
}
