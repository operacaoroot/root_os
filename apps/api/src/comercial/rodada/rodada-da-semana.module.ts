import { Module } from '@nestjs/common';

import { PainelComercialService } from '../../painel-comercial/painel-comercial.service';
import { WorkModule } from '../../work/work.module';
import { TarefasDoComercialService } from '../tarefas/tarefas-do-comercial.service';
import { RodadaDaSemanaController } from './rodada-da-semana.controller';
import { RodadaDaSemanaService } from './rodada-da-semana.service';

/*
 * Layout 26/10: a Rodada da semana (Comercial) num módulo pequeno, só de leitura.
 * Os dois serviços que ela reaproveita (o Painel geral e as tarefas do comercial)
 * entram como providers daqui: os módulos deles não os exportam, e os dois só
 * dependem do Prisma, da auditoria (globais) e do `WorkService` (WorkModule).
 */
@Module({
  imports: [WorkModule],
  controllers: [RodadaDaSemanaController],
  providers: [RodadaDaSemanaService, PainelComercialService, TarefasDoComercialService],
})
export class RodadaDaSemanaModule {}
