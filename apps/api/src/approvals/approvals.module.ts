import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalGuard } from './approval.guard';
import { LotesService } from './lotes.service';
import { AssinaturaDeLoteService } from './assinatura-de-lote.service';
import { LotesController } from './lotes.controller';
import { AuthModule } from '../auth/auth.module';
import { CanaisModule } from '../gateway/canais/canais.module';
import { LimpezaDasVencidasService } from './limpeza-das-vencidas';
import { RepedidosRegistry } from './repedidos.registry';

// @Global: o ApprovalGuard/ApprovalsService ficam disponíveis para qualquer
// controller de escrita sensível sem precisar importar o módulo em cada um.
//
// O import do AuthModule é o que traz o `ReauthService`: confirmar uma aprovação
// R4/R5 passou a exigir que a pessoa PROVE de novo quem é, e quem sabe conferir
// isso é o módulo de autenticação. Não há ciclo — o AuthModule não conhece
// aprovação nenhuma —, e o `AppModule` continua carregando este módulo antes do
// AuthModule sem problema: o Nest resolve o grafo, não a ordem da lista.
/*
 * `CanaisModule` entra no `imports` por uma razão de fiação, e ela está escrita
 * no cabeçalho daquele módulo: ele é `@Global` e não importa NINGUÉM, então
 * alguém precisa pô-lo no grafo para o controlador do webhook existir — e o
 * `AppModule` não é arquivo desta fatia. A aresta é segura porque não volta:
 * `CanaisModule` alcança `ApprovalsService` pelo escopo global, sem importar
 * este módulo de volta.
 *
 * Estar no grafo NÃO liga o canal: sem os DOIS segredos do canal
 * (`CANAL_APROVACAO_SEGREDO`, que autentica o webhook, e
 * `CANAL_APROVACAO_CODIGO_SEGREDO`, que deriva o código) e sem transporte
 * inscrito, o webhook responde 404 e nenhum pedido sai.
 */
@Global()
@Module({
  imports: [AuthModule, CanaisModule],
  controllers: [ApprovalsController, LotesController],
  // MD7: o lote de aprovação. `LotesService` não conhece a porta (a porta o
  // injeta para o consumo contado); `AssinaturaDeLoteService` fala com a porta
  // e inscreve o efeito que ativa o lote. Os dois globais daqui e do
  // GatewayModule se enxergam sem import de módulo, e sem ciclo de provider.
  //
  // T7 (rodada do trabalho): o registro do "pedir de novo" (os domínios se
  // inscrevem, a fila pergunta) e a limpeza diária das vencidas (o executor da
  // rotina mora em `routines/executores`, e o agendador semeia por aqui).
  providers: [ApprovalsService, ApprovalGuard, LotesService, AssinaturaDeLoteService, RepedidosRegistry, LimpezaDasVencidasService],
  exports: [ApprovalsService, ApprovalGuard, LotesService, RepedidosRegistry, LimpezaDasVencidasService],
})
export class ApprovalsModule {}
