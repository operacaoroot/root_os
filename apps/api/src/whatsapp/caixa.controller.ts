import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TETO_DO_DOCUMENTO_DO_WHATSAPP, type ConversaAberta, type ConversaDaCaixa, type ListaDaCaixa, type RespostaEnviada } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { entregarArquivo } from '../common/entregar-arquivo';
import { CaixaDoWhatsappService, type QuemNaCaixa } from './caixa.service';
import { cabecalhoDoArquivo, nomeDoUpload } from './midia-da-caixa';

/**
 * Layout 27/10: o multer recusa o arquivo acima do teto com "File too large", em inglês.
 * Na caixa a frase é a do WhatsApp (o maior que ele aceita é o documento de 100 MB).
 */
@Catch(PayloadTooLargeException)
export class ArquivoGrandeDemaisFilter implements ExceptionFilter {
  catch(e: PayloadTooLargeException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const propria = e.message && e.message !== 'File too large' ? e.message : 'Arquivo acima de 100 MB: o WhatsApp não aceita.';
    res.status(413).json({ statusCode: 413, message: propria, error: 'Payload Too Large' });
  }
}

/** Recusa conta de máquina pelo token, antes de qualquer leitura (o serviço relê no banco). */
@Injectable()
export class SoGenteNaCaixaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) {
      throw new ForbiddenException('Responder pelo WhatsApp é de gente: conta de serviço (IA) não conversa pela caixa.');
    }
    return true;
  }
}

/**
 * Rotas `/whatsapp/conversas` (produção 22C, W2): a caixa de WhatsApp.
 *
 *   · `GET /`              lista, filtros, busca e contagens       (`leads.ver`)
 *   · `GET /:id`           a conversa, paginada para trás          (`leads.ver`)
 *   · `POST /:id/lida`     marca como lida ao abrir                (`leads.ver`)
 *   · `POST /:id/arquivar` tira ou volta da lista, auditado        (`whatsapp.conversar`, só gente)
 *   · `POST /:id/responder` texto de uma pessoa pela Evolution     (`whatsapp.conversar`, só gente)
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/conversas')
export class CaixaDoWhatsappController {
  constructor(private readonly svc: CaixaDoWhatsappService) {}

  @Get()
  @RequirePermissions('leads.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('filtro') filtro?: string,
    @Query('q') q?: string,
    @Query('limite') limite?: string,
  ): Promise<ListaDaCaixa> {
    return this.svc.listar(user.orgId, { filtro, q, limite }, quem(user));
  }

  @Get(':id')
  @RequirePermissions('leads.ver')
  abrir(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('antesDe') antesDe?: string,
    @Query('antesDeId') antesDeId?: string,
    @Query('limite') limite?: string,
  ): Promise<ConversaAberta> {
    return this.svc.abrir(user.orgId, id, { antesDe, antesDeId, limite }, quem(user));
  }

  @Post(':id/lida')
  @HttpCode(200)
  @RequirePermissions('leads.ver')
  // Revisão 22C (A5): marcar como lida é de gente; conta de máquina (o MCP tem leads.ver) não zera as não lidas da equipe.
  @UseGuards(SoGenteNaCaixaGuard)
  lida(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ lidas: number }> {
    return this.svc.marcarLida(user.orgId, id, { id: user.sub });
  }

  @Post(':id/arquivar')
  @HttpCode(200)
  @RequirePermissions('whatsapp.conversar')
  @UseGuards(SoGenteNaCaixaGuard)
  arquivar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<ConversaDaCaixa> {
    return this.svc.arquivar(user.orgId, id, body, quem(user));
  }

  @Post(':id/responder')
  @HttpCode(200)
  @RequirePermissions('whatsapp.conversar')
  @UseGuards(SoGenteNaCaixaGuard)
  responder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<RespostaEnviada> {
    return this.svc.responder(user.orgId, id, body, quem(user));
  }

  /**
   * Layout 27/10: um arquivo (foto, vídeo, áudio, documento) de uma pessoa pela Evolution. Multipart com
   * o arquivo em `arquivo` e a legenda em `legenda`. Os guardas rodam antes do multer: quem não pode
   * responder não chega a mandar o arquivo para a memória.
   */
  @Post(':id/midia')
  @HttpCode(200)
  @RequirePermissions('whatsapp.conversar')
  @UseGuards(SoGenteNaCaixaGuard)
  @UseFilters(ArquivoGrandeDemaisFilter)
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: TETO_DO_DOCUMENTO_DO_WHATSAPP, files: 1 } }))
  midia(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body('legenda') legenda: unknown,
  ): Promise<RespostaEnviada> {
    const recebido = arquivo ? { buffer: arquivo.buffer, originalname: nomeDoUpload(arquivo.originalname), mimetype: arquivo.mimetype, size: arquivo.size } : undefined;
    return this.svc.responderComMidia(user.orgId, id, recebido, legenda, quem(user));
  }
}

/**
 * Layout 27/10: `GET /whatsapp/mensagens/:id/midia`, o arquivo de uma mensagem (foto, áudio, vídeo,
 * documento, figurinha). Pede o mesmo que ler a conversa (`leads.ver`) e só acha mensagem da
 * empresa de quem pede. Foto, áudio, vídeo e PDF abrem no navegador; o resto baixa com o nome.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/mensagens')
export class MidiaDoWhatsappController {
  private readonly log = new Logger('WhatsappMidia');

  constructor(private readonly svc: CaixaDoWhatsappService) {}

  @Get(':id/midia')
  @RequirePermissions('leads.ver')
  async midia(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const a = await this.svc.abrirMidia(user.orgId, id);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Length', a.tamanho);
    res.setHeader('Content-Disposition', cabecalhoDoArquivo(a.nome, a.inline));
    res.setHeader('Cache-Control', 'private, no-store');
    // O arquivo vem de fora: o tipo declarado vale (nada de adivinhar HTML), e SVG/HTML nunca abrem inline (`abreNoNavegador`).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (Buffer.isBuffer(a.corpo)) res.end(a.corpo);
    else entregarArquivo(a.corpo, res, this.log, `arquivo da mensagem ${id}`);
  }
}

function quem(user: JwtUser): QuemNaCaixa {
  return { id: user.sub, papeis: user.roles ?? [], permissoes: user.permissions ?? [] };
}
