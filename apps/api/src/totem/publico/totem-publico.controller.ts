import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  TOTEM_CABECALHO_TOKEN,
  TotemAtivarSchema,
  TotemBatimentoSchema,
  TotemEventosQuiosqueSchema,
  TotemTokenSchema,
  type TotemAtivacao,
} from '@mktos/shared';
import type { Response } from 'express';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { conferirTeto, tetoDoTotem, type TetoPorOrigem } from '../comum/teto';
import { etagCasa } from './catalogo';
import { TOTEM_REATIVAR, TotemPublicoService, type AparelhoResolvido } from './totem-publico.service';

type RequisicaoDoTotem = RequisicaoComEndereco & { headers?: Record<string, string | string[] | undefined> };

/**
 * `/api/totem-publico` — as rotas do quiosque (frente B). Sem JWT: a credencial
 * é o token do aparelho no cabeçalho `X-Totem-Token`; a ativação troca o
 * código de 8 caracteres gerado no painel por esse token.
 *
 * A ordem em toda rota com token: teto por origem, formato do token (401 sem
 * tocar o banco), `resolverTenantDoTotem` sobre o hash, teto por aparelho e,
 * no serviço, `comTenantPublico` com `exigirModuloTotem` dentro. O teto por
 * origem segura quem varre tokens inventados, que nunca chegam a ter aparelho;
 * o por aparelho é o do contrato, porque uma loja inteira sai pelo mesmo IP.
 */
@Controller('totem-publico')
export class TotemPublicoController {
  private readonly tetoDaAtivacao = tetoDoTotem('ativacao');
  private readonly tetoDoCatalogoPorOrigem = tetoDoTotem('catalogo');
  private readonly tetoDoCatalogoPorAparelho = tetoDoTotem('catalogo');
  private readonly tetoDosEventosPorOrigem = tetoDoTotem('eventos');
  private readonly tetoDosEventosPorAparelho = tetoDoTotem('eventos');

  constructor(private readonly svc: TotemPublicoService) {}

  private async aparelho(
    token: string | undefined,
    req: RequisicaoComEndereco | undefined,
    porOrigem: TetoPorOrigem,
    porAparelho: TetoPorOrigem,
  ): Promise<AparelhoResolvido> {
    conferirTeto(porOrigem, enderecoDeOrigem(req));
    const formato = TotemTokenSchema.safeParse(token);
    if (!formato.success) throw new UnauthorizedException(TOTEM_REATIVAR);
    const a = await this.svc.aparelhoDoToken(formato.data);
    conferirTeto(porAparelho, a.dispositivoId);
    return a;
  }

  @Post('ativar')
  @Header('Cache-Control', 'no-store')
  async ativar(@Body() body: unknown, @Req() req?: RequisicaoDoTotem): Promise<TotemAtivacao> {
    conferirTeto(this.tetoDaAtivacao, enderecoDeOrigem(req));
    const { codigo } = TotemAtivarSchema.parse(body);
    const ua = req?.headers?.['user-agent'];
    return this.svc.ativar(codigo, typeof ua === 'string' ? ua : undefined);
  }

  /**
   * O ETag é a versão do catálogo; com `If-None-Match` igual, 304 sem corpo.
   * `@Res()` inteiro porque, no modo `passthrough`, o Nest reescreve o status
   * com o padrão da rota e o 304 viraria um 200 vazio.
   */
  @Get('catalogo')
  @Header('Cache-Control', 'no-store')
  async catalogo(
    @Res() res: Response,
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Headers('if-none-match') ifNoneMatch?: string,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<void> {
    const a = await this.aparelho(token, req, this.tetoDoCatalogoPorOrigem, this.tetoDoCatalogoPorAparelho);
    const catalogo = await this.svc.catalogo(a);
    res.setHeader('ETag', `"${catalogo.versao}"`);
    if (etagCasa(ifNoneMatch, catalogo.versao)) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    res.status(HttpStatus.OK).json(catalogo);
  }

  @Post('eventos')
  @Header('Cache-Control', 'no-store')
  async eventos(
    @Body() body: unknown,
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<{ recebidos: number }> {
    const a = await this.aparelho(token, req, this.tetoDosEventosPorOrigem, this.tetoDosEventosPorAparelho);
    const { eventos } = TotemEventosQuiosqueSchema.parse(body);
    return this.svc.eventos(a, eventos);
  }

  @Post('batimento')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async batimento(
    @Body() body: unknown,
    @Headers(TOTEM_CABECALHO_TOKEN) token?: string,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<void> {
    const a = await this.aparelho(token, req, this.tetoDosEventosPorOrigem, this.tetoDosEventosPorAparelho);
    const { versaoApp, catalogoVersao } = TotemBatimentoSchema.parse(body);
    await this.svc.batimento(a, versaoApp, catalogoVersao);
  }
}
