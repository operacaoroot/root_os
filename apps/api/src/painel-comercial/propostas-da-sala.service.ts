import { Injectable, NotFoundException } from '@nestjs/common';
import {
  COMERCIAL_FATOS_DA_PRIMEIRA_PAGA,
  COMERCIAL_ROTULO_DA_ETAPA,
  PROPOSTA_BLOCOS_DA_SECAO,
  PROPOSTA_ROTULO_DA_SECAO,
  PROPOSTA_SECOES,
  type AnotacaoDoLead,
  type ComercialEtapa,
  type DetalheDaPropostaDaSala,
  type EtapaDaPropostaLida,
  type PropostaDaSalaNaLista,
  type PropostaSecao,
  type PropostasDaSala,
  type TempoDaSecao,
  type VisitaDaSala,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { rotuloDoProduto } from './painel-comercial.service';

/*
 * AS PROPOSTAS DA SALA NA TELA DE PROPOSTAS (versão final, decisão 1).
 *
 * Uma linha por lead: a ÚLTIMA versão publicada (`proposta.publicada`). Tudo
 * é contagem do que já está gravado pelo cockpit, sem nada novo no banco:
 *   · abriu = alguma visita com leitura desta versão (a batida por seção da
 *     página da proposta, `LeadReacao` `leitura`, ou o `proposta.lida` da sala
 *     de antes, com o número da visita);
 *   · leu o investimento = leitura da seção `investimento` (ou o bloco `custos`);
 *   · aceitou = `proposta.aceita` depois da publicação;
 *   · paga = o primeiro fato de pagamento (Pix, boleto ou cartão).
 * A empresa vem da sessão e vai em toda consulta. O texto de dúvida e ideia já
 * foi mascarado na gravação (`varrerSegredos`) e aqui só é lido, nunca vai a
 * modelo. O link da sala NÃO sai daqui: abrir a página do cliente pela equipe
 * contaria como visita dele.
 */

/** Teto de propostas lidas de uma vez (as publicadas por último primeiro). */
export const TETO_DE_PROPOSTAS = 300;

type P = Record<string, unknown>;

const ETAPA_POR_BLOCO = new Map<string, PropostaSecao>(
  PROPOSTA_SECOES.flatMap((s) => PROPOSTA_BLOCOS_DA_SECAO[s].map((b) => [b, s] as [string, PropostaSecao])),
);

/** "O QUE VAMOS MONTAR" → "O que vamos montar". */
export function nomeDaSecao(secao: PropostaSecao): string {
  const r = PROPOSTA_ROTULO_DA_SECAO[secao].toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
}

const FRASE_DA_ETAPA: Record<EtapaDaPropostaLida, string> = {
  0: 'Ainda não abriu',
  1: 'Abriu',
  2: 'Leu o investimento',
  3: 'Aceita',
};

interface Base {
  leadId: string;
  versao: number;
  publicadaEm: Date;
  produto: string | null;
  valorCentavos: number | null;
}

@Injectable()
export class PropostasDaSalaService {
  constructor(private readonly prisma: PrismaService) {}

  /** As propostas publicadas da empresa, da publicada por último para a mais antiga. */
  async lista(orgId: string): Promise<PropostasDaSala> {
    const bases = await this.publicadas(orgId);
    const usadas = bases.slice(0, TETO_DE_PROPOSTAS);
    const linhas = await this.montar(orgId, usadas);
    return { propostas: linhas.map((l) => l.linha), foraDoTeto: bases.length - usadas.length };
  }

  /** O detalhe de uma proposta: tempo por seção, visitas, reações. 404 sem proposta publicada. */
  async detalhe(orgId: string, leadId: string): Promise<DetalheDaPropostaDaSala> {
    const base = (await this.publicadas(orgId, leadId))[0];
    if (!base) throw new NotFoundException('Este lead não tem proposta publicada.');
    const [m] = await this.montar(orgId, [base]);
    const { linha, leituras, lidas, reacoes } = m;

    const porSecao = new Map<PropostaSecao, { segundos: number; visitas: Set<number> }>();
    const porVisita = new Map<number, { quando: Date; segundos: number; secoes: Set<PropostaSecao> }>();
    const visita = (acesso: number, quando: Date) => {
      const v = porVisita.get(acesso) ?? { quando, segundos: 0, secoes: new Set<PropostaSecao>() };
      if (quando > v.quando) v.quando = quando;
      porVisita.set(acesso, v);
      return v;
    };
    for (const r of leituras) {
      const s = r.secao as PropostaSecao;
      const x = porSecao.get(s) ?? { segundos: 0, visitas: new Set<number>() };
      x.segundos += r.segundos ?? 0;
      x.visitas.add(r.acesso);
      porSecao.set(s, x);
      const v = visita(r.acesso, r.atualizadoEm);
      v.segundos += r.segundos ?? 0;
      v.secoes.add(s);
    }
    for (const l of lidas) {
      if (l.secao) {
        const x = porSecao.get(l.secao) ?? { segundos: 0, visitas: new Set<number>() };
        x.visitas.add(l.visita);
        porSecao.set(l.secao, x);
        visita(l.visita, l.em).secoes.add(l.secao);
      } else visita(l.visita, l.em);
    }

    const tempoPorParte: TempoDaSecao[] = PROPOSTA_SECOES.filter((s) => porSecao.has(s)).map((s) => ({
      secao: s,
      nome: nomeDaSecao(s),
      segundos: porSecao.get(s)!.segundos,
      aberturasQueViram: porSecao.get(s)!.visitas.size,
    }));
    const maisVista = [...tempoPorParte].sort((a, b) => b.segundos - a.segundos)[0];
    const visitas: VisitaDaSala[] = [...porVisita.entries()]
      .map(([acesso, v]) => {
        const ultima = [...PROPOSTA_SECOES].reverse().find((s) => v.secoes.has(s));
        return { acesso, quando: v.quando.toISOString(), segundos: v.segundos, leuAte: ultima ? nomeDaSecao(ultima) : 'sem seção registrada' };
      })
      .sort((a, b) => b.quando.localeCompare(a.quando));

    const fazSentidoPorSecao = PROPOSTA_SECOES.map((s) => ({
      secao: s,
      nome: nomeDaSecao(s),
      vezes: reacoes.filter((r) => r.tipo === 'faz_sentido' && r.secao === s).length,
    })).filter((x) => x.vezes > 0);
    const anotacoes: AnotacaoDoLead[] = reacoes
      .filter((r) => r.tipo === 'duvida' || r.tipo === 'ideia')
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .map((r) => ({
        id: r.id,
        secao: r.secao as PropostaSecao,
        tipo: r.tipo as 'duvida' | 'ideia',
        texto: r.texto ?? '',
        em: r.criadoEm.toISOString(),
        versao: r.versao,
        acesso: r.acesso,
        respondidaEm: r.respondidaEm?.toISOString() ?? null,
        tarefaId: r.tarefaId,
      }));

    return {
      ...linha,
      tempoTotalSegundos: tempoPorParte.reduce((s, t) => s + t.segundos, 0),
      maisVista: maisVista && maisVista.segundos > 0 ? maisVista.nome : null,
      tempoPorParte,
      visitas,
      fazSentidoPorSecao,
      anotacoes,
    };
  }

  /** A última publicação de cada lead (de um lead só, quando pedido). */
  private async publicadas(orgId: string, leadId?: string): Promise<Base[]> {
    const eventos = await this.prisma.leadEvent.findMany({
      where: { orgId, type: 'proposta.publicada', ...(leadId ? { leadId } : {}) },
      orderBy: { occurredAt: 'desc' },
      select: { leadId: true, occurredAt: true, payload: true },
      take: 5000,
    });
    const vistos = new Map<string, Base>();
    for (const e of eventos) {
      if (vistos.has(e.leadId)) continue;
      const p = (e.payload ?? {}) as P;
      vistos.set(e.leadId, {
        leadId: e.leadId,
        versao: Number(p.versao) || 1,
        publicadaEm: e.occurredAt,
        produto: typeof p.produto === 'string' ? p.produto : null,
        valorCentavos: typeof p.valorCentavos === 'number' ? p.valorCentavos : null,
      });
    }
    return [...vistos.values()];
  }

  private async montar(orgId: string, bases: Base[]) {
    const ids = bases.map((b) => b.leadId);
    if (!ids.length) return [];
    const [leads, fichas, eventos, reacoes] = await Promise.all([
      this.prisma.lead.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }),
      this.prisma.comercialFicha.findMany({ where: { orgId, leadId: { in: ids } }, select: { leadId: true, empresa: true, etapa: true } }),
      this.prisma.leadEvent.findMany({
        where: { orgId, leadId: { in: ids }, type: { in: ['proposta.lida', 'proposta.aceita', ...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA] } },
        orderBy: { occurredAt: 'asc' },
        select: { leadId: true, type: true, occurredAt: true, payload: true },
      }),
      this.prisma.leadReacao.findMany({
        where: { orgId, leadId: { in: ids } },
        select: { id: true, leadId: true, versao: true, secao: true, tipo: true, texto: true, segundos: true, acesso: true, respondidaEm: true, tarefaId: true, criadoEm: true, atualizadoEm: true },
      }),
    ]);
    const nomeDe = new Map(leads.map((l) => [l.id, l.name]));
    const fichaDe = new Map(fichas.map((f) => [f.leadId, f]));

    return bases.map((b) => {
      const ficha = fichaDe.get(b.leadId);
      const evs = eventos.filter((e) => e.leadId === b.leadId);
      const daVersao = reacoes.filter((r) => r.leadId === b.leadId && r.versao === b.versao);
      const leituras = daVersao.filter((r) => r.tipo === 'leitura');
      const lidas = evs
        .filter((e) => e.type === 'proposta.lida' && Number(((e.payload ?? {}) as P).versao) === b.versao)
        .map((e) => {
          const p = (e.payload ?? {}) as P;
          const v = Number(p.visita);
          const secao = (typeof p.secao === 'string' && (PROPOSTA_SECOES as readonly string[]).includes(p.secao) ? p.secao : ETAPA_POR_BLOCO.get(String(p.bloco))) as PropostaSecao | undefined;
          return { visita: Number.isFinite(v) ? v : -1, secao, em: e.occurredAt };
        });
      const visitas = new Set<number>([...leituras.map((r) => r.acesso), ...lidas.map((l) => l.visita)]);
      const leuInvestimento = leituras.some((r) => r.secao === 'investimento') || lidas.some((l) => l.secao === 'investimento');
      const aceita = evs.find((e) => e.type === 'proposta.aceita' && e.occurredAt >= b.publicadaEm);
      const paga = evs.find((e) => (COMERCIAL_FATOS_DA_PRIMEIRA_PAGA as readonly string[]).includes(e.type));
      const etapa: EtapaDaPropostaLida = aceita ? 3 : leuInvestimento ? 2 : visitas.size ? 1 : 0;
      const atividades = [...leituras.map((r) => r.atualizadoEm), ...lidas.map((l) => l.em), ...daVersao.map((r) => r.criadoEm), ...(aceita ? [aceita.occurredAt] : [])];
      const ultima = atividades.sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
      const produto = rotuloDoProduto(b.produto);
      const linha: PropostaDaSalaNaLista = {
        leadId: b.leadId,
        cliente: ficha?.empresa || nomeDe.get(b.leadId) || 'lead',
        titulo: `${produto ?? 'Proposta'} · v${b.versao}`,
        versao: b.versao,
        produto,
        valor: b.valorCentavos != null ? b.valorCentavos / 100 : null,
        publicadaEm: b.publicadaEm.toISOString(),
        etapa,
        estado: paga ? 'Paga' : FRASE_DA_ETAPA[etapa],
        aberturas: visitas.size,
        ultimaAtividade: ultima?.toISOString() ?? null,
        reacoes: {
          fazSentido: daVersao.filter((r) => r.tipo === 'faz_sentido').length,
          duvidas: daVersao.filter((r) => r.tipo === 'duvida').length,
          ideias: daVersao.filter((r) => r.tipo === 'ideia').length,
        },
        aceitaEm: aceita?.occurredAt.toISOString() ?? null,
        pagaEm: paga?.occurredAt.toISOString() ?? null,
        etapaDoLead: COMERCIAL_ROTULO_DA_ETAPA[(ficha?.etapa ?? 'novo_lead') as ComercialEtapa],
      };
      return { linha, leituras, lidas, reacoes: daVersao };
    });
  }
}
