import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';
import { WorkModule } from '../work/work.module';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoService } from './atendimento.service';
import { EntradaDoAtendimentoService } from './entrada-do-atendimento.service';

// Dia a dia › Conversas: a caixa de atendimento por WhatsApp (adaptada do FinOps
// em 19/10/2026, ver docs/ATENDIMENTO-FINOPS.md). Não importa conector nenhum:
// o WhatsApp chega pelo `WhatsappDoAtendimentoRegistry` e a resposta sai pela
// porta. Os registros do canal e a porta vêm de módulos globais.
@Module({
  imports: [StorageModule, WorkModule],
  controllers: [AtendimentoController],
  providers: [AtendimentoService, EntradaDoAtendimentoService],
})
export class AtendimentoModule {}
