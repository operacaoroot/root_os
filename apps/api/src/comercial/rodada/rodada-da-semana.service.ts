import { Injectable } from '@nestjs/common';

import { PainelComercialService, rotuloDoCanal, rotuloDoProduto } from '../../painel-comercial/painel-comercial.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TarefasDoComercialService } from '../tarefas/tarefas-do-comercial.service';
import {
  fechouEm,
  movimentosDaSemana,
  nomeDoLead,
  propostasDaSemana,
  rotuloDaEtapa,
  saidasDaSemana,
  semanaDaRodada,
  type FatoDaRodada,
  type LeadDaRodada,
  type RodadaDaSemanaResposta,
} from './rodada-da-semana';

/*
 * Layout 26/10: a Rodada da semana lida do banco (as regras em `rodada-da-semana.ts`).
 *
 * Só lê. A negociação vem do `PainelComercialService.painel` (o mesmo número do Painel
 * geral) e as tarefas atrasadas do `TarefasDoComercialService.listar` (o mesmo recorte
 * do Funil vivo e do painel do lead). Toda consulta leva a empresa da sessão.
 */
@Injectable()
export class RodadaDaSemanaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly painel: PainelComercialService,
    private readonly tarefas: TarefasDoComercialService,
  ) {}

  async rodada(orgId: string, quemPergunta: string, semanaPedida?: unknown, agora: Date = new Date()): Promise<RodadaDaSemanaResposta> {
    const s = semanaDaRodada(semanaPedida, agora);
    const janela = { gte: s.inicio, lt: s.fim };

    const [novos, fatos, fichasFechadasSemFato, painel, tarefas] = await Promise.all([
      this.prisma.lead.findMany({
        where: { orgId, enteredAt: janela },
        orderBy: { enteredAt: 'desc' },
        take: 500,
        select: {
          id: true, name: true, enteredAt: true,
          source: { select: { name: true } },
          ficha: { select: { etapa: true, empresa: true, canal: true } },
        },
      }),
      this.prisma.leadEvent.findMany({
        where: {
          orgId,
          occurredAt: janela,
          type: { in: ['etapa.mudou', 'etapa.movida_a_mao', 'saida.registrada', 'proposta.publicada', 'cliente.ativo'] },
        },
        orderBy: { occurredAt: 'asc' },
        take: 5000,
        select: { leadId: true, type: true, payload: true, occurredAt: true },
      }),
      // E9 sem o fato `cliente.ativo`: fecha na data do cliente ativo da ficha ou na entrada em E9.
      this.prisma.comercialFicha.findMany({
        where: {
          orgId,
          etapa: 'fechado',
          OR: [{ clienteAtivoEm: janela }, { clienteAtivoEm: null, etapaDesde: janela }],
        },
        select: { leadId: true, etapa: true, clienteAtivoEm: true, etapaDesde: true },
      }),
      this.painel.painel(orgId, agora),
      this.tarefas.listar(orgId, quemPergunta),
    ]);
    const fatosDaSemana: FatoDaRodada[] = fatos;

    // Fechados: o primeiro `cliente.ativo` de cada lead, se caiu na semana; ou a ficha em E9 sem o fato.
    const ativosNaSemana = [...new Set(fatosDaSemana.filter((f) => f.type === 'cliente.ativo').map((f) => f.leadId))];
    const candidatosDaFicha = fichasFechadasSemFato.map((f) => f.leadId);
    const comFato = [...new Set([...ativosNaSemana, ...candidatosDaFicha])];
    const primeiros = comFato.length
      ? await this.prisma.leadEvent.groupBy({
          by: ['leadId'],
          where: { orgId, leadId: { in: comFato }, type: 'cliente.ativo' },
          _min: { occurredAt: true },
        })
      : [];
    const primeiroAtivo = new Map(primeiros.map((p) => [p.leadId, p._min.occurredAt]));
    const fichaDe = new Map(fichasFechadasSemFato.map((f) => [f.leadId, f]));
    const quando = new Map<string, Date>();
    for (const id of comFato) {
      const em = fechouEm(primeiroAtivo.get(id) ?? null, fichaDe.get(id) ?? null);
      if (em && em.getTime() >= s.inicio.getTime() && em.getTime() < s.fim.getTime()) quando.set(id, em);
    }

    // Os nomes de todo lead citado na semana, numa leitura só (a empresa da sessão no filtro).
    const citados = [...new Set([...fatosDaSemana.map((f) => f.leadId), ...quando.keys()])];
    const linhas = citados.length
      ? await this.prisma.lead.findMany({
          where: { orgId, id: { in: citados } },
          select: { id: true, name: true, ficha: { select: { empresa: true, valorCentavos: true, produto: true } } },
        })
      : [];
    const leads = new Map<string, LeadDaRodada>(linhas.map((l) => [l.id, { id: l.id, nome: l.name, empresa: l.ficha?.empresa ?? null }]));
    const fichaDoLead = new Map(linhas.map((l) => [l.id, l.ficha]));

    const fechados = [...quando.entries()]
      .map(([leadId, em]) => {
        const f = fichaDoLead.get(leadId);
        return {
          leadId,
          nome: nomeDoLead(leads.get(leadId), leadId),
          valor: f?.valorCentavos != null ? f.valorCentavos / 100 : null,
          produto: rotuloDoProduto(f?.produto),
          em: em.toISOString(),
        };
      })
      .sort((a, b) => b.em.localeCompare(a.em));

    return {
      semana: { de: s.de, ate: s.ate, anterior: s.anterior, proxima: s.proxima, atual: s.atual },
      geradoEm: agora.toISOString(),
      entraram: novos.map((l) => ({
        leadId: l.id,
        nome: l.ficha?.empresa || l.name,
        etapa: rotuloDaEtapa(l.ficha?.etapa ?? 'novo_lead'),
        canal: rotuloDoCanal(l.ficha?.canal) ?? l.source?.name ?? null,
        em: l.enteredAt.toISOString(),
      })),
      movimentos: movimentosDaSemana(fatosDaSemana, leads),
      fechados,
      valorFechado: fechados.reduce((n, f) => n + (f.valor ?? 0), 0),
      propostas: propostasDaSemana(fatosDaSemana, leads),
      saidas: saidasDaSemana(fatosDaSemana, leads),
      tarefasAtrasadas: tarefas.tarefas
        .filter((t) => t.situacao === 'atrasada')
        .map((t) => ({ id: t.id, titulo: t.titulo, prazo: t.prazo, pessoa: t.pessoa?.nome ?? t.responsavelTexto, lead: t.lead })),
      negociacao: {
        total: painel.totais.emNegociacao,
        abertos: painel.totais.abertos,
        pagante: painel.totais.emNegociacaoPagante ?? null,
        semCaixa: painel.totais.emNegociacaoSemCaixa ?? null,
      },
    };
  }
}
