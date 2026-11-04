import { Injectable } from '@nestjs/common';

import { PainelComercialService, rotuloDoCanal, rotuloDoProduto } from '../../painel-comercial/painel-comercial.service';
import { PrismaService } from '../../prisma/prisma.service';
import { fechadosDaSemana } from './fechados-da-semana';
import { TarefasDoComercialService } from '../tarefas/tarefas-do-comercial.service';
import {
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

    const [novos, fatos, painel, tarefas] = await Promise.all([
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
      this.painel.painel(orgId, agora),
      this.tarefas.listar(orgId, quemPergunta),
    ]);
    const fatosDaSemana: FatoDaRodada[] = fatos;

    // Fechados: a conta única da semana (etapa 9, F-25), a mesma que o Relatório comercial usa.
    const quando = await fechadosDaSemana(this.prisma, orgId, s);

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
