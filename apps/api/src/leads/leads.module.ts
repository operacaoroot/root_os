import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [LeadsService],
})
export class LeadsModule {}
