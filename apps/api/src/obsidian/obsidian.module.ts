import { Module } from '@nestjs/common';
import { ObsidianController } from './obsidian.controller';
import { ObsidianService } from './obsidian.service';

@Module({
  controllers: [ObsidianController],
  providers: [ObsidianService],
})
export class ObsidianModule {}
