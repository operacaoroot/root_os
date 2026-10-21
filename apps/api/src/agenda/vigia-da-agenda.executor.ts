import { Injectable, OnModuleInit } from '@nestjs/common';

import { ExecutoresDeRotinaRegistry } from '../routines/executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../routines/rotina.tipos';
import { TIPO_AGENDA_VIGIA } from '../routines/rotina.tipos';
import { VigiaDaAgendaService } from './vigia-da-agenda.service';

/**
 * O EXECUTOR DO VIGIA DA AGENDA (AG-01) — a rotina `agenda.vigia`, a cada 15
 * minutos (`*\/15 * * * *`, São Paulo).
 *
 * Semeado por empresa na primeira leitura de `GET /agenda/fora-do-padrao` (a
 * tela `/agenda`), LIGADO e em `aprendendo`. A passagem é do serviço
 * (`VigiaDaAgendaService.passagem`): sem Google conectado, ou com o Google
 * Agenda desligado em Conexões, ela é `pulada` e não vira linha de histórico.
 */
@Injectable()
export class ExecutorDoVigiaDaAgenda implements OnModuleInit {
  constructor(
    private readonly vigia: VigiaDaAgendaService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_AGENDA_VIGIA]: (ctx) => this.executar(ctx) }, 'ExecutorDoVigiaDaAgenda');
  }

  executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    return this.vigia.passagem(ctx.orgId, ctx.agora);
  }
}
