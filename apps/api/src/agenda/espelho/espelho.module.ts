import { Module } from '@nestjs/common';

import { RoutinesModule } from '../../routines/routines.module';
import { EspelhoService } from './espelho.service';

/** O espelho, a rotina `agenda.sincronizar` e a cópia diária (lanes G1 e G7). */
@Module({
  imports: [RoutinesModule],
  providers: [EspelhoService],
  exports: [EspelhoService],
})
export class EspelhoDaAgendaModule {}
