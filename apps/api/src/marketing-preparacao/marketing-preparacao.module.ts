import { Module } from '@nestjs/common';
import { PautaModule } from '../pauta/pauta.module';
import { MarketingPreparacaoController } from './marketing-preparacao.controller';
import { MarketingPreparacaoService } from './marketing-preparacao.service';

@Module({ imports: [PautaModule], controllers: [MarketingPreparacaoController], providers: [MarketingPreparacaoService] })
export class MarketingPreparacaoModule {}
