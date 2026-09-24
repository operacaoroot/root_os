import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  PAUTA_JPEG_DA_PECA_MAX_BYTES,
  PAUTA_PNG_DA_PECA_MAX_BYTES,
  PautaDerivacaoGerarSchema,
  PautaNumeroDaImagemSchema,
  PautaPecaDaSemanaEditarSchema,
  PautaVideoDoCorteSchema,
} from '@mktos/shared';
import { DerivacaoService } from './derivacao.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ErroDoEnvio, conferirCabecalhosDoEnvio, tetoDoVideo } from './video-do-corte';
import { entregarArquivo } from '../common/entregar-arquivo';

/*
 * MC15: a semana de posts — por matéria, um carrossel, um story e um corte
 * vertical. Sub-rotas de `/pauta`, governadas pelo módulo pauta. Nenhuma
 * publica: aprovar e descartar são o PATCH /pauta/pecas/:id de sempre, e o
 * Instagram segue manual (D-MC8). O Mac (`root-midia carrosseis|stories|cortes`)
 * lê a semana e sobe os PNG e os JPEG; o mp4 do corte registra o caminho no Mac
 * e, desde a MD4, sobe ao storage por stream (`POST …/video/arquivo`).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class DerivacaoController {
  private readonly log = new Logger(DerivacaoController.name);

  constructor(private readonly semana: DerivacaoService) {}

  @Get('episodios/:id/semana')
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.semana.painel(user.orgId, id);
  }

  // Gasta IA (uma chamada por matéria), como o roteiro, o pacote e a newsletter.
  @Post('episodios/:id/semana/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { substituir, itens } = PautaDerivacaoGerarSchema.parse(body ?? {});
    return this.semana.gerar(user.orgId, id, user.sub, { substituir, itens });
  }

  @Put('pecas/:id/semana')
  @RequirePermissions('pauta.editar')
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.semana.editar(user.orgId, id, user.sub, PautaPecaDaSemanaEditarSchema.parse(body ?? {}));
  }

  // O multer corta no teto (413) antes de o arquivo inteiro ficar em memória;
  // o serviço confere de novo o tamanho de cada tipo (PNG 5 MB, JPEG 8 MB), a
  // assinatura e as dimensões.
  @Post('pecas/:id/imagens/:n')
  @RequirePermissions('pauta.editar')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: Math.max(PAUTA_PNG_DA_PECA_MAX_BYTES, PAUTA_JPEG_DA_PECA_MAX_BYTES), files: 1 } }),
  )
  enviarImagem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.semana.enviarImagem(user.orgId, id, user.sub, PautaNumeroDaImagemSchema.parse(n), file);
  }

  @Get('pecas/:id/imagens/:n')
  @RequirePermissions('pauta.ver')
  async imagem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @Query('tipo') tipo: string | undefined,
    @Res() res: Response,
  ) {
    const { stream, size, contentType } = await this.semana.imagem(user.orgId, id, PautaNumeroDaImagemSchema.parse(n), tipo === 'jpeg' ? 'jpeg' : 'png');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', size);
    // A rota é por número: a imagem muda quando o Mac sobe outra.
    res.setHeader('Cache-Control', 'private, no-store');
    entregarArquivo(stream, res, this.log, `imagem ${n} da peça ${id}`);
  }

  @Put('pecas/:id/video')
  @RequirePermissions('pauta.editar')
  video(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.semana.registrarVideo(user.orgId, id, user.sub, PautaVideoDoCorteSchema.parse(body ?? {}));
  }

  /**
   * MD4: o mp4 do corte, cru no corpo (`Content-Type: video/mp4`), com
   * `Content-Length` e o sha256 no cabeçalho. Nenhum parser do Nest lê
   * `video/mp4` e esta rota não está entre as de corpo grande
   * (`common/corpo-da-midia.ts`): o corpo chega intacto como stream. O que se
   * recusa sem ler recusa com `Connection: close`, para o resto do corpo não
   * ficar entrando numa conexão reaproveitada.
   */
  @Post('pecas/:id/video/arquivo')
  @RequirePermissions('pauta.editar')
  async enviarVideo(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const cabecalho = conferirCabecalhosDoEnvio(req.headers, tetoDoVideo());
      return await this.semana.enviarVideo(user.orgId, id, user.sub, { ...cabecalho, corpo: req });
    } catch (e) {
      if (!req.readableEnded) res.setHeader('Connection', 'close');
      if (e instanceof ErroDoEnvio) throw new HttpException(e.message, e.status);
      throw e;
    }
  }

  @Get('pecas/:id/video/arquivo')
  @RequirePermissions('pauta.ver')
  async baixarVideo(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const { stream, size, nome } = await this.semana.video(user.orgId, id);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    entregarArquivo(stream, res, this.log, `mp4 da peça ${id}`);
  }
}
