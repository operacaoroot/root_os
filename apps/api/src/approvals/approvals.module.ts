import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalGuard } from './approval.guard';

// @Global: o ApprovalGuard/ApprovalsService ficam disponíveis para qualquer
// controller de escrita sensível sem precisar importar o módulo em cada um.
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalGuard],
  exports: [ApprovalsService, ApprovalGuard],
})
export class ApprovalsModule {}
