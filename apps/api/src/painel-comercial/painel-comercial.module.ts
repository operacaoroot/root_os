import { Module } from '@nestjs/common';
import { PainelComercialController } from './painel-comercial.controller';
import { PainelComercialService } from './painel-comercial.service';

@Module({
  controllers: [PainelComercialController],
  providers: [PainelComercialService],
})
export class PainelComercialModule {}
