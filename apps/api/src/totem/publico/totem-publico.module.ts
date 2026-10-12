import { Module } from '@nestjs/common';

import { StorageModule } from '../../storage/storage.module';
import { TotemLoteModule } from '../lote/totem-lote.module';
import { TotemPublicoController } from './totem-publico.controller';
import { TotemPublicoService } from './totem-publico.service';

/**
 * O QUIOSQUE (frente B): ativação, catálogo, eventos em lote, batimento e as
 * imagens do catálogo.
 * Rotas anônimas; a credencial é o token do aparelho.
 *
 * `TotemLoteModule` entra pelo `LoteVigenteService`, que o catálogo usa para
 * mostrar o lote de cada produto.
 */
@Module({
  imports: [StorageModule, TotemLoteModule],
  controllers: [TotemPublicoController],
  providers: [TotemPublicoService],
})
export class TotemPublicoModule {}
