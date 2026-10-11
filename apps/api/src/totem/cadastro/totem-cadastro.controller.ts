import {
  Controller,
  Get,
  Header,
  Headers,
  NotImplementedException,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  TOTEM_CABECALHO_ETIQUETA,
  TOTEM_CABECALHO_TOKEN,
  TotemCodigoEtiquetaSchema,
  TotemTokenSchema,
} from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { conferirTeto, tetoDoTotem } from '../comum/teto';

/**
 * `/api/totem-cadastro` — cadastro, cupom e texto da política (frente D).
 *
 * Duas credenciais aceitas: o token do aparelho (`X-Totem-Token`, no quiosque)
 * ou o código da etiqueta (`X-Totem-Etiqueta`, no celular pelo QR). Sem
 * nenhuma das duas, 401. Corpo provisório da base; a frente D o substitui.
 */
@Controller('totem-cadastro')
export class TotemCadastroController {
  private readonly teto = tetoDoTotem('cadastro');

  @Get('politica')
  @Header('Cache-Control', 'no-store')
  politica(
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Headers(TOTEM_CABECALHO_ETIQUETA) etiqueta?: string,
    @Req() req?: RequisicaoComEndereco,
  ): never {
    conferirTeto(this.teto, enderecoDeOrigem(req));
    const temToken = TotemTokenSchema.safeParse(token).success;
    const temEtiqueta = TotemCodigoEtiquetaSchema.safeParse(etiqueta).success;
    if (!temToken && !temEtiqueta) throw new UnauthorizedException('Abra o cadastro pelo totem ou pelo QR da etiqueta.');
    throw new NotImplementedException('Em construção.');
  }
}
