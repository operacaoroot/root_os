import { Module } from '@nestjs/common';

import { EscritaDaAgendaModule } from '../escrita/escrita.module';
import { ReguaDaAgendaModule } from '../regua/regua.module';

/** O link de escolha: `AgendaConvite` e a rota pública `/agendar/:token` (lane G6). */
@Module({
  imports: [ReguaDaAgendaModule, EscritaDaAgendaModule],
})
export class ConviteDaAgendaModule {}
