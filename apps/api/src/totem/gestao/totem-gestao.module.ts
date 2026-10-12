import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { AppConfigModule } from '../../config/config.module';
import { StorageModule } from '../../storage/storage.module';
import { TotemLoteModule } from '../lote/totem-lote.module';
import { TotemGestaoContaController } from './totem-gestao-conta.controller';
import { TotemGestaoDispositivosController } from './totem-gestao-dispositivos.controller';
import { TotemGestaoLojasController } from './totem-gestao-lojas.controller';
import { TotemGestaoMidiaController } from './totem-gestao-midia.controller';
import { TotemGestaoProdutosController } from './totem-gestao-produtos.controller';
import { TotemGestaoController } from './totem-gestao.controller';
import { TotemGestaoService } from './totem-gestao.service';

/**
 * O PAINEL DO TOTEM (frente A): lojas, vínculos, dispositivos, produtos,
 * configuração, resumo e eventos. Ver `docs/totem/CONTRATO.md`.
 *
 * `PrismaService` vem do `PrismaModule` global e não entra nos `imports`. O
 * `TotemLoteModule` entra pelo `LoteVigenteService`, que dá ao resumo o lote
 * vigente de cada produto pela mesma regra do quiosque e da etiqueta.
 */
@Module({
  imports: [AuthModule, AppConfigModule, StorageModule, TotemLoteModule],
  controllers: [
    TotemGestaoController,
    TotemGestaoLojasController,
    TotemGestaoDispositivosController,
    TotemGestaoProdutosController,
    TotemGestaoMidiaController,
    TotemGestaoContaController,
  ],
  providers: [TotemGestaoService],
})
export class TotemGestaoModule {}
