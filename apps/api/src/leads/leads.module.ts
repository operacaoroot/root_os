import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  // `ModulosService`: a entrada com origem da Pauta confere o módulo `pauta` (o gate de prefixo só vê `leads`).
  imports: [TenantsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [LeadsService],
})
export class LeadsModule {}
