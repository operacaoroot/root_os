import { Controller, Get, Header, Headers, NotImplementedException, Req, UnauthorizedException } from '@nestjs/common';
import { TOTEM_CABECALHO_TOKEN, TotemTokenSchema } from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { conferirTeto, tetoDoTotem } from '../comum/teto';

/**
 * `/api/totem-publico` — as rotas do quiosque (frente B). Sem JWT: a credencial
 * é o token do aparelho no cabeçalho `X-Totem-Token`.
 *
 * Corpo provisório da base. A ordem que a frente B mantém: teto, formato do
 * token, `resolverTenantDoTotem` (de `common/tenant-publico.ts`) sobre o hash,
 * `comTenantPublico` e, dentro dele, `exigirModuloTotem`.
 */
@Controller('totem-publico')
export class TotemPublicoController {
  private readonly tetoDoCatalogo = tetoDoTotem('catalogo');

  @Get('catalogo')
  @Header('Cache-Control', 'no-store')
  catalogo(@Headers(TOTEM_CABECALHO_TOKEN) token?: string, @Req() req?: RequisicaoComEndereco): never {
    conferirTeto(this.tetoDoCatalogo, enderecoDeOrigem(req));
    if (!TotemTokenSchema.safeParse(token).success) {
      throw new UnauthorizedException('Este totem precisa ser ativado de novo.');
    }
    throw new NotImplementedException('Em construção.');
  }
}
