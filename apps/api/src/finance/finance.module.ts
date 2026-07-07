import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';
import { FinopsService } from './finops.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, PluggyService, FinopsService],
  exports: [FinanceService, FinopsService],
})
export class FinanceModule {}
