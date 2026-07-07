import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
