import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { LeadsModule } from '../leads/leads.module';
import { MemoryModule } from '../memory/memoria.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RoutinesModule } from '../routines/routines.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ComercialController } from './comercial.controller';
import { FioService, ReacoesRegistry } from './fio.service';
import { RelogioComercialRegistry } from './relogio.registry';
import { ConfigComercialService } from './config.service';
import { DecisoesRegistry, DecisoesService } from './decisoes.service';
import { FichaService } from './ficha.service';
import { MoverService, SoGenteGuard } from './mover.service';
import { RepedidosDoComercial } from './repedidos-do-comercial';
import { ReacoesDaEspinha } from './reacoes-da-espinha';
import { RelogioDaEspinha } from './relogio-da-espinha';
import { DinheiroController, WebhooksDoDinheiroController } from './dinheiro.controller';
import { InteligenciaController } from './inteligencia.controller';
import { AssistenteService } from './assistente.service';
import { AutonomiaService } from './autonomia.service';
import { VigiaService } from './vigia.service';
import { RelatorioDaSemanaService } from './relatorio-da-semana.service';
import { TorreService } from './torre.service';
import { DiagnosticoService } from './diagnostico.service';
import { PropostaService } from './proposta.service';
import { SalaController } from './sala.controller';
import { SimuladorController } from './simulador.controller';
import { MensagensController } from './mensagens.controller';
import { SalaService } from './sala.service';
import { ReacoesDaPropostaService } from './reacoes-da-proposta.service';
import { LeituraEReacaoService } from './leitura-e-reacao.service';
import { SalaVersaoService } from './sala-versao.service';
import { WhatsappComercialService } from './whatsapp.service';
// lane D
import { ZapsignModule } from './conectores/zapsign.module';
import { ContratoVivoService } from './contrato-vivo.service';
import { DinheiroService } from './dinheiro.service';
import { FechadoForaController } from './fechado-fora.controller';
import { FechadoForaService } from './fechado-fora.service';
import { FechamentoService } from './fechamento.service';

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
  imports: [TenantsModule, AuthModule, LeadsModule, OnboardingModule, FinanceModule, RoutinesModule, ZapsignModule, MemoryModule],
  controllers: [ComercialController, SalaController, SimuladorController, MensagensController, DinheiroController, WebhooksDoDinheiroController, InteligenciaController, FechadoForaController],
  providers: [
    // --- orquestrador: o fio (único caminho de escrita de fato) e o registro de reações ---
    ReacoesRegistry,
    FioService,
    RelogioComercialRegistry,
    // --- lane A (espinha: ficha, reações, decisões, relógio) ---
    ConfigComercialService,
    DecisoesRegistry,
    DecisoesService,
    FichaService,
    RelogioDaEspinha,
    ReacoesDaEspinha,
    // --- rodada do painel P5 (mover o cartão pela tela, pela aprovação) ---
    MoverService,
    SoGenteGuard,
    // --- rodada do trabalho T7 ("pedir de novo" a vencida em /atendimento, pelo caminho de cada pedido) ---
    RepedidosDoComercial,
    // --- lane B (sala, WhatsApp por porta, simulador) ---
    SalaService,
    WhatsappComercialService,
    // --- rodada da implantação I4 (leitura e reação na página da proposta; a I5 lê daqui) ---
    ReacoesDaPropostaService,
    // --- rodada da implantação I3 (a sala publicada por versão) e I5 (o relatório de leitura e reação) ---
    SalaVersaoService,
    LeituraEReacaoService,
    // --- lane D (cobrança, assinatura, fechamento, contrato vivo) ---
    // As portas de cobrança e assinatura chegam por token: `FinanceModule`
    // (PORTA_DE_COBRANCA → AsaasService) e `ZapsignModule` (PORTA_DE_ASSINATURA).
    DinheiroService,
    FechamentoService,
    ContratoVivoService,
    // --- rodada do trabalho T1b (registrar cliente já fechado fora do sistema: a mesma transação de fechamento) ---
    FechadoForaService,
    // --- lane E (inteligência: stub/ponte, diagnóstico, proposta, relator, vigia) ---
    // O provider (stub/ponte) é escolhido em `llm/llm.module.ts`; aqui, o leitor de ata, o
    // construtor e revisor de proposta e o assistente da dúvida (fase mínima).
    DiagnosticoService,
    PropostaService,
    AssistenteService,
    // fase 2: a guarda da autonomia (A0 segura), o vigia das 08:00, o relator da quinta e a torre.
    AutonomiaService,
    VigiaService,
    RelatorioDaSemanaService,
    TorreService,
  ],
  exports: [FioService, ReacoesRegistry, RelogioComercialRegistry, FichaService, DecisoesService, DecisoesRegistry, ConfigComercialService, SalaService, WhatsappComercialService, DinheiroService, FechamentoService, ContratoVivoService],
})
export class ComercialModule {}
