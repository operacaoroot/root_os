import { Module } from '@nestjs/common';
import { ObsidianController } from './obsidian.controller';
import { ObsidianService } from './obsidian.service';

@Module({
  controllers: [ObsidianController],
  providers: [ObsidianService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [ObsidianService],
})
export class ObsidianModule {}
