import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { TotemEtiquetaController } from '../etiqueta/totem-etiqueta.controller';
import { LoteVigenteService } from './lote-vigente.service';
import { TotemLotesController } from './totem-lotes.controller';

/**
 * LOTE E ETIQUETA (frente C): o painel de lotes, remessas e reposições
 * (`/api/totem-lotes`) e a rota pública da etiqueta (`/api/totem-etiqueta`).
 *
 * Exporta `LoteVigenteService` porque o catálogo do quiosque (frente B) e a
 * etiqueta leem o lote vigente pela MESMA regra. Este módulo não importa
 * nenhum outro do Totem, então o `TotemPublicoModule` pode importá-lo sem ciclo.
 */
@Module({
  imports: [AuthModule],
  controllers: [TotemLotesController, TotemEtiquetaController],
  providers: [LoteVigenteService],
  exports: [LoteVigenteService],
})
export class TotemLoteModule {}
