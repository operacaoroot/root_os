import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';
import { ConectoresService } from './conectores.service';
import { ContratoDeConectorModule } from './contrato.module';
import { AnthropicConector } from './anthropic.conector';

@Module({
  // O registro do contrato de conector (fatia 5.4). É `@Global`, então basta
  // ser importado UMA vez para que `google/`, `meta/`, `obsidian/` e `pauta/`
  // consigam se inscrever sem aresta nova no grafo de módulos — ver
  // `contrato.module.ts`.
  imports: [ContratoDeConectorModule],
  controllers: [IntegrationsController],
  // `AnthropicConector` (leva 5, L8): o cartão "Claude (Anthropic)". Quem fala com a
  // Anthropic é `ChaveDaAnthropicService`, do `LlmModule` (@Global); aqui só o contrato e as rotas.
  providers: [IntegrationsService, ClickupService, ConectoresService, AnthropicConector],
  // `ConectoresService` é exportado porque o desligamento não é assunto só da
  // tela de Conexões: é a porta (e qualquer serviço que fale com conector) que
  // precisa perguntar "este conector está ligado para esta empresa?" antes de
  // sair da casa (RF-G-06).
  exports: [ClickupService, ConectoresService],
})
export class IntegrationsModule {}
