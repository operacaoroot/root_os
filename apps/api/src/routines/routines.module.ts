import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PautaModule } from '../pauta/pauta.module';
import { ExecutoresDeRotinaRegistry } from './executores.registry';
import { ExecutorDePauta } from './executores/pauta.executor';
import { ExecutorDeColetaDaPauta } from './executores/pauta-coleta.executor';
import { ExecutorDeEncadeamentoDaPauta } from './executores/pauta-encadear.executor';
import { RotinasController } from './rotinas.controller';
import { RotinasScheduler } from './rotinas.scheduler';
import { RotinasService } from './rotinas.service';

/**
 * AS ROTINAS — RF-N-04.
 *
 * O agendamento que morava dentro do módulo de pauta, generalizado: rotinas por
 * empresa, com estado declarado e histórico de execução.
 *
 * IMPORTA `PautaModule` porque o executor da pauta precisa do `RodadaService`,
 * que aquele módulo já exporta. A direção é esta e não a inversa de propósito:
 * o módulo de rotinas conhece os executores que inscreve; o módulo de pauta
 * continua sem saber que existe um agendador. Quem quiser registrar um executor
 * novo (o indexador do vault, o sincronizador do ClickUp, o coletor da bio)
 * acrescenta um provider aqui e inscreve no `onModuleInit` dele — o registro
 * RECUSA inscrição dupla, e o arranque é onde isso tem de aparecer.
 *
 * PRECISA SER REGISTRADO EM `app.module.ts`. Sem isso não há tique, não há tela
 * e a rotina da pauta não dispara — o que sobrou do agendador antigo grita no
 * arranque exatamente para esse caso (ver `sinal-do-agendador.ts`).
 *
 * IMPORTA `BillingModule` (fatia 6.2, RF-O-03) porque o agendador pergunta o
 * ESTADO DE ACESSO da empresa antes de disparar qualquer rotina dela. O gate de
 * suspensão é um interceptor de requisição e o tique não é requisição: sem esta
 * aresta, empresa suspensa continuava com os agentes rodando, gastando o teto de
 * modelo da ROOT e publicando para fora em nome dela. A direção é esta e não a
 * inversa: cobrança não sabe que existe agendador, e `BillingModule` exporta
 * `AssinaturaService` justamente para ser consultado de fora.
 *
 * IMPORTAR DUAS VEZES NÃO DUPLICA NADA: módulo do Nest é instância única por
 * aplicação, então o `APP_INTERCEPTOR` que `BillingModule` declara continua
 * sendo registrado uma vez só, aqui e no `AppModule`.
 */
@Module({
  imports: [PautaModule, BillingModule],
  controllers: [RotinasController],
  providers: [
    ExecutoresDeRotinaRegistry,
    ExecutorDePauta,
    ExecutorDeColetaDaPauta,
    ExecutorDeEncadeamentoDaPauta,
    RotinasService,
    RotinasScheduler,
  ],
  exports: [RotinasService, ExecutoresDeRotinaRegistry],
})
export class RoutinesModule {}
