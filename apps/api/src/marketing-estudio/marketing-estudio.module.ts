import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MemoryModule } from '../memory/memoria.module';
import { PautaModule } from '../pauta/pauta.module';
import { MarketingEstudioController } from './marketing-estudio.controller';
import { MemoriaDoMarketingService } from './memoria-do-marketing.service';
import { ReguasService } from './reguas.service';
import { TriagemService } from './triagem.service';

// Marketing no jeito do ROOT Estúdio (26/10/2026). A marca e o Apify vêm da Pauta;
// o Drive (espelho da Memória no Obsidian) vem do Google; IA, transcrição e o
// registro de grupos do WhatsApp vêm de módulos globais.
@Module({
  imports: [PautaModule, GoogleModule, MemoryModule],
  controllers: [MarketingEstudioController],
  providers: [MemoriaDoMarketingService, TriagemService, ReguasService],
})
export class MarketingEstudioModule {}
