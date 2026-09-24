import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GoogleModule } from '../google/google.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PautaController } from './pauta.controller';
import { RodadaController } from './rodada.controller';
import { EpisodioController } from './episodio.controller';
import { PautaService } from './pauta.service';
import { ApifyService } from './apify.service';
import { EspelhoService } from './espelho.service';
import { RssService } from './rss.service';
import { RodadaService } from './rodada.service';
import { RotinaService } from './rotina.service';
import { PautaSchedulerService } from './scheduler.service';
import { EvolutionService } from './evolution.service';
import { PublicacaoService } from './publicacao.service';
import { EntradaDeLinksService } from './entrada-de-links.service';
import { ColetaService } from './coleta.service';
import { ColetorGmailService } from './coletor-gmail.service';
import { EpisodioService } from './episodio.service';
import { RoteiroController } from './roteiro.controller';
import { RoteiroService } from './roteiro.service';
import { MemoryModule } from '../memory/memoria.module';

// Módulo Pauta — ondas 1 (acervo), 2 (rotina) e 3 (canais). Ver docs/PAUTA.md.
// GoogleModule: espelho .md no Drive. IntegrationsModule: write-back no ClickUp.
// MemoryModule: o roteiro (MC8) LÊ a palavra de corte da empresa na memória.
@Module({
  imports: [StorageModule, GoogleModule, IntegrationsModule, MemoryModule],
  controllers: [PautaController, RodadaController, EpisodioController, RoteiroController],
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
    // MC1: o grupo de links do WhatsApp entra pelo webhook do canal, por registro.
    EntradaDeLinksService,
    // MC2: despacho da coleta por tipo de fonte; o Gmail é lido pela porta (R0).
    ColetaService,
    ColetorGmailService,
    // MC7: o episódio que nasce da rodada curada.
    EpisodioService,
    // MC8: o roteiro do episódio, gerado dos itens mantidos.
    RoteiroService,
  ],
  // EvolutionService sai daqui para o AgentsModule ligar a capacidade
  // whatsapp.mensagem.enviar ao envio real.
  exports: [PautaService, RodadaService, EvolutionService],
})
export class PautaModule {}
