import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memoria.module';
import { WorkModule } from '../work/work.module';
import { AgentesExternosController } from './agentes-externos.controller';
import { EfeitosDaCentralService } from './efeitos-da-central.service';
import { RespostaNaConversaService } from './resposta-na-conversa.service';

/*
 * ============================================================================
 * AGENTES EXTERNOS — o OS operado por um agente que roda FORA dele (30/10/2026)
 * ============================================================================
 *
 * A Rootinha roda no Hermes Agent, na mesma VPS, e opera o OS só pelas portas
 * do próprio OS. Este módulo junta o que isso pede, sem abrir caminho novo até
 * conector nenhum:
 *
 *   · os EFEITOS das capacidades da central (política 1.13.0) — cada um chama o
 *     mesmo serviço que a tela chama;
 *
 * Quem o importa é só o `AppModule`. Ele importa `AgentsModule` (o
 * `AgentRuntime`, para `agente.invocar`), `WorkModule` (tarefas e comentários)
 * e `MemoryModule` (a sugestão que vira nota); a porta, a fila, a caixa e o
 * canal chegam pelos módulos `@Global`. Ninguém importa este módulo de volta,
 * então não há ciclo.
 */
@Module({
  imports: [AgentsModule, WorkModule, MemoryModule],
  controllers: [AgentesExternosController],
  providers: [EfeitosDaCentralService, RespostaNaConversaService],
  exports: [EfeitosDaCentralService],
})
export class AgentesExternosModule {}
