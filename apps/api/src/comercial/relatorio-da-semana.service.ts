import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { partesNoFuso, somarDias, type RelatorioDaSemana } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { MemoriaService } from '../memory/memoria.service';
import { fusoDaPolitica, minutosNoFuso } from '../policy/limites';
import { PrismaService } from '../prisma/prisma.service';
import { corpoComDado, dadoDaNota, gravarNota, PREFIXO_DO_RELATORIO } from './notas-do-comercial';
import {
  PREVISAO_PENDENTE,
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
 * guarda o relatório como nota da memória (`comercial.relatorio.semana.<dia>`).
 * O relógio comercial chama `talvezGerar` a cada minuto: na quinta, a partir
 * das 18:00 do fuso da política, gera uma vez (antes da mesa das 19h30).
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
    if (await this.memoria.porChave(orgId, `${PREFIXO_DO_RELATORIO}${p.dia}`)) {
      this.geradoNoDia.add(marca);
      return 0;
    }
    await this.gerar(orgId, { agora, origem: 'relogio' });
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

    // Mediana do 1º oi ao Pix: o PRIMEIRO pix.pago de cada lead, se caiu no período.
    const pixDoPeriodo = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'pix.pago', occurredAt: noPeriodo }, select: { leadId: true } });
    const comPix = [...new Set(pixDoPeriodo.map((x) => x.leadId))];
    const dias: number[] = [];
    if (comPix.length) {
      const primeiros = await this.prisma.leadEvent.groupBy({ by: ['leadId'], where: { leadId: { in: comPix }, type: 'pix.pago' }, _min: { occurredAt: true } });
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
    await gravarNota(this.memoria, orgId, `${PREFIXO_DO_RELATORIO}${dia}`, {
      title: `Relatório da semana · ${dia}`,
      body: corpoComDado(markdownDoRelatorio(final), final),
      motivo: `relatório da semana gerado (${final.origem}), últimos ${final.periodoDias} dias`,
      tags: ['comercial', 'relatorio'],
      sourceRef: `comercial.relatorio · ${dia} · ${this.llm.name}`,
    });
    return final;
  }

  /** Quando o relator gerou pela última vez (últimos 8 dias), para a torre. */
  async ultimaGeracaoEm(orgId: string, agora: Date = new Date()): Promise<Date | null> {
    const hoje = partesNoFuso(agora, fusoDaPolitica()).dia;
    for (let i = 0; i <= 7; i++) {
      const nota = await this.memoria.porChave(orgId, `${PREFIXO_DO_RELATORIO}${somarDias(hoje, -i)}`);
      const dado = nota ? dadoDaNota<RelatorioDaSemana>(nota.body) : null;
      if (dado?.geradoEm) return new Date(dado.geradoEm);
    }
    return null;
  }

  /** Tela 13: o último relatório gerado nos últimos 7 dias com o mesmo recorte; sem ele, os números ao vivo. */
  async ler(orgId: string, diasPedidos?: unknown, agora: Date = new Date()): Promise<RelatorioDaSemana> {
    const periodoDias = diasDoPedido(diasPedidos);
    const hoje = partesNoFuso(agora, fusoDaPolitica()).dia;
    for (let i = 0; i <= 7; i++) {
      const nota = await this.memoria.porChave(orgId, `${PREFIXO_DO_RELATORIO}${somarDias(hoje, -i)}`);
      const dado = nota ? dadoDaNota<RelatorioDaSemana>(nota.body) : null;
      if (dado && dado.periodoDias === periodoDias) return dado;
    }
    return this.numeros(orgId, periodoDias, agora);
  }
}
