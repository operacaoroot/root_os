import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

@Module({
  controllers: [ConfigController],
  providers: [ConfigService],
  // O painel do Totem reaproveita a troca de senha (totem-gestao-conta.controller.ts).
  exports: [ConfigService],
})
export class AppConfigModule {}
