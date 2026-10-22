import { Body, Controller, Get, HttpCode, Logger, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CONTRATO_IMPORTADO_MAX_BYTES, type ResultadoDoContratoImportado } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { entregarArquivo } from '../common/entregar-arquivo';
import { ContratoImportadoService } from './contrato-importado.service';
import { SoGenteGuard } from './mover.service';

/*
 * O CONTRATO IMPORTADO DO CRM ANTIGO (rodada de produção 2, 22/10/2026, M2):
 * anexar o PDF, lançar as parcelas à mão e ligar a régua de cobrança. As três
 * escritas são de gente (`SoGenteGuard` pelo token e a releitura no banco no
 * serviço), com `leads.editar`, a permissão do "Registrar cliente já fechado".
 * Nada vai à porta: é fato passado (ver o cabeçalho de `contrato-importado.service.ts`).
 * A origem do contrato (`cartao:<id>`) vai na query do anexo e no corpo das outras.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/contratos')
export class ContratoImportadoController {
  private readonly log = new Logger('ComercialContratoImportado');

  constructor(private readonly svc: ContratoImportadoService) {}

  @Post(':leadId/importados/anexo')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CONTRATO_IMPORTADO_MAX_BYTES } }))
  anexar(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Query('origem') origem: unknown, @UploadedFile() file: Express.Multer.File | undefined): Promise<ResultadoDoContratoImportado> {
    return this.svc.anexar(user.orgId, leadId, origem, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] }, file);
  }

  /** O PDF anexado (o mais novo, ou o de `sha`): quem vê o lead vê o contrato dele. */
  @Get(':leadId/importados/anexo')
  @RequirePermissions('leads.ver')
  async baixar(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Query('origem') origem: unknown, @Res() res: Response, @Query('sha') sha?: string) {
    const { stream, size, nome } = await this.svc.anexo(user.orgId, leadId, origem, typeof sha === 'string' ? sha : undefined);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    entregarArquivo(stream, res, this.log, `PDF do contrato importado do lead ${leadId}`);
  }

  @Put(':leadId/importados/parcelas')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  lancarParcelas(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown): Promise<ResultadoDoContratoImportado> {
    return this.svc.lancarParcelas(user.orgId, leadId, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] });
  }

  @Post(':leadId/importados/regua')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  ligarRegua(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown): Promise<ResultadoDoContratoImportado> {
    return this.svc.ligarRegua(user.orgId, leadId, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] });
  }
}
