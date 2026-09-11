import { Global, Module } from '@nestjs/common';
import { ToolGateway } from './tool-gateway.service';
import { EventLogService } from './event-log.service';
import { EfeitosRegistry } from './efeitos.registry';
import { InterruptoresRegistry } from './interruptores.registry';
import { AcoesService } from './acoes.service';

// @Global e única: ADR-004 diz que a porta é a única, e regra distribuída é
// regra que diverge. Módulo que precisar dela injeta ToolGateway direto.
//
// `InterruptoresRegistry` é exportado porque quem PREENCHE a consulta mora
// fora daqui (`integrations/conectores.service.ts`): é ele que se inscreve no
// arranque. A dependência vai do módulo de integrações para o da porta — a
// direção que já existe. O contrário fecharia ciclo e a aplicação não subiria.
@Global()
@Module({
  providers: [ToolGateway, EventLogService, EfeitosRegistry, InterruptoresRegistry, AcoesService],
  exports: [ToolGateway, EventLogService, EfeitosRegistry, InterruptoresRegistry, AcoesService],
})
export class GatewayModule {}
