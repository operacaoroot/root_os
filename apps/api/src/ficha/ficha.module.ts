import { Module } from '@nestjs/common';
import { FichaController } from './ficha.controller';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';
import { ContratosDoClienteService } from './contratos-do-cliente.service';
import { GranolaController } from './granola.controller';
import { GranolaService } from './granola.service';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  // Integrações: o interruptor de conector (`ConectoresService`) que o Granola obedece.
  imports: [IntegrationsModule],
  controllers: [FichaController, GranolaController],
  providers: [FichaService, JornadaService, TarefasDoClienteService, ContratosDoClienteService, GranolaService],
  exports: [ContratosDoClienteService],
})
export class FichaModule {}
