import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';
import { ReguaDaAgendaModule } from '../regua/regua.module';
import { EscritaDaAgendaController } from './escrita.controller';
import { EscritaDaAgendaService } from './escrita.service';

/**
 * A escrita no Google pela porta e o histórico (lane G4). A porta e a política
 * vêm dos módulos globais (`GatewayModule`, `PolicyModule`).
 */
@Module({
  imports: [EspelhoDaAgendaModule, ReguaDaAgendaModule],
  controllers: [EscritaDaAgendaController],
  providers: [EscritaDaAgendaService],
  exports: [EscritaDaAgendaService],
})
export class EscritaDaAgendaModule {}
