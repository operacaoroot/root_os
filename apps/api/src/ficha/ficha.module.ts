import { Module } from '@nestjs/common';
import { FichaController } from './ficha.controller';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';
import { ContratosDoClienteService } from './contratos-do-cliente.service';
import { GranolaController } from './granola.controller';
import { GranolaService } from './granola.service';

@Module({
  controllers: [FichaController, GranolaController],
  providers: [FichaService, JornadaService, TarefasDoClienteService, ContratosDoClienteService, GranolaService],
  exports: [ContratosDoClienteService],
})
export class FichaModule {}
