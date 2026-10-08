import { ComercialPonteExercicioModule } from '../leads/comercial-ponte-exercicio.module';
import { Module } from '@nestjs/common';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { FinanceiroExercicioController } from './financeiro-exercicio.controller';
import { FinanceiroExercicioService } from './financeiro-exercicio.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';
import { AsaasService } from './asaas.service';
import { FinopsService } from './finops.service';
import { AprService } from './apr.service';
import { ConciliacaoService } from './conciliacao.service';

@Module({
  imports: [ComercialPonteExercicioModule],
  controllers: [FinanceController, FinanceiroExercicioController],
  providers: [AcessoAtualGuard, FinanceiroExercicioService, FinanceService, PluggyService, AsaasService, FinopsService, AprService, ConciliacaoService],
  exports: [FinanceService, FinopsService, AprService, ConciliacaoService],
})
export class FinanceModule {}
