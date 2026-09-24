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
  PAUTA_THUMB_MAX_BYTES,
  PautaNumeroDaThumbSchema,
  PautaPacoteGerarSchema,
  PautaTituloEscolhidoSchema,
} from '@mktos/shared';
import { PacoteService } from './pacote.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MC11: o pacote do YouTube. Sub-rota de `/pauta`, governada pelo módulo pauta.
 * O Mac (`root-midia thumbs ep-NN`) lê os briefs e sobe os PNG pelas duas rotas
 * de thumbs, com o login normal da API.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class PacoteController {
  constructor(private readonly pacotes: PacoteService) {}

  // Gasta IA, como gerar o roteiro e aprender a voz.
  @Post(':id/pacote/gerar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { substituir } = PautaPacoteGerarSchema.parse(body ?? {});
    return this.pacotes.gerar(user.orgId, id, user.sub, { substituir });
  }

  @Put(':id/pacote/titulo')
  @RequirePermissions('pauta.editar')
  escolherTitulo(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { n } = PautaTituloEscolhidoSchema.parse(body ?? {});
    return this.pacotes.escolherTitulo(user.orgId, id, user.sub, n);
  }

  @Get(':id/thumbs')
  @RequirePermissions('pauta.ver')
  thumbs(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.pacotes.thumbsParaRender(user.orgId, id);
  }

  // O multer corta no teto (413) antes de o arquivo inteiro ficar em memória;
  // o serviço confere de novo o tamanho, a assinatura do PNG e o 16:9.
  @Post(':id/thumbs/:n')
  @RequirePermissions('pauta.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PAUTA_THUMB_MAX_BYTES, files: 1 } }))
  enviarThumb(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.pacotes.enviarThumb(user.orgId, id, user.sub, PautaNumeroDaThumbSchema.parse(n), file);
  }

  @Get(':id/thumbs/:n/imagem')
  @RequirePermissions('pauta.ver')
  async imagem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @Res() res: Response,
  ) {
    const { stream, size } = await this.pacotes.imagemDaThumb(user.orgId, id, PautaNumeroDaThumbSchema.parse(n));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', size);
    // A rota é por número: a imagem da thumb 1 muda quando o Mac sobe outra.
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }
}
