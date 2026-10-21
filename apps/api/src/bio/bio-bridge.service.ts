import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { TIPO_CASA_METAS, inscreverTarefaDaCasa, registrarPassagemDeFundo } from '../routines/rotinas-da-casa';
import type { ResultadoDaRotina } from '../routines/rotina.tipos';

const DIA = 86_400_000;
const CLIQUES = ['link_click', 'whatsapp_click'];

/**
 * Ponte bio → metas. O `GoalWeek.bioClicks` era digitado na mão; agora sai do
 * rastreio da própria bio. Direção da dependência: o bio escreve no goals — o
 * módulo de metas não conhece o bio (só lê o desafio, via prisma).
 */
@Injectable()
export class BioBridgeService implements OnModuleInit {
  private readonly log = new Logger('BioBridge');

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const min = Number(process.env.BIO_BRIDGE_INTERVAL_MIN ?? 720);
    if (!(min > 0)) return;

    /*
     * DESDE A RODADA DOS AGENTES (21/10/2026, A1): uma passagem por empresa, cada
     * uma no histórico de rotinas (`casa.metas`, RO-03) e dentro do contexto dela.
     */
    inscreverTarefaDaCasa(TIPO_CASA_METAS, (orgId) => this.passagemDaCasa(orgId), 'BioBridgeService');
    const run = async () => {
      try {
        const orgs = await this.prisma.org.findMany({ select: { id: true } });
        for (const o of orgs) {
          try {
            await comContexto(
              { orgId: o.id, actorType: 'system', correlationId: novaCorrelacao('cron'), origem: 'cron' },
              () =>
                registrarPassagemDeFundo(
                  this.prisma,
                  { orgId: o.id, tipo: TIPO_CASA_METAS },
                  () => this.passagemDaCasa(o.id),
                  { intervaloMin: min },
                ),
            );
          } catch (e) {
            this.log.warn(`ponte de metas falhou numa empresa: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        this.log.warn(`ponte de metas falhou: ${(e as Error).message}`);
      }
    };
    setTimeout(run, 40_000);
    setInterval(run, min * 60_000);
  }

  /** UMA passagem da rotina da casa `casa.metas` numa empresa. Só contagem no resumo. */
  private async passagemDaCasa(orgId: string): Promise<ResultadoDaRotina> {
    const r = await this.backfill(orgId);
    if (!r.semanas && !r.cliques) return { status: 'pulada', resumo: 'nenhuma semana com clique a recalcular' };
    return { status: 'ok', resumo: `${r.semanas} semana(s) atualizada(s), ${r.cliques} clique(s) contado(s)` };
  }

  /** Início efetivo do desafio: o do bio manda; GoalConfig é o fallback. */
  private async inicioDoDesafio(orgId: string): Promise<Date | null> {
    const desafio = await this.prisma.bioChallenge.findFirst({
      where: { orgId },
      orderBy: { inicio: 'desc' },
      select: { inicio: true },
    });
    if (desafio) return desafio.inicio;

    const cfg = await this.prisma.goalConfig.findUnique({
      where: { orgId },
      select: { challengeStart: true },
    });
    return cfg?.challengeStart ?? null;
  }

  /**
   * Recalcula bioClicks de cada semana registrada. Idempotente: pode rodar
   * quantas vezes quiser (é sempre um COUNT sobre a janela, não um incremento).
   */
  async backfill(orgId: string): Promise<{ semanas: number; cliques: number }> {
    const inicio = await this.inicioDoDesafio(orgId);
    if (!inicio) return { semanas: 0, cliques: 0 };

    const semanas = await this.prisma.goalWeek.findMany({
      where: { orgId },
      select: { id: true, weekNumber: true, startDate: true, bioClicks: true },
      orderBy: { weekNumber: 'asc' },
    });
    if (!semanas.length) return { semanas: 0, cliques: 0 };

    let tocadas = 0;
    let soma = 0;
    for (const s of semanas) {
      const de = s.startDate ?? new Date(inicio.getTime() + (s.weekNumber - 1) * 7 * DIA);
      const ate = new Date(de.getTime() + 7 * DIA);

      const cliques = await this.prisma.bioEvent.count({
        where: { orgId, nome: { in: CLIQUES }, ocorridoEm: { gte: de, lt: ate } },
      });
      soma += cliques;
      if (cliques === s.bioClicks) continue;

      await this.prisma.goalWeek.update({
        where: { id: s.id },
        data: { bioClicks: cliques },
      });
      await this.prisma.auditLog.create({
        data: {
          orgId,
          actorType: ActorType.system,
          action: 'bio.bridge_goalweek',
          entityType: 'GoalWeek',
          entityId: s.id,
          before: { bioClicks: s.bioClicks },
          after: { bioClicks: cliques },
        },
      });
      tocadas++;
    }

    if (tocadas) this.log.log(`bioClicks atualizado em ${tocadas} semana(s)`);
    return { semanas: tocadas, cliques: soma };
  }
}
