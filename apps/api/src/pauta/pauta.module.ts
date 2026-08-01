import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GoogleModule } from '../google/google.module';
import { PautaController } from './pauta.controller';
import { PautaService } from './pauta.service';
import { ApifyService } from './apify.service';
import { EspelhoService } from './espelho.service';

// Módulo Pauta — onda 1 (acervo de referência). Ver docs/PAUTA.md.
// GoogleModule entra porque o espelho .md pode gravar no Drive conectado.
@Module({
  imports: [StorageModule, GoogleModule],
  controllers: [PautaController],
  providers: [PautaService, ApifyService, EspelhoService],
  exports: [PautaService],
})
export class PautaModule {}
