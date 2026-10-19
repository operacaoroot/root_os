import { Global, Module } from '@nestjs/common';

import { TransporteDeCanalRegistry } from './transporte.registry';
import { EntradaDeGrupoRegistry } from './entrada-de-grupo.registry';
import { OuvintesDoWebhookRegistry } from './ouvintes-do-webhook.registry';
import { WhatsappDoAtendimentoRegistry } from './whatsapp-do-atendimento.registry';
import { EnvioDeAprovacaoService } from './envio-de-aprovacao.service';
import { CanalDeAprovacaoService } from './canal-de-aprovacao.service';
import { CanalDeAprovacaoController } from './canal-de-aprovacao.controller';

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
    OuvintesDoWebhookRegistry,
    WhatsappDoAtendimentoRegistry,
    EnvioDeAprovacaoService,
    CanalDeAprovacaoService,
  ],
  exports: [
    TransporteDeCanalRegistry,
    EntradaDeGrupoRegistry,
    OuvintesDoWebhookRegistry,
    WhatsappDoAtendimentoRegistry,
    EnvioDeAprovacaoService,
  ],
})
export class CanaisModule {}
