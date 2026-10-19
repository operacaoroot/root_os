import { Module } from '@nestjs/common';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { CheckoutDeTarefaService } from './checkout-de-tarefa.service';
import { AuditModule } from '../audit/audit.module';
import { WorkFilesController } from './work-files.controller';
import { WorkFilesService } from './work-files.service';
import { MemoryModule } from '../memory/memoria.module';
import { AtasController } from './atas/atas.controller';
import { AtasService } from './atas/atas.service';
import { MovimentoDoQuadroService } from './movimento-do-quadro.service';

/**
 * O CHECKOUT É EXPORTADO, e a exportação é a fatia A4 pela metade.
 *
 * `AgentsModule` importa este módulo para que pausar ou encerrar um agente
 * SOLTE as tarefas que ele tem na mão (ver `soltarTodasDoAgente`). A direção é
 * esta e não a inversa de propósito: quem conhece `WorkTask` é o módulo de
 * trabalho, e um `WorkService` escrevendo em `Agent` — ou um `AgentsService`
 * escrevendo em `WorkTask` — daria dois donos para a mesma coluna. Não há ciclo:
 * este módulo não importa `AgentsModule`; o que ele usa de lá é o arquivo de
 * regras de estado (`agents/estado-do-agente.ts`), que não tem injeção nenhuma.
 *
 * O `EventLogService` (assumir e soltar entram no RASTRO) NÃO aparece nos
 * `imports`: `GatewayModule` é `@Global`, então ele chega sem importação — e
 * importá-lo aqui só daria a impressão falsa de que esta é a dependência que
 * sustenta o módulo. Ele é `@Optional()` no construtor do serviço, o que
 * permite a uma suíte montá-lo sem rastro; o que não pode é a API subir sem,
 * porque aí checkout não deixaria marca nenhuma.
 */
/*
 * O BANCO DE ATAS (rodada do painel P3, 18/10/2026) mora aqui porque aceitar uma
 * sugestão é criar tarefa pelo `WorkService`. `MemoryModule` entra nos imports
 * porque a ata colada vira nota da memória pelo `MemoriaService` (ADR-011); o
 * provider de modelo chega pelo `LlmModule`, que é global.
 */
@Module({
  imports: [AuditModule, MemoryModule],
  controllers: [WorkController, WorkFilesController, AtasController],
  providers: [WorkService, CheckoutDeTarefaService, WorkFilesService, AtasService, MovimentoDoQuadroService],
  exports: [CheckoutDeTarefaService, WorkService],
})
export class WorkModule {}
