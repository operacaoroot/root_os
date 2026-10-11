import { Module } from '@nestjs/common';

import { TotemLoteModule } from '../lote/totem-lote.module';
import { TotemPublicoController } from './totem-publico.controller';

/**
 * O QUIOSQUE (frente B): ativação, catálogo, eventos em lote e batimento.
 * Rotas anônimas; a credencial é o token do aparelho.
 *
 * `TotemLoteModule` entra pelo `LoteVigenteService`, que o catálogo usa para
 * mostrar o lote de cada produto.
 */
@Module({
  imports: [TotemLoteModule],
  controllers: [TotemPublicoController],
})
export class TotemPublicoModule {}
