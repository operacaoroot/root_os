import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RodadaService } from '../../pauta/rodada.service';
import { proximaOcorrencia } from '../../pauta/cron';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_RODADA } from '../rotina.tipos';

/**
 * A ROTINA DA PAUTA, EXECUTADA PELO MECANISMO NOVO — a primeira a migrar.
 *
 * O que ela faz não mudou uma linha: coletar os feeds (quando a configuração
 * pede) e gerar a rodada. O que mudou é QUEM a chama — antes era um
 * `setInterval` dentro do módulo de pauta que só sabia falar de pauta; agora é o
 * agendador único, que trata esta rotina como trata qualquer outra.
 *
 * O CONTEXTO DA EMPRESA JÁ ESTÁ ABERTO QUANDO ESTE CÓDIGO RODA, e isso não é
 * detalhe: `gerar()` chama o modelo, e é o contexto que faz o TETO DE CUSTO DE
 * IA POR EMPRESA E POR DIA reservar, contar e recusar (RF-G-05). Foi exatamente
 * o buraco que a onda 6 fechou no agendador da pauta — o gasto que roda sem
 * ninguém olhando era o único que ficava de fora do teto desenhado para ele. O
 * agendador abre o contexto uma vez por execução (`rotinas.scheduler.ts`); o
 * executor não reabre nem troca de empresa.
 *
 * POR QUE ELE TAMBÉM ESCREVE EM `PautaRotina`. A tela de Pauta mostra
 * `ultimoRun`, `ultimoStatus` e `proximoRun` da linha dela. Deixar de escrever
 * ali faria a tela de Pauta congelar no último disparo do agendador antigo e dar
 * a impressão de que a rotina parou — "desligar o cron antigo não quebra nada"
 * inclui a tela que existia antes dele. O carimbo mora AQUI, e não no agendador,
 * para o agendador não precisar saber o que é uma pauta.
 */
@Injectable()
export class ExecutorDePauta implements OnModuleInit {
  private readonly log = new Logger('RotinaDePauta');

  constructor(
    private readonly prisma: PrismaService,
    private readonly rodadas: RodadaService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      { [TIPO_PAUTA_RODADA]: (ctx) => this.executar(ctx) },
      'ExecutorDePauta',
    );
  }

  private async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const cfg = ctx.config as { horas?: number; coletarAntes?: boolean };

    /*
     * A ORIGEM AINDA EXISTE?
     *
     * `refExterna` viaja daqui para `RodadaService.gerar`, que o grava como
     * chave estrangeira da rodada. Se a `PautaRotina` foi removida e este
     * espelho voltou a rodar (religado na tela antes de a reconciliação marcar a
     * órfã, por exemplo), o insert falharia por integridade referencial a cada
     * passagem — um erro de banco no histórico, no lugar da frase que explica o
     * que houve. A tela recusa religar rotina sem origem; esta é a segunda
     * tranca, para o caso de a corrida acontecer mesmo assim.
     */
    if (ctx.refExterna) {
      const origem = await this.prisma.pautaRotina.findFirst({
        where: { id: ctx.refExterna, orgId: ctx.orgId },
      });
      if (!origem) {
        throw new Error(
          'a rotina de origem foi removida na tela de Pauta — este espelho não tem mais o que rodar. ' +
            'Recrie a rotina na tela de Pauta, ou apague esta.',
        );
      }
    }

    try {
      // Coletar antes de curar é o default: sem insumo fresco a rodada não tem
      // assunto, e o feed é barato (fetch, sem Apify).
      if (cfg.coletarAntes !== false) {
        const c = await this.rodadas.coletarFeeds(ctx.orgId, 'rotina');
        this.log.log(
          `  coleta: ${c.novas} item(ns) novo(s) de ${c.fontes} fonte(s)` +
            (c.erros > 0 ? `, ${c.erros} com erro (o motivo fica na fonte, no Radar)` : ''),
        );
      }

      const rodada = await this.rodadas.gerar(ctx.orgId, 'rotina', {
        rotinaId: ctx.refExterna,
        horas: cfg.horas ?? 72,
      });

      const resumo = `rodada ${rodada.id.slice(0, 8)}`;
      await this.carimbarOrigem(ctx, `${ctx.origem === 'manual' ? 'manual' : 'ok'}: ${resumo}`);
      return { status: 'ok', resumo };
    } catch (e) {
      await this.carimbarOrigem(ctx, `erro: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * Devolve à `PautaRotina` de origem o que a tela de Pauta lê.
   *
   * Engole o próprio erro de propósito: a rodada já aconteceu (ou já falhou), e
   * um tropeço ao carimbar a linha antiga não pode trocar o desfecho que o
   * histórico vai registrar.
   */
  private async carimbarOrigem(ctx: ContextoDaRotina, status: string): Promise<void> {
    if (!ctx.refExterna) return;
    try {
      const r = await this.prisma.pautaRotina.findFirst({
        where: { id: ctx.refExterna, orgId: ctx.orgId },
      });
      if (!r) return;
      await this.prisma.pautaRotina.update({
        where: { id: r.id },
        data: {
          ultimoRun: ctx.agora,
          ultimoStatus: status.slice(0, 300),
          proximoRun: proximaOcorrencia(r.cron, r.tz, ctx.agora),
        },
      });
    } catch (e) {
      this.log.warn(`não deu para carimbar a PautaRotina de origem: ${(e as Error).message}`);
    }
  }
}
