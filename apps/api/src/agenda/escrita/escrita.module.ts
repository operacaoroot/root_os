import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';
import { ReguaDaAgendaModule } from '../regua/regua.module';
import { EscritaDaAgendaService } from './escrita.service';

/** A escrita no Google pela porta e o histórico (lane G4). */
@Module({
  imports: [EspelhoDaAgendaModule, ReguaDaAgendaModule],
  providers: [EscritaDaAgendaService],
  exports: [EscritaDaAgendaService],
})
export class EscritaDaAgendaModule {}
