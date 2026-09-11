import { Module } from '@nestjs/common';
import { PautaModule } from '../pauta/pauta.module';
import { ExecutoresDeRotinaRegistry } from './executores.registry';
import { ExecutorDePauta } from './executores/pauta.executor';
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
 */
@Module({
  imports: [PautaModule],
  controllers: [RotinasController],
  providers: [ExecutoresDeRotinaRegistry, ExecutorDePauta, RotinasService, RotinasScheduler],
  exports: [RotinasService, ExecutoresDeRotinaRegistry],
})
export class RoutinesModule {}
