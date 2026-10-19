import { Module } from '@nestjs/common';
import { PainelComercialController } from './painel-comercial.controller';
import { PainelComercialService } from './painel-comercial.service';
import { PropostasDaSalaService } from './propostas-da-sala.service';

@Module({
  controllers: [PainelComercialController],
  providers: [PainelComercialService, PropostasDaSalaService],
})
export class PainelComercialModule {}
