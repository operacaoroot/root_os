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
import { MidiaController } from './midia.controller';
import { MidiaService } from './midia.service';
import { VozController } from './voz.controller';
import { VozService } from './voz.service';

// Módulo Pauta — ondas 1 (acervo), 2 (rotina) e 3 (canais). Ver docs/PAUTA.md.
// GoogleModule: espelho .md no Drive. IntegrationsModule: write-back no ClickUp.
// MemoryModule: o roteiro (MC8) LÊ a palavra de corte da empresa na memória, e
// a voz do autor (MC10) é nota da memória, escrita pelo MemoriaService (ADR-011).
@Module({
  imports: [StorageModule, GoogleModule, IntegrationsModule, MemoryModule],
  // MidiaController ANTES do EpisodioController: `GET pendentes-midia` tem de
  // casar antes do `GET :id` de lá (Express casa na ordem de registro).
  controllers: [PautaController, RodadaController, MidiaController, EpisodioController, RoteiroController, VozController],
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
    // MC9: a estação de mídia do Mac devolve o leve (arquivos, cortes, transcrição).
    MidiaService,
    // MC10: o perfil de voz do autor, que o roteiro e as peças recebem.
    VozService,
  ],
  // EvolutionService sai daqui para o AgentsModule ligar a capacidade
  // whatsapp.mensagem.enviar ao envio real.
  exports: [PautaService, RodadaService, EvolutionService],
})
export class PautaModule {}
