import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { RodadaService } from './rodada.service';
import { combina, parseCron, proximaOcorrencia } from './cron';

// Gatilho das rotinas. Acorda a cada minuto e pergunta "qual rotina bate agora?",
// em vez de registrar um CronJob por rotina — assim editar uma rotina na tela
// passa a valer no minuto seguinte, sem re-registro nenhum.
//
// Roda em UM processo só (a API é container único). Se um dia escalar para mais
// de uma réplica, duas instâncias disparariam a mesma rodada: a trava seria um
// advisory lock no Postgres em volta do bloco de disparo.
@Injectable()
export class PautaSchedulerService implements OnModuleInit {
  private readonly log = new Logger('PautaScheduler');
  private readonly ativo = (process.env.PAUTA_CRON ?? 'on') !== 'off';
  // Guarda o minuto já processado: se o tick atrasar e rodar duas vezes no
  // mesmo minuto, a rodada não sai duplicada.
  private ultimoMinuto = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly rodadas: RodadaService,
  ) {}

  onModuleInit(): void {
    if (!this.ativo) {
      this.log.warn('PAUTA_CRON=off — rotinas não disparam sozinhas.');
      return;
    }
    // Alinha o primeiro tick à virada do minuto e segue de 60 em 60s.
    const ate = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      void this.tick();
      setInterval(() => void this.tick(), 60_000);
    }, ate);
    this.log.log(`Agendador de pauta ativo (tick a cada minuto, primeiro em ${Math.round(ate / 1000)}s)`);
  }

  private async tick(): Promise<void> {
    const agora = new Date();
    const marca = agora.toISOString().slice(0, 16); // até o minuto
    if (marca === this.ultimoMinuto) return;
    this.ultimoMinuto = marca;

    let rotinas;
    try {
      rotinas = await this.prisma.pautaRotina.findMany({ where: { ativo: true } });
    } catch (e) {
      this.log.warn(`tick não conseguiu ler as rotinas: ${(e as Error).message}`);
      return;
    }

    for (const r of rotinas) {
      let bate = false;
      try {
        bate = combina(parseCron(r.cron), agora, r.tz);
      } catch (e) {
        this.log.warn(`rotina "${r.slug}" tem cron inválido (${r.cron}): ${(e as Error).message}`);
        continue;
      }
      if (!bate) continue;

      this.log.log(`disparando rotina "${r.slug}"`);
      try {
        const cfg = (r.config ?? {}) as { horas?: number; coletarAntes?: boolean };
        /*
         * O CONTEXTO DE EXECUÇÃO DA EMPRESA ABRE AQUI (RF-T-04, RNF-09, RF-G-05).
         *
         * Esta é a ÚNICA chamada de modelo do produto que não nasce de uma
         * requisição: as outras herdam a empresa do interceptor HTTP ou abrem o
         * contexto por conta própria (o laço do agente). Sem ele, a rodada da
         * madrugada chamava o modelo com a empresa em branco — o teto de custo
         * por empresa e por dia não reservava nada, não contava nada e avisava
         * uma vez por processo. Justamente o gasto que roda sem ninguém olhando
         * era o que ficava de fora do teto que foi desenhado para ele.
         *
         * Vale também para o banco: a empresa do contexto é a que viaja como
         * `app.org_id` (`prisma/sessao-de-banco.ts`), então depois da virada para
         * o papel restrito é isto que faz a rotina enxergar as próprias linhas.
         * E é por empresa, uma de cada vez — não é contexto de plataforma, que
         * abriria o alcance inteiro para uma coisa que sabe de quem é.
         */
        const rodada = await comContexto(
          {
            orgId: r.orgId,
            actorType: ActorType.system,
            actorId: null,
            agentSlug: null,
            correlationId: novaCorrelacao('pauta'),
            origem: 'cron',
          },
          async () => {
            // Coletar antes de curar é o default: sem insumo fresco a rodada não
            // tem assunto, e o feed é barato (fetch, sem Apify).
            if (cfg.coletarAntes !== false) {
              const c = await this.rodadas.coletarFeeds(r.orgId, 'rotina');
              this.log.log(`  feeds: ${c.novas} item(ns) novo(s) de ${c.fontes} fonte(s)`);
            }
            return this.rodadas.gerar(r.orgId, 'rotina', {
              rotinaId: r.id,
              horas: cfg.horas ?? 72,
            });
          },
        );
        await this.prisma.pautaRotina.update({
          where: { id: r.id },
          data: {
            ultimoRun: agora,
            ultimoStatus: `ok: rodada ${rodada.id.slice(0, 8)}`,
            proximoRun: proximaOcorrencia(r.cron, r.tz, agora),
          },
        });
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        this.log.warn(`rotina "${r.slug}" falhou: ${msg}`);
        await this.prisma.pautaRotina
          .update({
            where: { id: r.id },
            data: {
              ultimoRun: agora,
              ultimoStatus: `erro: ${msg}`,
              proximoRun: proximaOcorrencia(r.cron, r.tz, agora),
            },
          })
          .catch(() => undefined);
      }
    }
  }
}
