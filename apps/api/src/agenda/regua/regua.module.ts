import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';
import { ReguaService } from './regua.service';

/** As regras, o motor no servidor, os Conflitos e os Relatórios (lanes G2 e G5). */
@Module({
  imports: [EspelhoDaAgendaModule],
  providers: [ReguaService],
  exports: [ReguaService],
})
export class ReguaDaAgendaModule {}
