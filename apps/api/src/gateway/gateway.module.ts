import { Global, Module } from '@nestjs/common';
import { ToolGateway } from './tool-gateway.service';
import { EventLogService } from './event-log.service';
import { EfeitosRegistry } from './efeitos.registry';
import { InterruptoresRegistry } from './interruptores.registry';
import { AcoesService } from './acoes.service';
import { PortaDoOperador } from './porta-do-operador.service';
import { ConectoresConfiguradosRegistry } from './conectores-configurados.registry';

// @Global e única: ADR-004 diz que a porta é a única, e regra distribuída é
// regra que diverge. Módulo que precisar dela injeta ToolGateway direto.
//
// `InterruptoresRegistry` é exportado porque quem PREENCHE a consulta mora
// fora daqui (`integrations/conectores.service.ts`): é ele que se inscreve no
// arranque. A dependência vai do módulo de integrações para o da porta — a
// direção que já existe. O contrário fecharia ciclo e a aplicação não subiria.
@Global()
@Module({
  providers: [
    ToolGateway,
    EventLogService,
    EfeitosRegistry,
    InterruptoresRegistry,
    AcoesService,
    // A porta para quem clica na tela (fatia 3.3). Exportada porque quem a usa
    // são os controladores dos módulos de domínio — é o caminho HTTP que até
    // então alcançava conector sem passar por classificação nenhuma.
    PortaDoOperador,
    // Quem responde se um conector está configurado (fatia 3.3, frente 4).
    // Aqui pelo mesmo motivo do registro de interruptores: o módulo é @Global,
    // então conector nenhum precisa importar nada para se inscrever.
    ConectoresConfiguradosRegistry,
  ],
  exports: [
    ToolGateway,
    EventLogService,
    EfeitosRegistry,
    InterruptoresRegistry,
    AcoesService,
    PortaDoOperador,
    ConectoresConfiguradosRegistry,
  ],
})
export class GatewayModule {}
