import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { LeadsModule } from '../leads/leads.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RoutinesModule } from '../routines/routines.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ComercialController } from './comercial.controller';
import { FioService, ReacoesRegistry } from './fio.service';
import { RelogioComercialRegistry } from './relogio.registry';
import { DinheiroController, WebhooksDoDinheiroController } from './dinheiro.controller';
import { InteligenciaController } from './inteligencia.controller';
import { SalaController } from './sala.controller';
import { SimuladorController } from './simulador.controller';

/*
 * O COCKPIT DO LEAD — módulo comercial (13/10/2026).
 *
 * Prefixos `comercial` e `sala`, governados pelo módulo `leads` (ver
 * `tenants/modulos.ts`). O fio do lead é o `LeadEvent` (`LeadsModule`); o
 * fechamento abre o trilho (`OnboardingModule`), cria o contrato
 * (`FinanceModule`) e o relógio comercial é uma rotina (`RoutinesModule`).
 * `GatewayModule`, `CanaisModule`, `LlmModule` e `ApprovalsModule` são globais e
 * chegam sem import: toda escrita externa passa pela `PortaDoOperador`.
 *
 * Os controllers são separados POR LANE da passagem, para as lanes não
 * disputarem o mesmo arquivo: `comercial` (espinha e fila), `sala` e
 * `simulador` (sala do cliente e WhatsApp por porta), `dinheiro` (cobrança,
 * assinatura, fechamento, contrato vivo) e `inteligencia` (diagnóstico,
 * proposta, torre e relatório). Cada lane acrescenta os seus providers no
 * bloco marcado abaixo.
 */
@Module({
  imports: [TenantsModule, AuthModule, LeadsModule, OnboardingModule, FinanceModule, RoutinesModule],
  controllers: [ComercialController, SalaController, SimuladorController, DinheiroController, WebhooksDoDinheiroController, InteligenciaController],
  providers: [
    // --- orquestrador: o fio (único caminho de escrita de fato) e o registro de reações ---
    ReacoesRegistry,
    FioService,
    RelogioComercialRegistry,
    // --- lane A (espinha: ficha, reações, decisões, relógio) ---
    // --- lane B (sala, WhatsApp por porta, simulador) ---
    // --- lane D (cobrança, assinatura, fechamento, contrato vivo) ---
    // --- lane E (inteligência: stub/ponte, diagnóstico, proposta, relator, vigia) ---
  ],
  exports: [FioService, ReacoesRegistry, RelogioComercialRegistry],
})
export class ComercialModule {}
