import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalGuard } from './approval.guard';
import { AuthModule } from '../auth/auth.module';

// @Global: o ApprovalGuard/ApprovalsService ficam disponíveis para qualquer
// controller de escrita sensível sem precisar importar o módulo em cada um.
//
// O import do AuthModule é o que traz o `ReauthService`: confirmar uma aprovação
// R4/R5 passou a exigir que a pessoa PROVE de novo quem é, e quem sabe conferir
// isso é o módulo de autenticação. Não há ciclo — o AuthModule não conhece
// aprovação nenhuma —, e o `AppModule` continua carregando este módulo antes do
// AuthModule sem problema: o Nest resolve o grafo, não a ordem da lista.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalGuard],
  exports: [ApprovalsService, ApprovalGuard],
})
export class ApprovalsModule {}
