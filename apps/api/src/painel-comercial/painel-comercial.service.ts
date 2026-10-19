import { Injectable } from '@nestjs/common';
import {
  SEM_INFORMACAO,
  ehSaida,
  faseDaEtapa,
  type ContratoDoCliente,
  type PainelComercial,
  type PainelComercialGrupo,
  type PainelComercialMes,
  type PainelComercialNegocio,
  type ResultadoDaEtapa,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ContratosDoClienteService } from '../ficha/contratos-do-cliente.service';

/** Chave da lista criada por `db:seed:crm`; o nome é o plano B (lista criada à mão no quadro). */
export const LISTA_DO_CRM_EXTERNA = 'crm-root-lista';
export const NOME_DA_LISTA_DO_CRM = 'Gestão de Leads';
/** A coluna "Negócio fechado" do Painel geral: junta quem fechou, esteja onde estiver na operação do cliente. */
export const ETAPA_CLIENTES = '__clientes';

const FUSO = 'America/Sao_Paulo';
const DIA = 86_400_000;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * O resultado do card pela etapa (um card por lead/cliente): na fase
 * comercial está em negociação; Perdido e Desqualificado são perda; qualquer
 * etapa de onboarding ou sucesso (inclusive Cancelado e Encerrado) quer dizer
 * que ele fechou.
 */
export function resultadoDaEtapa(nome: string): ResultadoDaEtapa {
  if (faseDaEtapa(nome) !== 'comercial') return 'ganho';
  return ehSaida(nome) ? 'perdido' : 'aberta';
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

/** Acha o campo da lista pelo nome sem acento; aceita prefixo. */
function campo<T extends { name: string }>(campos: T[], ...prefixos: string[]): T | undefined {
  return campos.find((c) => prefixos.some((p) => semAcento(c.name).startsWith(p)));
}

@Injectable()
export class PainelComercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratos: ContratosDoClienteService,
  ) {}

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
    const contratosPorCard = await this.contratos.porCliente(orgId, tarefas.map((t) => t.id));

    const fCanal = campo(campos, 'canal');
    const fVendedor = campo(campos, 'vendedor');
    // O valor da proposta, não o recorrente (mês): a lista tem os dois campos de moeda.
    const fValor = campo(campos, 'valor da proposta') ?? campos.find((c) => c.type === 'moeda');
    const fCadastro = campo(campos, 'data de cadastro', 'cadastro');
    const fProduto = campo(campos, 'produto');
    const fContato = campo(campos, 'contato');
    const fLink = campo(campos, 'link da proposta');
    const corDaOpcao = new Map<string, string>();
    for (const f of [fCanal, fVendedor]) for (const o of f?.options ?? []) corDaOpcao.set(`${f!.id}:${o.name}`, o.color);

    const etapaPorId = new Map(statuses.map((s) => [s.id, { ...s, resultado: resultadoDaEtapa(s.name), fase: faseDaEtapa(s.name) }]));

    const cards = tarefas.map((t) => {
      const v = (f?: { id: string }) => (f ? t.values.find((x) => x.fieldId === f.id) : undefined);
      const etapa = etapaPorId.get(t.statusId)!;
      const cadastro = v(fCadastro)?.value;
      const entrada = cadastro && /^\d{4}-\d{2}/.test(cadastro) ? cadastro.slice(0, 7) : mesDe(t.createdAt);
      const valor = lerMoeda(v(fValor)?.value);
      // Cliente sem contrato registrado conta como um contrato, com o valor da proposta,
      // fechado quando o card chegou na etapa (o banco carimba `statusDesde` em toda troca).
      let contratos: ContratoDoCliente[] = contratosPorCard.get(t.id) ?? [];
      if (etapa.resultado === 'ganho' && !contratos.length) {
        contratos = [{ id: t.id, titulo: v(fProduto)?.option?.name ?? 'Contrato', valor: valor ?? 0, fechadoEm: (t.statusDesde ?? t.updatedAt).toISOString().slice(0, 10) }];
      }
      if (etapa.resultado !== 'ganho') contratos = [];
      return {
        t,
        etapa,
        valor,
        contratos,
        valorContratos: contratos.reduce((s, k) => s + k.valor, 0),
        canal: v(fCanal)?.option?.name ?? null,
        produto: v(fProduto)?.option?.name ?? v(fProduto)?.value ?? null,
        contato: v(fContato)?.value ?? null,
        linkProposta: v(fLink)?.value ?? null,
        vendedor: v(fVendedor)?.option?.name ?? t.assignee ?? null,
        entrada,
        perdidoEm: etapa.resultado === 'perdido' && t.statusDesde ? mesDe(t.statusDesde) : null,
      };
    });

    const doAno = (dia: string | null) => !!dia && dia.startsWith(`${ano}-`);
    const abertos = cards.filter((c) => c.etapa.resultado === 'aberta');
    const contratosDoAno = cards.flatMap((c) => c.contratos.filter((k) => doAno(k.fechadoEm)));
    const clientesDoAno = cards.filter((c) => c.contratos.some((k) => doAno(k.fechadoEm)));
    const perdidosAno = cards.filter((c) => doAno(c.perdidoEm));
    const somaValor = (xs: { valor: number | null }[]) => xs.reduce((s, x) => s + (x.valor ?? 0), 0);
    const valorGanhoNoAno = somaValor(contratosDoAno);
    const fechamentos = clientesDoAno.length + perdidosAno.length;

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
        return { mes, qtd: doMes.length, valor: somaValor(doMes) };
      });

    const agrupar = (chave: (c: (typeof cards)[number]) => string | null, fCor?: { id: string }): PainelComercialGrupo[] => {
      const grupos = new Map<string, typeof cards>();
      for (const c of cards) {
        const k = chave(c) ?? SEM_INFORMACAO;
        grupos.set(k, [...(grupos.get(k) ?? []), c]);
      }
      return [...grupos.entries()]
        .map(([nome, cs]) => {
          const ab = cs.filter((c) => c.etapa.resultado === 'aberta');
          const gs = cs.filter((c) => c.etapa.resultado === 'ganho');
          return {
            nome,
            cor: fCor ? corDaOpcao.get(`${fCor.id}:${nome}`) ?? null : null,
            leads: cs.length,
            abertos: ab.length,
            emNegociacao: somaValor(ab),
            ganhos: gs.length,
            valorGanho: gs.reduce((s, c) => s + c.valorContratos, 0),
          };
        })
        .sort((a, b) => b.leads - a.leads || b.valorGanho - a.valorGanho);
    };

    const negocios: PainelComercialNegocio[] = cards
      .map((c) => {
        const mesesFechados = [...new Set(c.contratos.map((k) => k.fechadoEm.slice(0, 7)))];
        return {
          id: c.t.id,
          titulo: c.t.title,
          statusId: c.t.statusId,
          etapa: c.etapa.name,
          etapaCor: c.etapa.color,
          fase: c.etapa.fase,
          resultado: c.etapa.resultado,
          valor: c.etapa.resultado === 'ganho' ? c.valorContratos : c.valor,
          vendedor: c.vendedor,
          canal: c.canal,
          produto: c.produto,
          contato: c.contato,
          linkProposta: c.linkProposta,
          atualizadoEm: c.t.updatedAt.toISOString(),
          mesEntrada: c.entrada,
          mesFechado: mesesFechados.at(-1) ?? c.perdidoEm,
          mesesFechados,
          diasNaEtapa: c.t.statusDesde ? Math.floor((agora.getTime() - c.t.statusDesde.getTime()) / DIA) : null,
        };
      })
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));

    // Funil do painel: as etapas comerciais, uma coluna "Clientes" com quem já fechou
    // (onboarding e sucesso juntos) e as saídas comerciais.
    const clientes = cards.filter((c) => c.etapa.resultado === 'ganho');
    const etapa = (s: (typeof statuses)[number]) => {
      const cs = cards.filter((c) => c.t.statusId === s.id);
      return { id: s.id, nome: s.name, cor: s.color, resultado: etapaPorId.get(s.id)!.resultado, qtd: cs.length, valor: somaValor(cs) };
    };
    const comerciais = statuses.filter((s) => faseDaEtapa(s.name) === 'comercial');
    const etapas = [
      ...comerciais.filter((s) => !ehSaida(s.name)).map(etapa),
      { id: ETAPA_CLIENTES, nome: 'Negócio fechado', cor: '#008844', resultado: 'ganho' as const, qtd: clientes.length, valor: clientes.reduce((s, c) => s + c.valorContratos, 0) },
      ...comerciais.filter((s) => ehSaida(s.name)).map(etapa),
    ];

    return {
      lista: { id: lista.id, nome: lista.name },
      ano,
      geradoEm: agora.toISOString(),
      totais: {
        emNegociacao: somaValor(abertos),
        abertos: abertos.length,
        ganhosNoAno: contratosDoAno.length,
        valorGanhoNoAno,
        perdidosNoAno: perdidosAno.length,
        conversao: fechamentos ? Math.round((clientesDoAno.length / fechamentos) * 100) : null,
        ticketMedio: contratosDoAno.length ? valorGanhoNoAno / contratosDoAno.length : null,
      },
      etapas,
      fechadosPorMes: porMes(
        meses(12, `${ano}-12`),
        cards.flatMap((c) => c.contratos.map((k) => ({ mes: k.fechadoEm.slice(0, 7), valor: k.valor }))),
      ),
      entradasPorMes: porMes(meses(12, mesDe(agora)), cards.map((c) => ({ mes: c.entrada, valor: c.valor }))),
      canais: agrupar((c) => c.canal, fCanal),
      vendedores: agrupar((c) => c.vendedor, fVendedor),
      negocios,
    };
  }
}
