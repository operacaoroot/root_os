import { Global, Module } from '@nestjs/common';
import { ToolGateway } from './tool-gateway.service';
import { EventLogService } from './event-log.service';
import { EfeitosRegistry } from './efeitos.registry';
import { AcoesService } from './acoes.service';

// @Global e única: ADR-004 diz que a porta é a única, e regra distribuída é
// regra que diverge. Módulo que precisar dela injeta ToolGateway direto.
@Global()
@Module({
  providers: [ToolGateway, EventLogService, EfeitosRegistry, AcoesService],
  exports: [ToolGateway, EventLogService, EfeitosRegistry, AcoesService],
})
export class GatewayModule {}
