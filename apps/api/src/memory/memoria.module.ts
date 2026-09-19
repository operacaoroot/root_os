import { Module } from '@nestjs/common';
import { MemoriaController } from './memoria.controller';
import { MemoriaService } from './memoria.service';
import { AgentDataGrantService } from './agent-data-grant.service';
import { AgentMemoriaController } from './agent-memoria.controller';
import { AuthModule } from '../auth/auth.module';

/*
 * A MEMÓRIA (RF-M-01, RF-M-06) — ver `docs/adr/ADR-011-memoria.md`.
 *
 * ----------------------------------------------------------------------------
 * ONDE ELE ENTRA NA APLICAÇÃO
 * ----------------------------------------------------------------------------
 * O DONO é o `AppModule`, depois de `GatewayModule` (porque `MemoriaService`
 * injeta `EventLogService`) e antes dos módulos de domínio. A entrega da fatia
 * não pôde escrever essa linha — `src/app.module.ts` era de outro agente — e a
 * memória entrou pendurada no `ObsidianModule`; o estabilizador da onda 9 pôs a
 * linha no lugar certo.
 *
 * `ObsidianModule` CONTINUA importando este módulo, e precisa: `ObsidianService`
 * injeta `MemoriaService` para projetar a vault, e em Nest quem injeta importa.
 * As duas linhas não são duplicata — a do `AppModule` declara o DONO, a de lá
 * declara USO. O que era para sumir sumiu: a frase que dizia que o conector é
 * quem põe a memória de pé.
 *
 * A MEIA-CORREÇÃO PERIGOSA, que o caso de texto em `test/memoria.test.ts`
 * guarda: tirar a importação do `ObsidianModule` SEM esta estar no `AppModule`.
 * O módulo cai do grafo inteiro, todas as rotas `/memoria` somem, e nada acusa —
 * compila, sobe, e a tela recebe 404.
 *
 * NÃO É `@Global()`, e é decisão: quem precisa da memória é quem produz ou
 * consome contexto, e essa lista tem de ficar visível em `imports`. Global é
 * para a porta, o cofre e a régua — coisas que TODO módulo alcança.
 */
@Module({
  imports: [AuthModule],
  controllers: [MemoriaController, AgentMemoriaController],
  providers: [MemoriaService, AgentDataGrantService],
  exports: [MemoriaService, AgentDataGrantService],
})
export class MemoryModule {}
