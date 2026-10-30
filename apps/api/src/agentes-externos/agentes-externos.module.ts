import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memoria.module';
import { WorkModule } from '../work/work.module';
import { AgentesExternosController } from './agentes-externos.controller';
import { CorpoExternoController } from './corpo-externo.controller';
import { CorpoExternoService } from './corpo-externo.service';
import { CorpoOuSessaoGuard } from './corpo-ou-sessao.guard';
import { CatalogoExternoService } from './catalogo-externo.service';
import { EfeitosDaCentralService } from './efeitos-da-central.service';
import { ExecucaoExternaService } from './execucao-externa.service';
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
 *   · a ROTA DE EXECUÇÃO (A2): uma capacidade por vez, pela porta, com o
 *     `ExecCtx` que o laço do agente montaria (`execucao-externa.service.ts`);
 *   · o CORPO (A4): o token do processo de fora, vinculado a empresa + agente +
 *     pessoa padrão, só com o hash no banco (`corpo-externo.service.ts`), e o
 *     guarda que aceita o token nas rotas do próprio agente
 *     (`corpo-ou-sessao.guard.ts`); as leituras declaradas passam pelo
 *     `JwtAuthGuard` de sempre (`auth/corpo-externo.ts`);
 *   · o CATÁLOGO e a DEFINIÇÃO do agente (A3), de onde o MCP do modo catálogo
 *     gera as ferramentas e o corpo tira missão, procedimento e voz;
 *
 * Quem o importa é só o `AppModule`. Ele importa `AgentsModule` (o
 * `AgentRuntime`, para `agente.invocar`), `WorkModule` (tarefas e comentários)
 * e `MemoryModule` (a sugestão que vira nota); a porta, a fila, a caixa e o
 * canal chegam pelos módulos `@Global`. Ninguém importa este módulo de volta,
 * então não há ciclo.
 */
@Module({
  imports: [AgentsModule, WorkModule, MemoryModule],
  controllers: [CorpoExternoController, AgentesExternosController],
  providers: [EfeitosDaCentralService, RespostaNaConversaService, ExecucaoExternaService, CorpoExternoService, CorpoOuSessaoGuard, CatalogoExternoService],
  exports: [EfeitosDaCentralService],
})
export class AgentesExternosModule {}
