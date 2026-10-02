import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { MetaModule } from '../meta/meta.module';
import { MemoryModule } from '../memory/memoria.module';

@Module({
  imports: [MetaModule, MemoryModule],
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
