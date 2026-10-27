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
// Produção 21 (P9): quando a sala entra (o estado na aba Sala e "Copiar link da sala").
import { SalaEstadoController } from './sala-estado.controller';
import { SalaEstadoService, SoGenteNaSalaGuard } from './sala-estado.service';
import { WhatsappComercialService } from './whatsapp.service';
import { EvolutionEntradaService } from './evolution-entrada.service';
import { IntegracaoDaEvolutionController } from './evolution.controller';
// lane D
import { ZapsignModule } from './conectores/zapsign.module';
import { ContratoVivoService } from './contrato-vivo.service';
import { DinheiroService } from './dinheiro.service';
import { FechadoForaController } from './fechado-fora.controller';
import { FechadoForaService } from './fechado-fora.service';
// Produção 22 (M2): o contrato importado do CRM antigo (o PDF, as parcelas à mão e a régua).
import { ContratoImportadoController } from './contrato-importado.controller';
import { ContratoImportadoService } from './contrato-importado.service';
import { PropostaDoLeadController } from './proposta-do-lead.controller';
import { PropostaDoLeadService } from './proposta-do-lead.service';
import { FechamentoService } from './fechamento.service';
import { OnboardingAntecipadoController } from './onboarding-antecipado.controller';
import { OnboardingAntecipadoService } from './onboarding-antecipado.service';
import { ImportadorCrmService } from './importador-crm/importador-crm.service';
// Adendo de 21/10/2026 (§A1): as tarefas do comercial (o bloco do Funil vivo e o do painel do lead).
import { WorkModule } from '../work/work.module';
import { TarefasDoComercialController } from './tarefas/tarefas-do-comercial.controller';
import { TarefasDoComercialService } from './tarefas/tarefas-do-comercial.service';
// Rodada dos agentes (21/10/2026, lane A2): CO-08 (o contrato assinado na pasta do cliente).
import { AssinadoNaPastaService } from './assinado-na-pasta.service';
// CO-13 e CO-14 (o contrato da Root), CO-15 (o formulário do site), CO-16 (a triagem do WhatsApp) e o efeito de `comercial.lead.criar`.
import { ContratoDaRootController } from './contrato-da-root/contrato-da-root.controller';
import { ContratoDaRootService } from './contrato-da-root/contrato-da-root.service';
import { FormularioDoSiteController } from './formulario-do-site/formulario-do-site.controller';
import { FormularioDoSiteService } from './formulario-do-site/formulario-do-site.service';
import { LeadCriarService } from './lead-criar.service';
import { TriagemDoWhatsappService } from './triagem-do-whatsapp/triagem-do-whatsapp.service';
// Leva 5 (L4, 27/10/2026): a ficha geral e as pendências do painel do lead.
import { FichaGeralController } from './ficha-geral.controller';
import { FichaGeralService } from './ficha-geral.service';

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
  imports: [TenantsModule, AuthModule, LeadsModule, OnboardingModule, FinanceModule, RoutinesModule, ZapsignModule, MemoryModule, WorkModule],
  controllers: [ComercialController, SalaController, SimuladorController, MensagensController, DinheiroController, WebhooksDoDinheiroController, InteligenciaController, FechadoForaController, ContratoImportadoController, PropostaDoLeadController, OnboardingAntecipadoController, IntegracaoDaEvolutionController, SalaEstadoController, TarefasDoComercialController, ContratoDaRootController, FormularioDoSiteController, FichaGeralController],
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
    // --- mover o cartão pela tela (P5, 18/10; sem limitação e sem aprovação desde a U4, 20/10) ---
    MoverService,
    SoGenteGuard,
    // --- leva 5 (L4): a ficha geral e as pendências do painel do lead ---
    FichaGeralService,
    // --- rodada do trabalho T7 ("pedir de novo" a vencida em /atendimento, pelo caminho de cada pedido) ---
    RepedidosDoComercial,
    // --- lane B (sala, WhatsApp por porta, simulador) ---
    SalaService,
    WhatsappComercialService,
    // Produção 21 (P8): a conversa do lead que chega pela Evolution, inscrita na entrada direta do canal.
    EvolutionEntradaService,
    // --- rodada da implantação I4 (leitura e reação na página da proposta; a I5 lê daqui) ---
    ReacoesDaPropostaService,
    // --- rodada da implantação I3 (a sala publicada por versão) e I5 (o relatório de leitura e reação) ---
    SalaVersaoService,
    LeituraEReacaoService,
    SalaEstadoService,
    SoGenteNaSalaGuard,
    // --- lane D (cobrança, assinatura, fechamento, contrato vivo) ---
    // As portas de cobrança e assinatura chegam por token: `FinanceModule`
    // (PORTA_DE_COBRANCA → AsaasService) e `ZapsignModule` (PORTA_DE_ASSINATURA).
    DinheiroService,
    FechamentoService,
    ContratoVivoService,
    // --- rodada do trabalho T1b (registrar cliente já fechado fora do sistema: a mesma transação de fechamento) ---
    FechadoForaService,
    // --- produção 22, M2 (o contrato importado: o PDF, as parcelas à mão e a régua, fato passado) ---
    ContratoImportadoService,
    PropostaDoLeadService,
    // --- ajustes da versão final A2 (iniciar o onboarding antes do negócio fechado: o mesmo card do fechamento) ---
    OnboardingAntecipadoService,
    // --- rodada de produção 1 (o importador do CRM antigo: só pelo script `importar-crm`, sem rota) ---
    ImportadorCrmService,
    // --- adendo de 21/10/2026, §A1 (as tarefas do comercial: WorkTask da lista do comercial ou com `leadId`) ---
    TarefasDoComercialService,
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
    // --- rodada dos agentes, 21/10/2026, lane A2 (CO-08 o PDF assinado na pasta do cliente) ---
    AssinadoNaPastaService,
    // CO-13/CO-14 o contrato da Root; CO-15 o formulário do site; CO-16 a triagem; o efeito de `comercial.lead.criar`.
    ContratoDaRootService,
    FormularioDoSiteService,
    LeadCriarService,
    TriagemDoWhatsappService,
  ],
  exports: [FioService, ReacoesRegistry, RelogioComercialRegistry, FichaService, DecisoesService, DecisoesRegistry, ConfigComercialService, SalaService, WhatsappComercialService, DinheiroService, FechamentoService, ContratoVivoService],
})
export class ComercialModule {}
