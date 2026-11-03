import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';
import { ConflitosService } from './conflitos.service';
import { ReguaController } from './regua.controller';
import { ReguaService } from './regua.service';

/**
 * As regras, o motor no servidor, os Conflitos e os Relatórios (lanes G2 e G5).
 * O `PrismaService` e o `AcessoAtualGuard` (que só usa o Prisma e o Reflector)
 * vêm dos módulos globais.
 */
@Module({
  imports: [EspelhoDaAgendaModule],
  controllers: [ReguaController],
  providers: [ReguaService, ConflitosService],
  exports: [ReguaService, ConflitosService],
})
export class ReguaDaAgendaModule {}
