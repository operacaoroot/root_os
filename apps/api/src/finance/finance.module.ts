import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PluggyService } from './pluggy.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, PluggyService],
  exports: [FinanceService],
})
export class FinanceModule {}
