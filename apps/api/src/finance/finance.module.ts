import { FinanceiroExercicioInscricaoController } from './financeiro-exercicio-inscricao.controller';
import { FinanceiroExercicioInscricaoService } from './financeiro-exercicio-inscricao.service';
import { ComercialPonteExercicioModule } from '../leads/comercial-ponte-exercicio.module';
import { Module } from '@nestjs/common';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { FinanceiroExercicioController } from './financeiro-exercicio.controller';
import { FinanceiroExercicioService } from './financeiro-exercicio.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';
import { AsaasService } from './asaas.service';
// Rodada dos agentes (A6): o extrato OFX no contrato único de conector.
import { OfxConector } from './ofx.conector';
import { FinopsService } from './finops.service';
import { AprService } from './apr.service';
import { ConciliacaoService } from './conciliacao.service';
import { AnaliseController } from './analise.controller';
import { AnaliseService } from './analise.service';
import { ParcelasService } from './parcelas.service';
import { PORTA_DE_COBRANCA } from '../comercial/portas/cobranca.port';

@Module({
  imports: [ComercialPonteExercicioModule],
  controllers: [FinanceController, AnaliseController, FinanceiroExercicioController, FinanceiroExercicioInscricaoController],
  providers: [
    FinanceiroExercicioInscricaoService,
    AcessoAtualGuard,
    FinanceiroExercicioService,
    FinanceService,
    PluggyService,
    AsaasService,
    OfxConector,
    FinopsService,
    AprService,
    ConciliacaoService,
    AnaliseService,
    ParcelasService,
    // Cockpit comercial (lane D): a porta de cobrança é o próprio conector do
    // Asaas, entregue por token. O comercial nunca importa o conector.
    { provide: PORTA_DE_COBRANCA, useExisting: AsaasService },
  ],
  exports: [FinanceService, FinopsService, AprService, ConciliacaoService, PORTA_DE_COBRANCA],
})
export class FinanceModule {}
