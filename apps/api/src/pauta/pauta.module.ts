import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GoogleModule } from '../google/google.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PautaController } from './pauta.controller';
import { RodadaController } from './rodada.controller';
import { PautaService } from './pauta.service';
import { ApifyService } from './apify.service';
import { EspelhoService } from './espelho.service';
import { RssService } from './rss.service';
import { RodadaService } from './rodada.service';
import { RotinaService } from './rotina.service';
import { PautaSchedulerService } from './scheduler.service';
import { EvolutionService } from './evolution.service';
import { PublicacaoService } from './publicacao.service';

// Módulo Pauta — ondas 1 (acervo), 2 (rotina) e 3 (canais). Ver docs/PAUTA.md.
// GoogleModule: espelho .md no Drive. IntegrationsModule: write-back no ClickUp.
@Module({
  imports: [StorageModule, GoogleModule, IntegrationsModule],
  controllers: [PautaController, RodadaController],
  providers: [
    PautaService,
    ApifyService,
    EspelhoService,
    RssService,
    RodadaService,
    RotinaService,
    PautaSchedulerService,
    EvolutionService,
    PublicacaoService,
  ],
  // EvolutionService sai daqui para o AgentsModule ligar a capacidade
  // whatsapp.mensagem.enviar ao envio real.
  exports: [PautaService, RodadaService, EvolutionService],
})
export class PautaModule {}
