import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memoria.module';
import { ComercialExercicioService } from './comercial-exercicio.service';
import { TenantsModule } from '../tenants/tenants.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  // `ModulosService`: a entrada com origem da Pauta confere o módulo `pauta` (o gate de prefixo só vê `leads`).
  imports: [TenantsModule, MemoryModule],
  controllers: [LeadsController],
  providers: [LeadsService, ComercialExercicioService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [LeadsService],
})
export class LeadsModule {}
