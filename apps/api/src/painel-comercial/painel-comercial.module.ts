import { Module } from '@nestjs/common';
import { FichaModule } from '../ficha/ficha.module';
import { PainelComercialController } from './painel-comercial.controller';
import { PainelComercialService } from './painel-comercial.service';

@Module({
  imports: [FichaModule],
  controllers: [PainelComercialController],
  providers: [PainelComercialService],
})
export class PainelComercialModule {}
