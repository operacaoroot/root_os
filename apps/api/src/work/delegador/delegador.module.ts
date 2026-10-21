import { Module } from '@nestjs/common';

import { AuditModule } from '../../audit/audit.module';
import { WorkModule } from '../work.module';
import { DelegadorController } from './delegador.controller';
import { DelegadorService } from './delegador.service';

/**
 * TR-09 · O DELEGADOR (rodada dos agentes, 21/10/2026). Módulo próprio, ao lado
 * do `WorkModule` (de onde vem o `WorkService` exportado) e não dentro dele: o
 * `work.module.ts` é de outra lane nesta rodada. O modelo vem do `LlmModule`,
 * global. Sem a linha no `AppModule`, as rotas respondem 404 sem nada acusar.
 */
@Module({
  imports: [WorkModule, AuditModule],
  controllers: [DelegadorController],
  providers: [DelegadorService],
})
export class DelegadorModule {}
