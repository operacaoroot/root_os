import { Global, Module } from '@nestjs/common';

import { IntegrationsModule } from '../integrations/integrations.module';
import { FONTE_DO_GRANOLA } from '../work/atas/fonte-do-granola';
import { CONEXAO_DIRETA_DO_GRANOLA } from './conexao-direta';
import { GranolaDiretoController, GranolaRetornoController } from './granola-direto.controller';
import { GranolaDiretoService } from './granola-direto.service';

/*
 * O GRANOLA DIRETO (rodada da interface, 20/10/2026). Só declara: o conector,
 * os dois controladores e os dois contratos que ele cumpre, por injeção:
 *   · `FONTE_DO_GRANOLA` — a leitura das reuniões, que o banco de atas usa;
 *   · `CONEXAO_DIRETA_DO_GRANOLA` — o ciclo de vida da autorização, que o
 *     retorno do OAuth e o descritor do Granola no contrato de conectores
 *     (`ficha/granola.service.ts`) usam.
 * Ninguém fora daqui importa o serviço.
 *
 * `@Global()` porque os dois consumidores moram em módulos diferentes (o
 * Trabalho e a ficha), e o descritor do Granola é UMA inscrição no contrato:
 * importado uma vez (pelo `WorkModule`), o token chega aos dois.
 */
@Global()
@Module({
  imports: [IntegrationsModule],
  controllers: [GranolaRetornoController, GranolaDiretoController],
  providers: [
    GranolaDiretoService,
    { provide: FONTE_DO_GRANOLA, useExisting: GranolaDiretoService },
    { provide: CONEXAO_DIRETA_DO_GRANOLA, useExisting: GranolaDiretoService },
  ],
  exports: [FONTE_DO_GRANOLA, CONEXAO_DIRETA_DO_GRANOLA],
})
export class GranolaModule {}
