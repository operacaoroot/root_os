import { Controller, Get, Logger, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MidiaPublicaService } from './midia-publica.service';
import { entregarArquivo } from '../common/entregar-arquivo';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/**
 * A rota PÚBLICA da mídia da peça (MD4) — sem guard, como o avatar da bio. É
 * por ela que a Graph da Meta baixa o JPEG e o mp4 (MD6). O token é conferido
 * antes de qualquer consulta; inválido, vencido, adulterado, de peça que não
 * tem mais aquela mídia ou com a rota desligada (sem segredo) respondem o
 * mesmo 404. Sem `Range` nesta versão.
 */
@Controller('midia-publica')
export class MidiaPublicaController {
  private readonly log = new Logger(MidiaPublicaController.name);

  constructor(private readonly midia: MidiaPublicaService) {}

  @Get(':token')
  async servir(@Param('token') token: string, @Res() res: Response) {
    const arquivo = await this.midia.abrir(token);
    if (!arquivo) throw new NotFoundException('mídia não encontrada');
    res.setHeader('Content-Type', arquivo.contentType);
    res.setHeader('Content-Length', arquivo.size);
    // O token vence em 1 h e a mídia pode mudar: nada de cache no caminho.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A correlação é deste pedido anônimo e poderia ter vindo do chamador (ver o avatar da bio).
    res.removeHeader('x-correlation-id');
    entregarArquivo(arquivo.stream, res, this.log, 'envio da mídia pública');
  }
}

/** As URLs assinadas da mídia de uma peça: é o passo antes de publicar, e por isso `pauta.publicar`. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class MidiaPublicaDaPecaController {
  constructor(private readonly midia: MidiaPublicaService) {}

  @Post('pecas/:id/midia-publica')
  @RequirePermissions('pauta.publicar')
  assinar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.midia.assinarDaPeca(user.orgId, id, user.sub);
  }
}
