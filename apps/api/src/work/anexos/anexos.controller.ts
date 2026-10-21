import { Controller, Get, HttpCode, Logger, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ANEXO_MAX_BYTES, type AnexoDaTarefa } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { entregarArquivo } from '../../common/entregar-arquivo';
import { AnexosDaTarefaService } from './anexos.service';

/*
 * Os anexos da tarefa (rodada dos agentes, 21/10/2026, TR-06):
 *   GET  /trabalho/tarefas/:id/anexos                      (tarefas.ver)
 *   POST /trabalho/tarefas/:id/anexos  (multipart, "file")  (tarefas.editar)
 *   GET  /trabalho/tarefas/:id/anexos/:anexoId/arquivo     (tarefas.ver)
 * O teto de 10 MB vale no multer (o arquivo maior nem é lido) e no serviço.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/tarefas/:id/anexos')
export class AnexosDaTarefaController {
  private readonly log = new Logger('AnexosDaTarefa');

  constructor(private readonly anexos: AnexosDaTarefaService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<AnexoDaTarefa[]> {
    return this.anexos.listar(user.orgId, id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('tarefas.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ANEXO_MAX_BYTES, files: 1 } }))
  enviar(@CurrentUser() user: JwtUser, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined): Promise<AnexoDaTarefa> {
    return this.anexos.enviar(user.orgId, id, { id: user.sub, nome: user.name ?? user.email ?? '' }, file);
  }

  @Get(':anexoId/arquivo')
  @RequirePermissions('tarefas.ver')
  async baixar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('anexoId') anexoId: string, @Res() res: Response) {
    const a = await this.anexos.baixar(user.orgId, id, anexoId);
    // Sempre como anexo, nunca exibido: o navegador não interpreta o arquivo do cliente.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', a.bytes);
    res.setHeader('Content-Disposition', `attachment; filename="${a.nome.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    entregarArquivo(a.stream, res, this.log, `anexo ${anexoId}`);
  }
}
