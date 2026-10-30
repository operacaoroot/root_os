import { Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Rotina } from '@prisma/client';
import { IDEIAS_POR_DIA, quandoDoCron, type FluxoDasIdeias, type FluxoEtapa } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../routines/executores.registry';
import { TIPO_PAUTA_COLETA, type ContextoDaRotina, type ResultadoDaRotina } from '../routines/rotina.tipos';
import { proximaOcorrencia } from '../pauta/cron';
import { MemoriaDoMarketingService } from './memoria-do-marketing.service';
import { TriagemService } from './triagem.service';
import { SLUG_DA_IA_DAS_IDEIAS, TIPO_DA_IA_DAS_IDEIAS, garantirRotinaDasIdeias } from './rotina-das-ideias';

/** Quantos itens a IA lê por passagem (lotes de 4). */
const POR_PASSAGEM = 200;
const POSTS_POR_PERFIL = Number(process.env.APIFY_POSTS_POR_PERFIL ?? 3);

/**
 * O FLUXO DAS IDEIAS (30/10/2026, pedido do Lucas: "saber quantas vão ser, como, que
 * horas sai, e ligar e desligar esse agente"). Duas rotinas do OS, cada uma com o
 * interruptor de /rotinas:
 *   1. a coleta da pauta (pauta.coleta, todo dia às 22h): Apify e RSS trazem os posts;
 *   2. a IA das ideias (esta, todo dia às 23h): relê o card que nasceu sem ela e monta
 *      os cards do que chegou, até 200 por passagem. Desligada, a tela também não lê sozinha.
 * O painel de Fontes mostra as duas com número, horário, custo e o último resultado.
 */
@Injectable()
export class FluxoDeIdeiasService implements OnModuleInit {
  private readonly log = new Logger('FluxoDeIdeias');

  constructor(
    private readonly prisma: PrismaService,
    private readonly triagem: TriagemService,
    private readonly memoria: MemoriaDoMarketingService,
    @Optional() private readonly executores?: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.executores?.registrar({ [TIPO_DA_IA_DAS_IDEIAS]: (ctx) => this.passagem(ctx) }, 'FluxoDeIdeiasService');
  }

  async passagem(ctx: Pick<ContextoDaRotina, 'orgId'>): Promise<ResultadoDaRotina> {
    try {
      const relidas = await this.triagem.reler(ctx.orgId);
      const novas = await this.triagem.montar(ctx.orgId, POR_PASSAGEM);
      const falharam = relidas.falharam + novas.falharam;
      if (!novas.lidos && !relidas.lidos) return { status: 'ok', resumo: 'Nada novo para ler.' };
      const partes = [
        `${novas.cards} ${novas.cards === 1 ? 'ideia nova' : 'ideias novas'} para avaliar`,
        novas.reserva ? `${novas.reserva} na Reserva (passaram das ${IDEIAS_POR_DIA} do dia)` : '',
        novas.descartados ? `${novas.descartados} fora do tema` : '',
        relidas.relidos ? `${relidas.relidos} relidas` : '',
        falharam ? `${falharam} falharam` : '',
      ].filter(Boolean);
      return { status: falharam && !novas.cards && !relidas.relidos ? 'erro' : 'ok', resumo: `${partes.join(', ')}.` };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) return { status: 'pulada', resumo: e.message.slice(0, 200) };
      this.log.warn(`IA das ideias falhou (${ctx.orgId}): ${(e as Error).message}`);
      return { status: 'erro', resumo: `A IA das ideias falhou: ${(e as Error).message}`.slice(0, 200) };
    }
  }

  async fluxo(orgId: string): Promise<FluxoDasIdeias> {
    await garantirRotinaDasIdeias(this.prisma, orgId);
    const semana = new Date(Date.now() - 7 * 86_400_000);
    const mes = new Date().toISOString().slice(0, 7);
    const [coleta, ia, fontes, grupos, aprovadasSemana, painel, apify] = await Promise.all([
      this.prisma.rotina.findFirst({ where: { orgId, tipo: TIPO_PAUTA_COLETA }, orderBy: { criadaEm: 'asc' } }),
      this.prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: SLUG_DA_IA_DAS_IDEIAS } } }),
      this.prisma.pautaFonte.findMany({ where: { orgId, ativo: true }, select: { tipo: true, plataforma: true, runsNoMes: true, mesReferente: true } }),
      this.prisma.marketingIdeiaCard.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      this.prisma.marketingIdeiaCard.count({ where: { orgId, status: 'aprovada', decididaEm: { gte: semana } } }),
      this.triagem.resumoDoPainel(orgId),
      this.memoria.usoDoApify().catch(() => ({ uso: null, configurado: false })),
    ]);
    const conta = (s: string) => grupos.find((g) => g.status === s)?._count._all ?? 0;
    const perfis = fontes.filter((f) => f.tipo === 'perfil' || f.tipo === 'busca');
    const coletasDoMes = perfis.reduce((t, f) => t + (f.mesReferente === mes ? f.runsNoMes : 0), 0);
    const uso = apify.uso;
    const custoPorColeta = uso && coletasDoMes ? uso.usadoUsd / coletasDoMes : null;
    const sobra = uso ? Math.max(0, uso.tetoUsd * 0.9 - uso.usadoUsd) : 0;
    return {
      coleta: coleta ? await this.etapa(coleta) : null,
      ia: await this.etapa(ia!),
      fontes: {
        ligadas: fontes.length,
        perfis: perfis.length,
        gratis: fontes.length - perfis.length,
        postsPorPerfil: POSTS_POR_PERFIL,
        itensPorDiaPerfis: perfis.length * POSTS_POR_PERFIL,
      },
      apify: uso
        ? {
            usadoUsd: uso.usadoUsd,
            tetoUsd: uso.tetoUsd,
            voltaEm: uso.voltaEm,
            custoPorColeta,
            diasQueDa: custoPorColeta && perfis.length ? Math.floor(sobra / (custoPorColeta * perfis.length)) : null,
          }
        : null,
      agora: {
        esperandoIa: painel.pendentes,
        paraAvaliar: conta('nova'),
        semLeitura: painel.semLeitura,
        aprovadasSemana,
        descartadasIa: conta('descartada_ia'),
        reserva: conta('reserva'),
      },
      iaConfigurada: painel.ia,
    };
  }

  private async etapa(r: Rotina): Promise<FluxoEtapa> {
    const ultima = await this.prisma.rotinaExecucao.findFirst({ where: { rotinaId: r.id }, orderBy: { inicioEm: 'desc' }, select: { resumo: true, erro: true } });
    return {
      rotinaId: r.id,
      nome: r.nome,
      cron: r.cron,
      quando: quandoDoCron(r.cron),
      ativo: r.ativo,
      ultimaEm: r.ultimaExecucaoEm?.toISOString() ?? null,
      ultimoStatus: r.ultimoStatus,
      ultimoResumo: ultima?.resumo ?? ultima?.erro ?? null,
      proximaEm: r.ativo ? (proximaOcorrencia(r.cron, r.tz, new Date())?.toISOString() ?? null) : null,
    };
  }
}
