import { Body, Controller, Get, Header, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import {
  TOTEM_CABECALHO_ETIQUETA,
  TOTEM_CABECALHO_TOKEN,
  TotemCodigoEtiquetaSchema,
  TotemTokenSchema,
  type TotemCadastroResposta,
  type TotemPoliticaResposta,
} from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { conferirTeto, tetoDoTotem } from '../comum/teto';
import { TotemCadastroService, type CredencialDoCadastro } from './totem-cadastro.service';

/**
 * `/api/totem-cadastro` — cadastro, cupom e texto da política (frente D).
 *
 * Duas credenciais aceitas: o token do aparelho (`X-Totem-Token`, no quiosque)
 * ou o código da etiqueta (`X-Totem-Etiqueta`, no celular pelo QR). Sem
 * nenhuma das duas no formato, 401 antes de qualquer consulta. Com as duas,
 * vale o token.
 */
@Controller('totem-cadastro')
export class TotemCadastroController {
  private readonly teto = tetoDoTotem('cadastro');
  // Mesmo teto, balde separado: cada abertura do formulário lê a política, e
  // isso não pode consumir as tentativas de cadastro de quem está na loja.
  private readonly tetoDaPolitica = tetoDoTotem('cadastro');

  constructor(private readonly svc: TotemCadastroService) {}

  private credencial(token: string | undefined, etiqueta: string | undefined): CredencialDoCadastro {
    const t = TotemTokenSchema.safeParse(token);
    if (t.success) return { tipo: 'token', token: t.data };
    const e = TotemCodigoEtiquetaSchema.safeParse(etiqueta);
    if (e.success) return { tipo: 'etiqueta', codigo: e.data };
    throw new UnauthorizedException('Abra o cadastro pelo totem ou pelo QR da etiqueta.');
  }

  @Get('politica')
  @Header('Cache-Control', 'no-store')
  politica(
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Headers(TOTEM_CABECALHO_ETIQUETA) etiqueta?: string,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<TotemPoliticaResposta> {
    conferirTeto(this.tetoDaPolitica, enderecoDeOrigem(req));
    return this.svc.politica(this.credencial(token, etiqueta));
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cadastrar(
    @Body() body: unknown,
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Headers(TOTEM_CABECALHO_ETIQUETA) etiqueta?: string,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<TotemCadastroResposta> {
    conferirTeto(this.teto, enderecoDeOrigem(req));
    return this.svc.cadastrar(this.credencial(token, etiqueta), body);
  }
}
