import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';
import { FinopsService } from './finops.service';
import { AprService } from './apr.service';
import { ConciliacaoService } from './conciliacao.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, PluggyService, FinopsService, AprService, ConciliacaoService],
  exports: [FinanceService, FinopsService, AprService, ConciliacaoService],
})
export class FinanceModule {}
