import { Injectable, OnModuleInit } from '@nestjs/common';

import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import { TIPOS_DA_CASA, rotinaDaCasa, tarefaDaCasa } from '../rotinas-da-casa';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';

/**
 * AS ROTINAS DA CASA NO "RODAR AGORA" (rodada dos agentes, 21/10/2026, A1).
 *
 * O relógio de `casa.clickup`, `casa.vault`, `casa.conciliacao`, `casa.bio` e
 * `casa.metas` é o do próprio serviço (ver `rotinas-da-casa.ts`), e o agendador
 * PULA esses tipos no tique. Este executor existe para duas coisas:
 *
 *   · a rotina não aparecer "sem executor" na tela;
 *   · o "Rodar agora" rodar o trabalho de verdade, nesta empresa, pelo trabalho
 *     que o serviço inscreveu (`inscreverTarefaDaCasa`). O histórico dessa
 *     passagem quem grava é o `RotinasService.executar`, como em toda rotina.
 *
 * Pelo tique (`cron`), devolve `pulada` sem fazer nada: é a defesa para o dia em
 * que o agendador deixar de pular estes tipos, e a passagem não roda em dobro.
 */
@Injectable()
export class ExecutorDasRotinasDaCasa implements OnModuleInit {
  constructor(private readonly registro: ExecutoresDeRotinaRegistry) {}

  onModuleInit(): void {
    this.registro.registrar(
      Object.fromEntries(TIPOS_DA_CASA.map((tipo) => [tipo, (ctx: ContextoDaRotina) => this.executar(tipo, ctx)])),
      'ExecutorDasRotinasDaCasa',
    );
  }

  async executar(tipo: string, ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const def = rotinaDaCasa(tipo);
    if (ctx.origem !== 'manual') {
      return { status: 'pulada', resumo: `o relógio desta rotina é o do serviço (${def.variavel})` };
    }
    const tarefa = tarefaDaCasa(tipo);
    if (!tarefa) {
      throw new Error(
        `o serviço de "${def.nome}" não está montado neste processo (ou está sem configuração), ` +
          'e não há o que rodar agora.',
      );
    }
    return tarefa(ctx.orgId, ctx.agora);
  }
}
