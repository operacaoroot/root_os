import { Body, Controller, Get, HttpCode, Logger, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FECHADO_FORA_MAX_BYTES, type ClienteFechadoForaResposta } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { entregarArquivo } from '../common/entregar-arquivo';
import { PrismaService } from '../prisma/prisma.service';
import { FechadoForaService } from './fechado-fora.service';

/*
 * "REGISTRAR CLIENTE JÁ FECHADO" (rodada do trabalho T1b, 19/10/2026): a porta
 * única, no comercial, para quem fechou fora do sistema. Multipart com o PDF em
 * `file` e os dados em `dados` (JSON). A rota não fecha nada sozinha: cria o
 * lead, grava os fatos e PROPÕE o fechamento à porta (R4) em nome de quem
 * clicou. Ver o cabeçalho de `fechado-fora.service.ts`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class FechadoForaController {
  private readonly log = new Logger('ComercialFechadoFora');

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: FechadoForaService,
  ) {}

  @Post('clientes-fechados-fora')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FECHADO_FORA_MAX_BYTES } }))
  registrar(@CurrentUser() user: JwtUser, @UploadedFile() file: Express.Multer.File | undefined, @Body('dados') dados: unknown): Promise<ClienteFechadoForaResposta> {
    const input = this.svc.lerDados(dados);
    return this.svc.registrar(user.orgId, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [], permissions: user.permissions ?? [] }, input, file);
  }

  /** O PDF anexado, para conferir antes de assinar o fechamento (quem vê o lead vê o contrato dele). */
  @Get('lead/:id/contrato-anexado')
  @RequirePermissions('leads.ver')
  async anexo(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const lead = await this.prisma.lead.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
    if (!lead) {
      res.status(404).json({ message: 'Lead não encontrado.' });
      return;
    }
    const { stream, size, nome } = await this.svc.anexo(user.orgId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    entregarArquivo(stream, res, this.log, `contrato anexado do lead ${id}`);
  }
}
