import { Module } from '@nestjs/common';

import { EscritaDaAgendaModule } from '../escrita/escrita.module';
import { ReguaDaAgendaModule } from '../regua/regua.module';
import { AgendarController, ConviteDaAgendaController } from './convite.controller';
import { ConviteDaAgendaService } from './convite.service';

/** O link de escolha: `AgendaConvite` e a rota pública `/agendar/:token` (lane G6). */
@Module({
  imports: [ReguaDaAgendaModule, EscritaDaAgendaModule],
  controllers: [ConviteDaAgendaController, AgendarController],
  providers: [ConviteDaAgendaService],
  exports: [ConviteDaAgendaService],
})
export class ConviteDaAgendaModule {}
