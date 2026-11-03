import { Injectable, OnModuleInit } from '@nestjs/common';

import { ExecutoresDeRotinaRegistry } from '../../routines/executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../../routines/rotina.tipos';
import { TIPO_AGENDA_COPIA, TIPO_AGENDA_SINCRONIZAR } from '../../routines/rotina.tipos';
import { CopiaDaAgendaService } from './copia-da-agenda.service';
import { EspelhoService } from './espelho.service';

/**
 * OS EXECUTORES DO ESPELHO DA AGENDA (agenda v2, 29/10/2026, lanes G1 e G7):
 *   · `agenda.sincronizar` — a cada 2 min (`*\/2 * * * *`, São Paulo);
 *   · `agenda.copia` — às 03:00 de São Paulo.
 *
 * Semeados só na empresa da casa, na primeira leitura de `GET /agenda/espelho`,
 * LIGADOS só se o Google Agenda estiver conectado. Fora da casa, sem Google ou
 * com o Google Agenda desligado em Conexões, a passagem é `pulada`.
 */
@Injectable()
export class ExecutorDoEspelhoDaAgenda implements OnModuleInit {
  constructor(
    private readonly espelho: EspelhoService,
    private readonly copia: CopiaDaAgendaService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      {
        [TIPO_AGENDA_SINCRONIZAR]: (ctx) => this.sincronizar(ctx),
        [TIPO_AGENDA_COPIA]: (ctx) => this.copiar(ctx),
      },
      'ExecutorDoEspelhoDaAgenda',
    );
  }

  sincronizar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    return this.espelho.passagem(ctx.orgId, ctx.agora);
  }

  copiar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    return this.copia.copiar(ctx.orgId, ctx.agora);
  }
}
