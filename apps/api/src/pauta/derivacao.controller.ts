import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
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

/*
 * MC15: a semana de posts — por matéria, um carrossel, um story e um corte
 * vertical. Sub-rotas de `/pauta`, governadas pelo módulo pauta. Nenhuma
 * publica: aprovar e descartar são o PATCH /pauta/pecas/:id de sempre, e o
 * Instagram segue manual (D-MC8). O Mac (`root-midia carrosseis|stories|cortes`)
 * lê a semana e sobe os PNG; o mp4 do corte fica no Mac e só o caminho vem.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class DerivacaoController {
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
  // o serviço confere de novo o tamanho, a assinatura do PNG e as dimensões.
  @Post('pecas/:id/imagens/:n')
  @RequirePermissions('pauta.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PAUTA_PNG_DA_PECA_MAX_BYTES, files: 1 } }))
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
  async imagem(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('n') n: string, @Res() res: Response) {
    const { stream, size } = await this.semana.imagem(user.orgId, id, PautaNumeroDaImagemSchema.parse(n));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', size);
    // A rota é por número: a imagem muda quando o Mac sobe outra.
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }

  @Put('pecas/:id/video')
  @RequirePermissions('pauta.editar')
  video(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.semana.registrarVideo(user.orgId, id, user.sub, PautaVideoDoCorteSchema.parse(body ?? {}));
  }
}
