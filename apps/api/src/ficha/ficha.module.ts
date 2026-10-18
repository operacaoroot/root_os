import { Module } from '@nestjs/common';
import { FichaController } from './ficha.controller';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';
import { ContratosDoClienteService } from './contratos-do-cliente.service';

@Module({
  controllers: [FichaController],
  providers: [FichaService, JornadaService, TarefasDoClienteService, ContratosDoClienteService],
  exports: [ContratosDoClienteService],
})
export class FichaModule {}
