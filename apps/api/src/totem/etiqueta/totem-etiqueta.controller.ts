import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import { TotemCodigoEtiquetaSchema, type TotemFichaDaEtiqueta } from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { PrismaService } from '../../prisma/prisma.service';
import { conferirTeto, tetoDoTotem } from '../comum/teto';
import { fichaDaEtiqueta } from './ficha';

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

  constructor(private readonly prisma: PrismaService) {}

  @Get(':codigo')
  @Header('Cache-Control', 'no-store')
  ficha(@Param('codigo') codigo: string, @Req() req?: RequisicaoComEndereco): Promise<TotemFichaDaEtiqueta> {
    conferirTeto(this.teto, enderecoDeOrigem(req));
    const normalizado = TotemCodigoEtiquetaSchema.parse(codigo);
    return fichaDaEtiqueta(this.prisma, normalizado);
  }
}
