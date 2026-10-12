import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
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
import { comTenantPublico } from '../../common/tenant-publico';
import { StorageService } from '../../storage/storage.service';
import { chaveDaMidia, midiaPedidaValida } from '../comum/midia';
import { totemNaoEncontrado } from '../comum/modulo';
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
  private readonly tetoDaMidia = tetoDoTotem('midia');

  constructor(
    private readonly svc: TotemPublicoService,
    private readonly storage: StorageService,
  ) {}

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

  /**
   * A foto do produto e o banner da campanha. Sem token: a `<img>` do quiosque
   * não manda cabeçalho, e a imagem não é segredo de ninguém (o nome é o hash
   * do conteúdo, impossível de adivinhar). O bucket é privado, então o arquivo
   * sai por aqui, como o avatar da bio.
   *
   * Não consulta o banco. A empresa vem da própria URL e entra no contexto só
   * para o log levar `org=`; o que garante que a imagem é dela é a chave no
   * bucket, que tem o `orgId` no caminho e só nasce pelo envio do painel, com
   * o módulo ligado. Pedido fora do formato responde a 404 pública sem tocar
   * no bucket.
   */
  @Get('midia/:orgId/:arquivo')
  async midia(
    @Param('orgId') orgId: string,
    @Param('arquivo') arquivo: string,
    @Res() res: Response,
    @Req() req?: RequisicaoComEndereco,
  ): Promise<void> {
    conferirTeto(this.tetoDaMidia, enderecoDeOrigem(req));
    if (!midiaPedidaValida(orgId, arquivo)) throw totemNaoEncontrado();

    await comTenantPublico(orgId, async () => {
      let midia: Awaited<ReturnType<StorageService['get']>>;
      try {
        midia = await this.storage.get(chaveDaMidia(orgId, arquivo));
      } catch {
        throw totemNaoEncontrado();
      }
      res.setHeader('Content-Type', midia.contentType);
      res.setHeader('Content-Length', midia.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // O cabeçalho de correlação é por requisição e esta resposta fica um ano
      // em cache: guardado junto com a imagem, serviria a todos (ver o avatar da bio).
      res.removeHeader('x-correlation-id');
      midia.stream.pipe(res);
    });
  }
}
