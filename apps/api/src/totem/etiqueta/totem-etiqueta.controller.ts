import { Controller, Get, Header, NotImplementedException, Param, Req } from '@nestjs/common';
import { TotemCodigoEtiquetaSchema } from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { conferirTeto, tetoDoTotem } from '../comum/teto';

/**
 * `/api/totem-etiqueta/:codigo` — os dados públicos de `/p/<codigo>` (frente C).
 *
 * Código fora do formato responde 400 pelo schema, ANTES de qualquer consulta.
 * O smoke do arranque pede `/api/totem-etiqueta/x` e conta com esse 400: uma
 * 404 ali se confundiria com módulo fora do `AppModule`. Código no formato e
 * inexistente responde a 404 única de `totemNaoEncontrado()`.
 */
@Controller('totem-etiqueta')
export class TotemEtiquetaController {
  private readonly teto = tetoDoTotem('etiqueta');

  @Get(':codigo')
  @Header('Cache-Control', 'no-store')
  ficha(@Param('codigo') codigo: string, @Req() req?: RequisicaoComEndereco): never {
    conferirTeto(this.teto, enderecoDeOrigem(req));
    TotemCodigoEtiquetaSchema.parse(codigo);
    throw new NotImplementedException('Em construção.');
  }
}
