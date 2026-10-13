import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';
import { AsaasService } from './asaas.service';
import { FinopsService } from './finops.service';
import { AprService } from './apr.service';
import { ConciliacaoService } from './conciliacao.service';
import { PORTA_DE_COBRANCA } from '../comercial/portas/cobranca.port';

@Module({
  controllers: [FinanceController],
  providers: [
    FinanceService,
    PluggyService,
    AsaasService,
    FinopsService,
    AprService,
    ConciliacaoService,
    // Cockpit comercial (lane D): a porta de cobrança é o próprio conector do
    // Asaas, entregue por token. O comercial nunca importa o conector.
    { provide: PORTA_DE_COBRANCA, useExisting: AsaasService },
  ],
  exports: [FinanceService, FinopsService, AprService, ConciliacaoService, PORTA_DE_COBRANCA],
})
export class FinanceModule {}
