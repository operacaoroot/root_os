import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { AuthModule } from '../auth/auth.module';
import { MemoryModule } from '../memory/memoria.module';
import { RoutinesModule } from '../routines/routines.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { LeituraDaAtaService } from './trilho/leitura-da-ata.service';
import { LinkPublicoController } from './trilho/link-publico.controller';
import { LinkPublicoService } from './trilho/link-publico.service';
import { ExecutorDoRelogioDoOnboarding } from './trilho/relogio.executor';
import { KitDoTrilhoService } from './trilho/kit/kit.service';
import { TrilhoService } from './trilho/trilho.service';
import { TrilhosController } from './trilho/trilhos.controller';

/*
 * DUAS METADES NO MESMO MÓDULO. A entrada (`/entrar`, o cliente sozinho) e o
 * trilho (a bancada da ROOT + o link público) escrevem a MESMA memória com as
 * MESMAS chaves — separá-los em módulos daria duas verdades sobre "este tema
 * foi carregado?". Ver `docs/ONBOARDING.md`.
 *
 * `RoutinesModule` entra pelo registro de executores (o relógio do onboarding
 * é uma rotina como as outras). Não há ciclo: `RoutinesModule` não importa
 * este módulo. O `LlmModule` é global — o leitor de ata e a transcrição vêm
 * de lá sem import.
 */
@Module({
  imports: [TenantsModule, MemoryModule, AgentsModule, AuthModule, RoutinesModule],
  controllers: [OnboardingController, TrilhosController, LinkPublicoController],
  providers: [OnboardingService, TrilhoService, LeituraDaAtaService, LinkPublicoService, ExecutorDoRelogioDoOnboarding, KitDoTrilhoService],
  exports: [OnboardingService, TrilhoService],
})
export class OnboardingModule {}
