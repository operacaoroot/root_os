import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';
import { ConectoresService } from './conectores.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ClickupService, ConectoresService],
  // `ConectoresService` é exportado porque o desligamento não é assunto só da
  // tela de Conexões: é a porta (e qualquer serviço que fale com conector) que
  // precisa perguntar "este conector está ligado para esta empresa?" antes de
  // sair da casa (RF-G-06).
  exports: [ClickupService, ConectoresService],
})
export class IntegrationsModule {}
