import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { AuthModule } from '../auth/auth.module';
import { MemoryModule } from '../memory/memoria.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/*
 * O DEGRAU DE ENTRADA — RF-O-01, RF-O-02, RF-M-05.
 *
 * ONDE ELE PRECISA ENTRAR NO `AppModule`, e por quê:
 *
 *   import { OnboardingModule } from './onboarding/onboarding.module';
 *   …
 *   AgentsModule,
 *   OnboardingModule,   // <— depois de AgentsModule e de MemoryModule
 *   AuthModule,
 *
 * `src/app.module.ts` é arquivo de outra fatia nesta onda e não foi editado
 * aqui — a linha está no relatório, em FORA DO ESCOPO. **Sem ela o módulo não
 * existe**: as rotas somem, o cadastro responde 404 e nada acusa. É o mesmo
 * acidente que deixou a memória pendurada no conector do Obsidian na onda 9 e
 * o cofre inalcançável na fatia 5.3 — código inteiro, correto e fora do
 * alcance de qualquer chamador.
 *
 * AS QUATRO IMPORTAÇÕES, uma a uma:
 *   · `TenantsModule` exporta `ProvisionamentoService`, que é quem faz a
 *     empresa existir. A entrada NÃO reescreve provisionamento;
 *   · `MemoryModule` exporta `MemoriaService`, que é quem grava nota com
 *     versão, procedência e RASTRO. A entrada NÃO reescreve memória;
 *   · `AgentsModule` exporta `AgentRuntime`, para a pergunta livre rodar pelo
 *     laço de verdade — com sessão, teto de custo e a marca de procedência que
 *     a onda 10 ligou;
 *   · `AuthModule` por causa do `JwtAuthGuard` das rotas autenticadas. A rota
 *     de cadastro é anônima de propósito e por isso os guardas são declarados
 *     POR MÉTODO, nunca na classe.
 *
 * `EventLogService` e `AuditService` vêm de módulos `@Global` (`GatewayModule`
 * e `AuditModule`) — nada a importar.
 */
@Module({
  imports: [TenantsModule, MemoryModule, AgentsModule, AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
