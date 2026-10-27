import { Global, Module } from '@nestjs/common';

import { TransporteDeCanalRegistry } from './transporte.registry';
import { EntradaDeGrupoRegistry } from './entrada-de-grupo.registry';
import { EnvioDeAprovacaoService } from './envio-de-aprovacao.service';
import { CanalDeAprovacaoService } from './canal-de-aprovacao.service';
import { CanalDeAprovacaoController } from './canal-de-aprovacao.controller';
import { EntradaDiretaRegistry } from './entrada-direta.registry';
import {
  ADMINISTRACAO_DA_EVOLUTION,
  ENVIO_PELA_EVOLUTION,
  MENSAGEM_DO_AGENTE_NO_GRUPO,
  LEITURA_DA_EVOLUTION,
  MIDIA_DA_CAIXA_PELA_EVOLUTION,
  RESPOSTA_DE_GENTE_PELA_EVOLUTION,
} from './evolution.port';
import { GravacaoDoWhatsappRegistry } from './gravacao-do-whatsapp.registry';
// Produção 21 (P8): a Evolution da EMPRESA mora no arquivo do conector da Evolution (a catraca de
// credenciais diz que só ele lê `EVOLUTION_*`); a pasta da porta pode importar conector.
import { EvolutionDaEmpresaService } from '../../pauta/evolution.service';

/*
 * O CANAL EXTERNO DE APROVAÇÃO — fatia 5.5, RF-A-06.
 *
 * `@Global` e SEM `imports`, e as duas coisas são a mesma decisão: manter este
 * módulo nas PONTAS do grafo, onde ele não pode participar de ciclo nenhum.
 *
 *  · SEM `imports` porque tudo de que ele precisa vem de módulo `@Global` que já
 *    está de pé: `PrismaModule`, `ApprovalsModule`, `GatewayModule`,
 *    `PolicyModule`. Importar qualquer um deles aqui criaria uma aresta de
 *    volta — e `ApprovalsModule` importa ESTE, então a aresta fecharia o ciclo e
 *    a aplicação não subiria. Oito travas derrubam o arranque de propósito neste
 *    repositório; não convém acrescentar uma nona por acidente de fiação.
 *
 *  · `@Global` porque quem se INSCREVE no transporte mora fora daqui:
 *    `pauta/evolution.service.ts` é quem sabe mandar WhatsApp, e ele não pode
 *    importar este módulo (o módulo de pauta não é importado por ninguém do
 *    gateway, e a direção inversa fecharia outro ciclo). Global, o
 *    `TransporteDeCanalRegistry` é injetável de qualquer lugar sem aresta
 *    nenhuma — é o mesmo arranjo do `EfeitosRegistry` e do
 *    `InterruptoresRegistry`, e pelo mesmo motivo.
 *
 * QUEM IMPORTA ESTE MÓDULO: `ApprovalsModule`, que já é `@Global` e já é
 * carregado pelo `AppModule`. O canal precisa estar no grafo para o controlador
 * existir, e `AppModule` não é arquivo desta fatia.
 *
 * DESLIGADO É O PADRÃO. Estar no grafo não liga nada: sem os dois segredos de
 * `configuracao-do-canal.ts` e sem transporte inscrito, o webhook responde 404,
 * nenhum pedido sai e nenhum código é gerado.
 *
 * O QUE ESTE MÓDULO EXPORTA É O MÍNIMO, e a lista encolheu na correção da fatia:
 *
 *  · `TransporteDeCanalRegistry` — porque quem se INSCREVE mora fora
 *    (`pauta/evolution.service.ts`);
 *  · `EnvioDeAprovacaoService` — porque quem NOTIFICA é `ApprovalsService.propor`;
 *  · `EntradaDeGrupoRegistry` — porque quem trata o grupo de links mora fora
 *    (`pauta/entrada-de-links.service.ts`, MC1). Ele só recebe mensagem de GRUPO,
 *    que o canal descarta de qualquer jeito: não oferece caminho até decisão.
 *
 * `CanalDeAprovacaoService` saiu da lista: quem o usa é o controlador daqui, e
 * exportá-lo oferecia a QUALQUER serviço do processo um objeto que decide
 * aprovação a partir de um corpo arbitrário. Não era buraco (ele confere tudo do
 * banco), mas superfície oferecida é superfície que alguém usa. A promessa mais
 * larga — a de que o registro de transporte não é um segundo caminho até o
 * conector — deixou de ser comentário e virou catraca em `test/arquitetura.test.ts`
 * ("mensagem de serviço do canal só sai do canal").
 */
@Global()
@Module({
  controllers: [CanalDeAprovacaoController],
  providers: [
    TransporteDeCanalRegistry,
    EntradaDeGrupoRegistry,
    EnvioDeAprovacaoService,
    CanalDeAprovacaoService,
    // Produção 21 (P8): a conversa 1:1 do lead que chega pelo webhook da Evolution vai ao comercial, por registro.
    EntradaDiretaRegistry,
    // Produção 21 (P8): a Evolution da empresa, entregue ao comercial pelas duas portas de `evolution.port.ts`.
    EvolutionDaEmpresaService,
    { provide: ENVIO_PELA_EVOLUTION, useExisting: EvolutionDaEmpresaService },
    { provide: ADMINISTRACAO_DA_EVOLUTION, useExisting: EvolutionDaEmpresaService },
    // Produção 22C (W1, W2): a leitura da sincronização e a resposta de gente pela caixa de WhatsApp.
    { provide: LEITURA_DA_EVOLUTION, useExisting: EvolutionDaEmpresaService },
    { provide: RESPOSTA_DE_GENTE_PELA_EVOLUTION, useExisting: EvolutionDaEmpresaService },
    // Layout 27/10: abrir o arquivo de uma mensagem e mandar arquivo pela caixa de WhatsApp.
    { provide: MIDIA_DA_CAIXA_PELA_EVOLUTION, useExisting: EvolutionDaEmpresaService },
    // 26/10/2026: o agente de tarefas (TR-12) fala só no grupo da equipe.
    { provide: MENSAGEM_DO_AGENTE_NO_GRUPO, useExisting: EvolutionDaEmpresaService },
    // Produção 22C (W1): quem grava TODA mensagem do webhook antes dos leitores de sempre.
    GravacaoDoWhatsappRegistry,
  ],
  exports: [
    TransporteDeCanalRegistry,
    EntradaDeGrupoRegistry,
    EntradaDiretaRegistry,
    EnvioDeAprovacaoService,
    ENVIO_PELA_EVOLUTION,
    ADMINISTRACAO_DA_EVOLUTION,
    LEITURA_DA_EVOLUTION,
    RESPOSTA_DE_GENTE_PELA_EVOLUTION,
    MIDIA_DA_CAIXA_PELA_EVOLUTION,
    MENSAGEM_DO_AGENTE_NO_GRUPO,
    GravacaoDoWhatsappRegistry,
  ],
})
export class CanaisModule {}
