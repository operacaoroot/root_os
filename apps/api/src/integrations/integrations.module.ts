import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ClickupService],
  exports: [ClickupService],
})
export class IntegrationsModule {}
