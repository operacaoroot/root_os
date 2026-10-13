import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, partesNoFuso, somarDias, type RelatorioDaSemana } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { MemoriaService } from '../memory/memoria.service';
import { fusoDaPolitica, minutosNoFuso } from '../policy/limites';
import { PrismaService } from '../prisma/prisma.service';
import { chaveDoRelatorio, chavesDoRelatorio, corpoComDado, dadoDaNota, gravarNota } from './notas-do-comercial';
import {
  DIAS_PADRAO_DO_RELATORIO,
  PREVISAO_PENDENTE,
  RECORTES_DA_TELA,
  alcanceDoLead,
  contarAcoes,
  diasDoPedido,
  diasEntre,
  funilCumulativo,
  limparNarrativa,
  markdownDoRelatorio,
  mediana,
  perdasPorMotivo,
  promptDoRelatorio,
} from './relatorio-da-semana';
import { RelogioComercialRegistry } from './relogio.registry';

/*
 * O RELATOR DA QUINTA (lane E, fase 2, 13/10/2026). Tela 13.
 *
 * `numeros()` conta tudo no banco (as regras em `relatorio-da-semana.ts`);
 * `gerar()` pede ao modelo SÓ a leitura, limpa a narrativa de qualquer número e
 * guarda o relatório como nota da memória (`comercial.relatorio.semana.<dia>.<N>d`,
 * uma por dia e recorte: revisão E-11). O relógio comercial chama `talvezGerar`
 * a cada minuto: na quinta, a partir das 18:00 do fuso da política, gera uma
 * vez o de 7 dias (antes da mesa das 19h30), mesmo que alguém já tenha gerado
 * outro recorte no dia.
 *
 * Modelo fora do ar ou sem resposta não derruba o relatório: os números saem,
 * a narrativa fica nula com o aviso. Toda chamada leva `orgId` para o teto.
 */

export const HORA_DO_RELATOR_MIN = 18 * 60;
const DIA_MS = 86_400_000;

@Injectable()
export class RelatorioDaSemanaService implements OnModuleInit {
  private readonly log = new Logger('RelatorComercial');
  private readonly geradoNoDia = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly relogio: RelogioComercialRegistry,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  inscrever(): void {
    this.relogio.inscrever('inteligencia.relator', (orgId, agora) => this.talvezGerar(orgId, agora));
  }

  /** A tarefa do relógio: quinta, a partir das 18:00 do fuso da política, uma vez. */
  async talvezGerar(orgId: string, agora: Date): Promise<number> {
    const fuso = fusoDaPolitica();
    const p = partesNoFuso(agora, fuso);
    const minutos = minutosNoFuso(agora, fuso);
    if (p.diaDaSemana !== 'qui' || Number.isNaN(minutos) || minutos < HORA_DO_RELATOR_MIN) return 0;
    const marca = `${orgId}:${p.dia}`;
    if (this.geradoNoDia.has(marca)) return 0;
    if (await this.relatorioDoDia(orgId, p.dia, DIAS_PADRAO_DO_RELATORIO)) {
      this.geradoNoDia.add(marca);
      return 0;
    }
    await this.gerar(orgId, { agora, dias: DIAS_PADRAO_DO_RELATORIO, origem: 'relogio' });
    this.geradoNoDia.add(marca);
    return 1;
  }

  /** Só os números do banco, sem narrativa. */
  async numeros(orgId: string, diasPedidos?: unknown, agora: Date = new Date()): Promise<RelatorioDaSemana> {
    const periodoDias = diasDoPedido(diasPedidos);
    const desde = new Date(agora.getTime() - periodoDias * DIA_MS);
    const noPeriodo = { gte: desde, lte: agora };

    const entraram = await this.prisma.comercialFicha.findMany({
      where: { orgId, lead: { enteredAt: noPeriodo } },
      select: { leadId: true, etapa: true, etapaAntesDaSaida: true },
    });
    const idsQueEntraram = entraram.map((f) => f.leadId);
    const mudancas = idsQueEntraram.length
      ? await this.prisma.leadEvent.findMany({ where: { leadId: { in: idsQueEntraram }, type: 'etapa.mudou' }, select: { leadId: true, payload: true } })
      : [];
    const destinos = new Map<string, string[]>();
    for (const m of mudancas) destinos.set(m.leadId, [...(destinos.get(m.leadId) ?? []), String(((m.payload ?? {}) as { para?: unknown }).para ?? '')]);
    const funil = funilCumulativo(entraram.map((f) => alcanceDoLead(f.etapa, f.etapaAntesDaSaida, destinos.get(f.leadId) ?? [])));

    const ativos = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'cliente.ativo', occurredAt: noPeriodo }, select: { leadId: true } });
    const fechados = new Set(ativos.map((a) => a.leadId)).size;

    // Mediana do 1º oi ao Pix: o PRIMEIRO pagamento da 1ª parcela de cada lead, se caiu no período.
    // D-10: o fato tem o nome da forma (pix.pago, boleto.pago, cartao.pago); os três contam, como contavam
    // quando todos eram gravados como pix.pago.
    const pagas = [...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA];
    const pixDoPeriodo = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: { in: pagas }, occurredAt: noPeriodo }, select: { leadId: true } });
    const comPix = [...new Set(pixDoPeriodo.map((x) => x.leadId))];
    const dias: number[] = [];
    if (comPix.length) {
      const primeiros = await this.prisma.leadEvent.groupBy({ by: ['leadId'], where: { leadId: { in: comPix }, type: { in: pagas } }, _min: { occurredAt: true } });
      const entradas = new Map((await this.prisma.lead.findMany({ where: { id: { in: comPix }, orgId }, select: { id: true, enteredAt: true } })).map((l) => [l.id, l.enteredAt]));
      for (const p of primeiros) {
        const pix = p._min.occurredAt;
        const oi = entradas.get(p.leadId);
        if (pix && oi && pix.getTime() >= desde.getTime()) dias.push(diasEntre(oi, pix));
      }
    }
    const med = mediana(dias);

    const saidas = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'saida.registrada', occurredAt: noPeriodo }, select: { payload: true } });
    const perdas = perdasPorMotivo(saidas.map((s) => {
      const p = (s.payload ?? {}) as { saida?: unknown; motivo?: unknown };
      return { saida: String(p.saida ?? ''), motivo: String(p.motivo ?? 'outro') };
    }));

    const fatos = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, occurredAt: noPeriodo }, select: { type: true, payload: true } });
    const aprovacoes = await this.prisma.approval.count({ where: { orgId, capabilityId: { startsWith: 'comercial.' }, aprovadoEm: noPeriodo } });
    const acoes = contarAcoes(fatos, aprovacoes);

    const emProposta = await this.prisma.comercialFicha.count({ where: { orgId, etapa: { in: ['proposta', 'follow_up'] } } });
    // C10: "propostas vencendo". O horizonte é o próprio recorte, à frente (nenhum número novo).
    const vencendo = await this.prisma.comercialFicha.findMany({
      where: { orgId, etapa: { in: ['proposta', 'follow_up'] }, validade: { gte: agora, lte: new Date(agora.getTime() + periodoDias * DIA_MS) } },
      orderBy: { validade: 'asc' },
      select: { leadId: true, validade: true, empresa: true, lead: { select: { name: true } } },
      take: 50,
    });

    return {
      periodoDias,
      leads: entraram.length,
      fechados,
      medianaDiasDoOiAoPix: med == null ? null : Math.round(med * 10) / 10,
      acoes,
      funil,
      perdasPorMotivo: perdas,
      previsao: null,
      previsaoPendente: PREVISAO_PENDENTE,
      leadsEmPropostaAgora: emProposta,
      propostasVencendo: vencendo.map((v) => ({ leadId: v.leadId, nome: v.empresa ?? v.lead.name, validade: v.validade!.toISOString() })),
      geradoEm: agora.toISOString(),
      narrativa: null,
      desde: desde.toISOString(),
      ate: agora.toISOString(),
      origem: 'ao_vivo',
    };
  }

  /** Gera agora: números do banco, leitura do modelo sem número, nota da memória. */
  async gerar(orgId: string, opcoes: { dias?: unknown; agora?: Date; origem?: 'relogio' | 'pessoa' } = {}): Promise<RelatorioDaSemana> {
    const agora = opcoes.agora ?? new Date();
    const r = await this.numeros(orgId, opcoes.dias, agora);
    const avisos: string[] = [];
    let narrativa: string | null = null;
    try {
      const { system, user } = promptDoRelatorio(r);
      const bruta = await this.llm.complete({ system, user, orgId, maxTokens: 800 });
      const limpa = limparNarrativa(bruta);
      narrativa = limpa.narrativa;
      avisos.push(...limpa.avisos);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`relatório da semana da empresa ${orgId}: a leitura do modelo falhou (${msg}); os números saem sem ela.`);
      avisos.push(`a leitura do modelo falhou: ${msg.slice(0, 160)}`);
    }
    const final: RelatorioDaSemana = { ...r, narrativa, narrativaAvisos: avisos, origem: opcoes.origem ?? 'pessoa' };
    const dia = partesNoFuso(agora, fusoDaPolitica()).dia;
    await gravarNota(this.memoria, orgId, chaveDoRelatorio(dia, final.periodoDias), {
      title: `Relatório da semana · ${dia} · ${final.periodoDias} dias`,
      body: corpoComDado(markdownDoRelatorio(final), final),
      motivo: `relatório da semana gerado (${final.origem}), últimos ${final.periodoDias} dias`,
      tags: ['comercial', 'relatorio'],
      sourceRef: `comercial.relatorio · ${dia} · ${this.llm.name}`,
    });
    return final;
  }

  /** O relatório gravado de um dia com o recorte pedido (a chave nova, ou a antiga se o dado for do mesmo recorte). */
  private async relatorioDoDia(orgId: string, dia: string, periodoDias: number): Promise<RelatorioDaSemana | null> {
    for (const chave of chavesDoRelatorio(dia, periodoDias)) {
      const nota = await this.memoria.porChave(orgId, chave);
      const dado = nota ? dadoDaNota<RelatorioDaSemana>(nota.body) : null;
      if (dado && dado.periodoDias === periodoDias) return dado;
    }
    return null;
  }

  /** Quando o relator gerou pela última vez (últimos 8 dias, nos recortes da tela 13), para a torre. */
  async ultimaGeracaoEm(orgId: string, agora: Date = new Date()): Promise<Date | null> {
    const hoje = partesNoFuso(agora, fusoDaPolitica()).dia;
    let ultima: Date | null = null;
    for (let i = 0; i <= 7 && !ultima; i++) {
      for (const recorte of RECORTES_DA_TELA) {
        const dado = await this.relatorioDoDia(orgId, somarDias(hoje, -i), recorte);
        const em = dado?.geradoEm ? new Date(dado.geradoEm) : null;
        if (em && (!ultima || em.getTime() > ultima.getTime())) ultima = em;
      }
    }
    return ultima;
  }

  /** Tela 13: o último relatório gerado nos últimos 7 dias com o mesmo recorte; sem ele, os números ao vivo. */
  async ler(orgId: string, diasPedidos?: unknown, agora: Date = new Date()): Promise<RelatorioDaSemana> {
    const periodoDias = diasDoPedido(diasPedidos);
    const hoje = partesNoFuso(agora, fusoDaPolitica()).dia;
    for (let i = 0; i <= 7; i++) {
      const dado = await this.relatorioDoDia(orgId, somarDias(hoje, -i), periodoDias);
      if (dado) return dado;
    }
    return this.numeros(orgId, periodoDias, agora);
  }
}
