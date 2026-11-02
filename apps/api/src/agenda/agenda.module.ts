import { Module } from '@nestjs/common';

import { RoutinesModule } from '../routines/routines.module';
import { AgendaController } from './agenda.controller';
import { ExecutorDoVigiaDaAgenda } from './vigia-da-agenda.executor';
import { VigiaDaAgendaService } from './vigia-da-agenda.service';
import { EspelhoDaAgendaModule } from './espelho/espelho.module';
import { ReguaDaAgendaModule } from './regua/regua.module';
import { EscritaDaAgendaModule } from './escrita/escrita.module';
import { ConviteDaAgendaModule } from './convite/convite.module';
import { BuscaDaAgendaModule } from './busca/busca.module';

/**
 * A AGENDA DA ROOT NO OS — o vigia (AG-01, rodada dos agentes, 21/10/2026).
 *
 * Importa `RoutinesModule` pelo registro de executores (o vigia é uma rotina
 * como as outras), como o onboarding faz; não há ciclo: `RoutinesModule` não
 * importa nada daqui. A porta, o registro de efeitos e os interruptores vêm do
 * `GatewayModule` (global), o contrato de conector do `ContratoModule` (global),
 * as pendências do `PendenciasModule` (global) e o modelo do `LlmModule`
 * (global).
 *
 * O EFEITO de `agenda.evento.padronizar` NÃO mora aqui: quem fala com o Google é
 * o conector (`google/google.service.ts`), que o inscreve no `EfeitosRegistry`.
 * O vigia só PROPÕE pela porta.
 *
 * SEM A LINHA NO `AppModule`, `GET /api/agenda/fora-do-padrao` responde 404 e a
 * rotina `agenda.vigia` fica sem executor (a tela de rotinas a marca órfã).
 */
@Module({
  // Agenda v2 (29/10/2026): o espelho e a cópia (G1, G7), a régua, os Conflitos e
  // os Relatórios (G2, G5), a escrita no Google (G4), o link de escolha (G6) e a
  // busca do cliente do painel (G3).
  imports: [
    RoutinesModule,
    EspelhoDaAgendaModule,
    ReguaDaAgendaModule,
    EscritaDaAgendaModule,
    ConviteDaAgendaModule,
    BuscaDaAgendaModule,
  ],
  controllers: [AgendaController],
  providers: [VigiaDaAgendaService, ExecutorDoVigiaDaAgenda],
  exports: [VigiaDaAgendaService],
})
export class AgendaModule {}
