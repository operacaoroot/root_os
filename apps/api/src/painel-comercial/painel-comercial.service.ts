import { Injectable } from '@nestjs/common';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  ROTULO_DO_CANAL_DE_ENTRADA,
  SEM_INFORMACAO,
  TABELA_DE_PRECO,
  resultadoDaEtapaDoCockpit,
  type ComercialEtapa,
  type ComercialProduto,
  type LinhaDaListaDeLeads,
  type ListaDeLeads,
  type PainelComercial,
  type PainelComercialGrupo,
  type PainelComercialMes,
  type PainelComercialNegocio,
  type ResultadoDaEtapa,
  tipoDeNegocio,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

/*
 * O PAINEL GERAL DO COMERCIAL (versão final, 19/10/2026): o desenho do Lucas
 * lendo os dados do cockpit.
 *
 *   · negócio = um `Lead` da empresa, com a etapa da `ComercialFicha` (lead sem
 *     ficha está em E1, como o `FichaService.garantir` o criaria);
 *   · valor = o valor da proposta da ficha; produto = o produto da ficha;
 *     canal = o canal de entrada da ficha ou, sem ele, a origem do lead;
 *     vendedor = o dono da ficha ou, sem ele, o dono do lead;
 *   · fechou = o fato `cliente.ativo` (a data dele) ou a etapa E9 (a data em
 *     que entrou nela); perdeu = a saída (a data em que saiu);
 *   · cliente ativo e contrato vivo = `cliente.ativo` sem `contrato.concluido`
 *     nem `contrato.desativado` depois.
 * Nada é estimado: sem valor, o negócio entra na contagem e fica fora da soma.
 */

const FUSO = 'America/Sao_Paulo';
const DIA = 86_400_000;
/** Teto de leads lidos de uma vez (o Funil vivo tem o dele; aqui é a conta do ano). */
export const TETO_DO_PAINEL = 5000;

/** A cor de cada resultado (um acento só, como o desenho do Lucas). */
const COR_DO_RESULTADO: Record<ResultadoDaEtapa, string> = {
  ganho: 'rgb(var(--os-ac))',
  aberta: 'rgb(var(--os-ac) / 0.45)',
  pausa: 'rgb(var(--os-tx2) / 0.45)',
  perdido: 'rgb(var(--os-tx2) / 0.3)',
};

/** `AAAA-MM` no fuso de Brasília. */
export function mesDe(data: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit' }).formatToParts(data);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

function meses(n: number, ate: string): string[] {
  const [a, m] = ate.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function rotuloDoCanal(canal: string | null | undefined): string | null {
  if (!canal) return null;
  return ROTULO_DO_CANAL_DE_ENTRADA[canal] ?? canal;
}

export function rotuloDoProduto(produto: string | null | undefined): string | null {
  if (!produto) return null;
  return TABELA_DE_PRECO[produto as ComercialProduto]?.rotulo ?? produto;
}

@Injectable()
export class PainelComercialService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * INTEGRAÇÃO (26/10/2026): quem é cliente pelos acordos do Financeiro, por tipo.
   * Um cliente conta uma vez: pelo cadastro do Financeiro (o principal, quando há
   * duplicado) ou, no acordo ainda não ligado, pelo nome escrito. Só lê.
   */
  /**
   * Layout 26/10/2026: "Contratos fechados por mês" pelos ACORDOS do Financeiro (os mesmos
   * de "Clientes ativos" e da Análise), pelo mês em que cada um fechou (`fechadoEm`). Valor
   * = pagante + sem caixa; `valorSemCaixa` separa parceria, permuta e repasse. Enquanto
   * nenhum acordo tiver data, fica o cálculo antigo (quem fechou no funil).
   */
  private async fechadosPorMes(orgId: string, ano: number, tudo: boolean, antigo: PainelComercialMes[]): Promise<PainelComercialMes[]> {
    const acordos = await this.prisma.acordoComercial.findMany({
      where: { orgId, ...(tudo ? {} : { tipo: 'pagante' }), fechadoEm: { gte: new Date(`${ano}-01-01T00:00:00.000Z`), lt: new Date(`${ano + 1}-01-01T00:00:00.000Z`) } },
      select: { fechadoEm: true, tipo: true, valor: true },
    });
    if (!acordos.length) return antigo;
    return antigo.map(({ mes }) => {
      const doMes = acordos.filter((a) => a.fechadoEm!.toISOString().slice(0, 7) === mes);
      const valor = doMes.reduce((s, a) => s + Number(a.valor), 0);
      const semCaixa = doMes.filter((a) => a.tipo !== 'pagante').reduce((s, a) => s + Number(a.valor), 0);
      return { mes, qtd: doMes.length, valor, valorSemCaixa: semCaixa };
    });
  }

  private async clientesPorAcordo(orgId: string, tudo = true): Promise<{ total: number; porTipo: { tipo: string; clientes: string[] }[] }> {
    const acordos = await this.prisma.acordoComercial.findMany({
      where: { orgId, ...(tudo ? {} : { tipo: 'pagante' }) },
      select: {
        cliente: true, tipo: true, partnerId: true,
        partner: { select: { principalId: true, razaoSocial: true, nomeFantasia: true, principal: { select: { razaoSocial: true, nomeFantasia: true } } } },
      },
    });
    const ORDEM = ['pagante', 'parceria', 'permuta', 'repasse'];
    const porTipo = new Map<string, Map<string, string>>();
    const todos = new Set<string>();
    for (const a of acordos) {
      const p = a.partner;
      const chave = p ? (p.principalId ?? a.partnerId!) : `nome:${a.cliente.trim().toLowerCase()}`;
      const nome = p ? (p.principal?.nomeFantasia || p.principal?.razaoSocial || p.nomeFantasia || p.razaoSocial) : a.cliente.trim();
      const tipo = (a.tipo || 'outro').toLowerCase();
      if (!porTipo.has(tipo)) porTipo.set(tipo, new Map());
      porTipo.get(tipo)!.set(chave, nome);
      todos.add(chave);
    }
    const tipos = [...porTipo.keys()].sort((x, y) => (ORDEM.indexOf(x) + 1 || 99) - (ORDEM.indexOf(y) + 1 || 99));
    return { total: todos.size, porTipo: tipos.map((t) => ({ tipo: t, clientes: [...porTipo.get(t)!.values()].sort((a, b) => a.localeCompare(b, 'pt')) })) };
  }

  /** Layout 26/10 (Lucas): `tudo` = false conta só os negócios pagantes; true conta também parceria, permuta e repasse. */
  async painel(orgId: string, agora = new Date(), tudo = false): Promise<PainelComercial> {
    const ano = Number(mesDe(agora).slice(0, 4));

    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.findMany({
        where: { orgId },
        orderBy: { enteredAt: 'desc' },
        take: TETO_DO_PAINEL,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          ownerId: true,
          enteredAt: true,
          updatedAt: true,
          source: { select: { name: true } },
          ficha: {
            select: {
              etapa: true,
              etapaDesde: true,
              empresa: true,
              canal: true,
              donoId: true,
              produto: true,
              valorCentavos: true,
              valorNegociadoCentavos: true,
              vendedorId: true,
              tipoNegocio: true,
              clienteAtivoEm: true,
              atualizadoEm: true,
            },
          },
        },
      }),
    ]);
    const ids = leads.map((l) => l.id);

    const [fatos, donos] = await Promise.all([
      ids.length
        ? this.prisma.leadEvent.findMany({
            where: { orgId, leadId: { in: ids }, type: { in: ['cliente.ativo', 'contrato.concluido', 'contrato.desativado'] } },
            select: { leadId: true, type: true, occurredAt: true },
            orderBy: { occurredAt: 'asc' },
          })
        : Promise.resolve([]),
      (async () => {
        const quem = [...new Set(leads.flatMap((l) => [l.ficha?.donoId, l.ownerId, l.ficha?.vendedorId]).filter((x): x is string => !!x))];
        // A empresa vai no filtro: o dono se resolve na empresa da sessão, nunca por relação.
        return quem.length ? this.prisma.user.findMany({ where: { orgId, id: { in: quem } }, select: { id: true, name: true } }) : [];
      })(),
    ]);
    const nomeDoDono = new Map(donos.map((u) => [u.id, u.name]));
    const ativoEm = new Map<string, Date>();
    const encerradoEm = new Map<string, Date>();
    for (const f of fatos) {
      if (f.type === 'cliente.ativo') {
        if (!ativoEm.has(f.leadId)) ativoEm.set(f.leadId, f.occurredAt);
      } else encerradoEm.set(f.leadId, f.occurredAt);
    }

    const todosOsCards = leads.map((l) => {
      const etapa = (l.ficha?.etapa ?? 'novo_lead') as ComercialEtapa;
      const etapaDesde = l.ficha?.etapaDesde ?? l.enteredAt;
      let resultado = resultadoDaEtapaDoCockpit(etapa);
      // O fato `cliente.ativo` é o fechamento, esteja a ficha onde estiver.
      const fechouEm = ativoEm.get(l.id) ?? (etapa === 'fechado' ? l.ficha?.clienteAtivoEm ?? etapaDesde : null);
      if (fechouEm && resultado !== 'ganho') resultado = 'ganho';
      const fim = encerradoEm.get(l.id);
      const clienteAtivo = !!fechouEm && !(fim && fim >= fechouEm);
      const contratoVivo = ativoEm.has(l.id) && clienteAtivo;
      // Layout 26/10: o valor negociado vale mais que o da proposta, quando existe.
      const centavos = l.ficha?.valorNegociadoCentavos ?? l.ficha?.valorCentavos;
      const valor = centavos != null ? centavos / 100 : null;
      const perdidoEm = resultado === 'perdido' ? etapaDesde : null;
      return {
        l,
        etapa,
        etapaDesde,
        resultado,
        valor,
        fechouEm,
        perdidoEm,
        clienteAtivo,
        contratoVivo,
        canal: rotuloDoCanal(l.ficha?.canal) ?? l.source?.name ?? null,
        // Layout 26/10: vendedor é quem VENDEU (campo próprio), não o dono do lead.
        vendedor: nomeDoDono.get(l.ficha?.vendedorId ?? '') ?? null,
        produto: rotuloDoProduto(l.ficha?.produto),
        entrada: mesDe(l.enteredAt),
        tipoNegocio: tipoDeNegocio(l.ficha?.tipoNegocio),
      };
    });
    // Layout 26/10: o botão do Painel geral. Desligado: só pagantes (o que vira caixa); ligado: tudo.
    const cards = tudo ? todosOsCards : todosOsCards.filter((c) => c.tipoNegocio === 'pagante');

    const doAno = (d: Date | null) => !!d && mesDe(d).startsWith(`${ano}-`);
    const soma = (xs: { valor: number | null }[]) => xs.reduce((s, x) => s + (x.valor ?? 0), 0);
    const abertos = cards.filter((c) => c.resultado === 'aberta');
    const ganhosAno = cards.filter((c) => c.resultado === 'ganho' && doAno(c.fechouEm));
    const perdidosAno = cards.filter((c) => c.resultado === 'perdido' && doAno(c.perdidoEm));
    const ganhosComValor = ganhosAno.filter((c) => c.valor != null);
    const valorGanhoNoAno = soma(ganhosAno);
    // Layout 26/10 (Lucas): o que veio pro bolso = só os negócios pagantes; parceria, permuta e repasse ficam no total geral.
    const ganhosPagantesAno = ganhosAno.filter((c) => c.tipoNegocio === 'pagante');
    const fechamentos = ganhosAno.length + perdidosAno.length;

    const porMes = (lista: string[], itens: { mes: string | null; valor: number | null }[]): PainelComercialMes[] =>
      lista.map((mes) => {
        const doMes = itens.filter((x) => x.mes === mes);
        return { mes, qtd: doMes.length, valor: soma(doMes) };
      });

    const agrupar = (chave: (c: (typeof cards)[number]) => string | null): PainelComercialGrupo[] => {
      const grupos = new Map<string, typeof cards>();
      for (const c of cards) {
        const k = chave(c) ?? SEM_INFORMACAO;
        grupos.set(k, [...(grupos.get(k) ?? []), c]);
      }
      return [...grupos.entries()]
        .map(([nome, cs]) => {
          const ab = cs.filter((c) => c.resultado === 'aberta');
          const gs = cs.filter((c) => c.resultado === 'ganho');
          return { nome, cor: null, leads: cs.length, abertos: ab.length, emNegociacao: soma(ab), ganhos: gs.length, valorGanho: soma(gs) };
        })
        .sort((a, b) => b.leads - a.leads || b.valorGanho - a.valorGanho);
    };

    const negocios: PainelComercialNegocio[] = cards
      .map((c) => {
        const mesFechado = c.fechouEm ? mesDe(c.fechouEm) : c.perdidoEm ? mesDe(c.perdidoEm) : null;
        return {
          id: c.l.id,
          titulo: c.l.ficha?.empresa || c.l.name,
          nome: c.l.name,
          etapaChave: c.etapa,
          etapa: COMERCIAL_ROTULO_DA_ETAPA[c.etapa],
          etapaCor: COR_DO_RESULTADO[c.resultado],
          resultado: c.resultado,
          valor: c.valor,
          vendedor: c.vendedor,
          canal: c.canal,
          produto: c.produto,
          contato: c.l.phone ?? c.l.email ?? null,
          atualizadoEm: (c.l.ficha?.atualizadoEm ?? c.l.updatedAt).toISOString(),
          mesEntrada: c.entrada,
          mesFechado,
          mesesFechados: c.fechouEm ? [mesDe(c.fechouEm)] : [],
          diasNaEtapa: Math.max(0, Math.floor((agora.getTime() - c.etapaDesde.getTime()) / DIA)),
          clienteAtivo: c.clienteAtivo,
        };
      })
      .sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1) || a.titulo.localeCompare(b.titulo, 'pt'));

    // O funil geral: as nove etapas, na ordem do cockpit, e as quatro saídas.
    const etapas = [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS].map((e) => {
      const cs = cards.filter((c) => c.etapa === e);
      const resultado = resultadoDaEtapaDoCockpit(e);
      return { id: e, nome: COMERCIAL_ROTULO_DA_ETAPA[e], cor: COR_DO_RESULTADO[resultado], resultado, qtd: cs.length, valor: soma(cs) };
    });

    return {
      ano,
      geradoEm: agora.toISOString(),
      totais: {
        emNegociacao: soma(abertos),
        // Layout 26/10: a negociação separada entre o que gera caixa (pagante) e o que não gera.
        emNegociacaoPagante: soma(abertos.filter((c) => c.tipoNegocio === 'pagante')),
        emNegociacaoSemCaixa: soma(todosOsCards.filter((c) => c.resultado === 'aberta' && c.tipoNegocio !== 'pagante')),
        abertos: abertos.length,
        ganhosNoAno: ganhosAno.length,
        valorGanhoNoAno,
        ganhosPagantesNoAno: ganhosPagantesAno.length,
        valorGanhoPaganteNoAno: soma(ganhosPagantesAno),
        perdidosNoAno: perdidosAno.length,
        naGeladeira: cards.filter((c) => c.resultado === 'pausa').length,
        conversao: fechamentos ? Math.round((ganhosAno.length / fechamentos) * 100) : null,
        ticketMedio: ganhosComValor.length ? soma(ganhosComValor) / ganhosComValor.length : null,
        ganhosSemValor: ganhosAno.length - ganhosComValor.length,
        clientesAtivos: cards.filter((c) => c.clienteAtivo).length,
        contratosVivos: cards.filter((c) => c.contratoVivo).length,
        clientesPorAcordo: await this.clientesPorAcordo(orgId, tudo),
      },
      etapas,
      fechadosPorMes: await this.fechadosPorMes(orgId, ano, tudo, porMes(
        meses(12, `${ano}-12`),
        cards.filter((c) => c.fechouEm).map((c) => ({ mes: mesDe(c.fechouEm!), valor: c.valor })),
      )),
      entradasPorMes: porMes(meses(12, mesDe(agora)), cards.map((c) => ({ mes: c.entrada, valor: c.valor }))),
      canais: agrupar((c) => c.canal),
      vendedores: agrupar((c) => c.vendedor),
      negocios,
      foraDoTeto: Math.max(0, total - leads.length),
    };
  }

  /**
   * A Lista de leads: a tabela `Lead` da empresa com a ficha (etapa, empresa,
   * canal, dono) e a última atividade (o último fato do fio ou a última
   * mudança da ficha). Lead sem ficha está em E1.
   */
  async listaDeLeads(orgId: string): Promise<ListaDeLeads> {
    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.findMany({
        where: { orgId },
        orderBy: { updatedAt: 'desc' },
        take: TETO_DO_PAINEL,
        select: {
          id: true, name: true, email: true, phone: true, ownerId: true, enteredAt: true, updatedAt: true,
          source: { select: { name: true } },
          ficha: { select: { etapa: true, empresa: true, canal: true, donoId: true, atualizadoEm: true, valorCentavos: true, valorNegociadoCentavos: true } },
        },
      }),
    ]);
    const ids = leads.map((l) => l.id);
    const [ultimos, donos] = await Promise.all([
      ids.length
        ? this.prisma.leadEvent.groupBy({ by: ['leadId'], where: { orgId, leadId: { in: ids } }, _max: { occurredAt: true } })
        : Promise.resolve([] as { leadId: string; _max: { occurredAt: Date | null } }[]),
      (async () => {
        const quem = [...new Set(leads.flatMap((l) => [l.ficha?.donoId, l.ownerId]).filter((x): x is string => !!x))];
        return quem.length ? this.prisma.user.findMany({ where: { orgId, id: { in: quem } }, select: { id: true, name: true } }) : [];
      })(),
    ]);
    const ultimoDe = new Map(ultimos.map((u) => [u.leadId, u._max.occurredAt]));
    const nomeDoDono = new Map(donos.map((u) => [u.id, u.name]));
    const linhas: LinhaDaListaDeLeads[] = leads.map((l) => {
      const etapa = (l.ficha?.etapa ?? 'novo_lead') as ComercialEtapa;
      const datas = [ultimoDe.get(l.id), l.ficha?.atualizadoEm, l.updatedAt].filter((d): d is Date => !!d);
      const ultima = datas.sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: l.id,
        contato: l.name,
        empresa: l.ficha?.empresa ?? null,
        telefone: l.phone,
        email: l.email,
        etapaChave: etapa,
        etapa: COMERCIAL_ROTULO_DA_ETAPA[etapa],
        canal: rotuloDoCanal(l.ficha?.canal) ?? l.source?.name ?? null,
        dono: nomeDoDono.get(l.ficha?.donoId ?? '') ?? nomeDoDono.get(l.ownerId ?? '') ?? null,
        entrouEm: l.enteredAt.toISOString(),
        // Layout 26/10 (P-33): o valor da ficha, o mesmo do Painel e de Negócios.
        valor: (l.ficha?.valorNegociadoCentavos ?? l.ficha?.valorCentavos) != null ? (l.ficha!.valorNegociadoCentavos ?? l.ficha!.valorCentavos)! / 100 : null,
        ultimaAtividade: ultima.toISOString(),
      };
    });
    linhas.sort((a, b) => b.ultimaAtividade.localeCompare(a.ultimaAtividade));
    return { leads: linhas, foraDoTeto: Math.max(0, total - leads.length) };
  }
}
