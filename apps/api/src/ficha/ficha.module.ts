import { Module } from '@nestjs/common';
import { FichaController } from './ficha.controller';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';

@Module({
  controllers: [FichaController],
  providers: [FichaService, JornadaService],
})
export class FichaModule {}
