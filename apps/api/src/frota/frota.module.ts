import { Module } from '@nestjs/common';
import { SessaoDaPlataformaGuard } from '../platform/sessao-da-plataforma.guard';
import { FrotaController } from './frota.controller';
import { FrotaRelatorController } from './relator.controller';
import { FrotaService } from './frota.service';

/*
 * FROTA (27/10/2026): os servidores de cliente que a ROOT opera, vistos de uma
 * tela só — estado, apps, acessos com revogação, políticas/LGPD e registro.
 * O relator do kit alimenta; o painel lê e enfileira ordens. Ver frota.service.ts.
 */
@Module({
  controllers: [FrotaController, FrotaRelatorController],
  providers: [FrotaService, SessaoDaPlataformaGuard],
  exports: [FrotaService],
})
export class FrotaModule {}
