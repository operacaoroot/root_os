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
import { MarcaController } from './marca.controller';
import { MarcaService } from './marca.service';
import { ConcorrentesController } from './concorrentes.controller';
import { ConcorrentesService } from './concorrentes.service';
import { EstrategiaController } from './estrategia.controller';
import { EstrategiaService } from './estrategia.service';
import { RelatorioController } from './relatorio.controller';
import { RelatorioService } from './relatorio.service';
import { PacoteController } from './pacote.controller';
import { PacoteService } from './pacote.service';
import { BioModule } from '../bio/bio.module';
import { PaginaDeLinksController } from './pagina-de-links.controller';
import { PaginaDeLinksService } from './pagina-de-links.service';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { DerivacaoController } from './derivacao.controller';
import { DerivacaoService } from './derivacao.service';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { EncadeamentoController } from './encadeamento.controller';
import { EncadeamentoService } from './encadeamento.service';
import { TenantsModule } from '../tenants/tenants.module';
import { MidiaPublicaController, MidiaPublicaDaPecaController } from './midia-publica.controller';
import { MidiaPublicaService } from './midia-publica.service';
import { ContaDePublicacaoController } from './conta-de-publicacao.controller';
import { PublicacaoInstagramController } from './publicacao-instagram.controller';
import { PublicacaoInstagramService } from './publicacao-instagram.service';
import { GraphDePublicacaoModule } from '../bio/plataformas/publicacao.module';
import { YoutubeModule } from '../youtube/youtube.module';
import { EnvioAoYoutubeService } from './envio-ao-youtube.service';
import { EnvioAoYoutubeController, YoutubeDaPautaController } from './envio-ao-youtube.controller';
import { LoteDaSemanaController } from './lote-da-semana.controller';
import { LoteDaSemanaService } from './lote-da-semana.service';
import { ComentariosController } from './comentarios.controller';
import { ComentariosService } from './comentarios.service';
import { DmAutomaticaService } from './dm-automatica.service';

// Módulo Pauta — ondas 1 (acervo), 2 (rotina) e 3 (canais). Ver docs/PAUTA.md.
// GoogleModule: espelho .md no Drive. IntegrationsModule: write-back no ClickUp.
// MemoryModule: o roteiro (MC8) LÊ a palavra de corte da empresa na memória, e
// a voz do autor (MC10) é nota da memória, escrita pelo MemoriaService (ADR-011).
// BioModule: a página de links do episódio (MC12) publica pelo BioService, e a
// conta de publicação do Instagram (MD5) é uma conexão da bio.
// A grade da semana (MC16) também é nota da memória, escrita pelo MemoriaService.
// TenantsModule: a rota pública da mídia (MD4) confere se a empresa do token
// ainda tem o módulo pauta — requisição anônima passa pelo gate de módulos.
// GraphDePublicacaoModule: os clientes da Graph que o publicador do Instagram
// (MD6), o coletor de comentários (MD9) e a DM automática (MD11) recebem por
// injeção; o HTTP mora no conector da bio.
// YoutubeModule: o cliente do YouTube (MD10) que o envio recebe por injeção; o
// HTTP e a credencial moram no conector, e o retorno do OAuth também.
@Module({
  imports: [StorageModule, GoogleModule, IntegrationsModule, MemoryModule, BioModule, TenantsModule, GraphDePublicacaoModule, YoutubeModule],
  // MidiaController ANTES do EpisodioController: `GET pendentes-midia` tem de
  // casar antes do `GET :id` de lá (Express casa na ordem de registro).
  controllers: [
    PautaController,
    RodadaController,
    MidiaController,
    EpisodioController,
    RoteiroController,
    VozController,
    MarcaController,
    ConcorrentesController,
    EstrategiaController,
    RelatorioController,
    PacoteController,
    PaginaDeLinksController,
    NewsletterController,
    DerivacaoController,
    AgendaController,
    EncadeamentoController,
    MidiaPublicaDaPecaController,
    MidiaPublicaController,
    ContaDePublicacaoController,
    PublicacaoInstagramController,
    LoteDaSemanaController,
    ComentariosController,
    YoutubeDaPautaController,
    EnvioAoYoutubeController,
  ],
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
    // MK1: a marca e os pilares, que o roteiro e as peças recebem ao lado da voz.
    MarcaService,
    // MK2: a mediana e o índice dos perfis raspados, e o dossiê por IA.
    ConcorrentesService,
    // MK4: o documento do mês, proposto pela IA e editado por gente.
    EstrategiaService,
    // MK6: o fechamento do mês — número do sistema, narrativa da IA.
    RelatorioService,
    // MC11: o pacote do YouTube (títulos, descrição com capítulos, thumbs).
    PacoteService,
    // MC12: a página de links do episódio na bio.
    PaginaDeLinksService,
    // MC13: a newsletter tirada da transcrição, exportada para envio manual (D-MC7).
    NewsletterService,
    // MC15: a semana de posts — carrossel, story e corte por matéria do episódio.
    DerivacaoService,
    // MC16: o calendário da semana — a grade, os slots e a postagem manual.
    AgendaService,
    // MD1: a transcrição anda sozinha até a semana em rascunho (rotina pauta.encadear).
    EncadeamentoService,
    // MD4: a mídia da peça numa URL pública assinada, de prazo curto, para a Meta baixar.
    MidiaPublicaService,
    // MD6: o publicador do Instagram — o efeito de instagram.post.publicar e a conclusão pela rotina.
    PublicacaoInstagramService,
    // MD8: a semana num lote só, assinado por outra pessoa; reage à ativação do lote por registro.
    LoteDaSemanaService,
    // MD9: a fila da DM à mão — o efeito de instagram.comentario.ler e a gravação pela rotina.
    ComentariosService,
    // MD10: o vídeo do episódio no YouTube — a sessão do Mac, os efeitos de envio e de agendamento.
    EnvioAoYoutubeService,
    // MD11: a DM automática sob o lote — os efeitos de responder e de pausar, e a passagem da rotina.
    DmAutomaticaService,
  ],
  // EvolutionService sai daqui para o AgentsModule ligar a capacidade
  // whatsapp.mensagem.enviar ao envio real. EncadeamentoService e
  // PublicacaoInstagramService e ComentariosService, para os executores das
  // rotinas (RoutinesModule).
  // MK6: `RelatorioService` sai daqui porque o executor da rotina mensal vive
  // no RoutinesModule, como o da coleta já fazia com o RodadaService.
  exports: [PautaService, RodadaService, EvolutionService, EncadeamentoService, PublicacaoInstagramService, ComentariosService, EnvioAoYoutubeService, DmAutomaticaService, RelatorioService],
})
export class PautaModule {}
