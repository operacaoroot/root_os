import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import {
  PautaCapturaSchema,
  PautaFonteSchema,
  PautaFonteUpdateSchema,
  PautaReferenciaSchema,
  PautaReferenciaUpdateSchema,
} from '@mktos/shared';
import { PautaService } from './pauta.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// Print colado na captura. SVG fica de fora de propósito (XSS).
const PRINT_PREFIXO = 'pauta/print/';
const PRINT_MAX_BYTES = 8 * 1024 * 1024;
const PRINT_TIPOS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta')
export class PautaController {
  constructor(
    private readonly svc: PautaService,
    private readonly storage: StorageService,
  ) {}

  // ---------- captura ----------

  @Post('capturas')
  @RequirePermissions('pauta.editar')
  capturar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = PautaCapturaSchema.parse(body);
    return this.svc.capturar(user.orgId, user.sub, input);
  }

  @Get('capturas')
  @RequirePermissions('pauta.ver')
  listarCapturas(@CurrentUser() user: JwtUser, @Query('status') status?: string) {
    return this.svc.listarCapturas(user.orgId, status);
  }

  @Post('capturas/:id/imagem')
  @RequirePermissions('pauta.editar')
  @UseInterceptors(FileInterceptor('file'))
  async subirPrint(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Envie um arquivo no campo "file".');
    const ext = PRINT_TIPOS[file.mimetype];
    if (!ext) throw new BadRequestException('Formato inválido: use PNG, JPG ou WebP.');
    if (file.size > PRINT_MAX_BYTES) throw new BadRequestException('Imagem acima de 8 MB.');

    const chave = `${PRINT_PREFIXO}${randomUUID()}.${ext}`;
    await this.storage.put(chave, file.buffer, file.mimetype);
    return this.svc.anexarImagem(user.orgId, id, chave);
  }

  @Post('capturas/:id/processar')
  @RequirePermissions('pauta.editar')
  processar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.processar(user.orgId, id, user.sub);
  }

  @Delete('capturas/:id')
  @RequirePermissions('pauta.editar')
  descartar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.descartar(user.orgId, id, user.sub);
  }

  // ---------- acervo ----------

  @Get('referencias')
  @RequirePermissions('pauta.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('familia') familia?: string,
    @Query('objetivo') objetivo?: string,
    @Query('campea') campea?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.listarReferencias(user.orgId, {
      familia,
      objetivo,
      campea: campea === undefined ? undefined : campea === 'true',
      q,
    });
  }

  @Get('referencias/:id')
  @RequirePermissions('pauta.ver')
  obter(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.obterReferencia(user.orgId, id);
  }

  @Post('referencias')
  @RequirePermissions('pauta.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = PautaReferenciaSchema.parse(body);
    return this.svc.criarReferencia(user.orgId, user.sub, input);
  }

  @Patch('referencias/:id')
  @RequirePermissions('pauta.editar')
  atualizar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const patch = PautaReferenciaUpdateSchema.parse(body);
    return this.svc.atualizarReferencia(user.orgId, id, user.sub, patch);
  }

  @Delete('referencias/:id')
  @RequirePermissions('pauta.editar')
  remover(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.removerReferencia(user.orgId, id, user.sub);
  }

  @Post('referencias/reindexar')
  @RequirePermissions('pauta.editar')
  reindexar(@CurrentUser() user: JwtUser) {
    return this.svc.reindexar(user.orgId);
  }

  // ---------- fontes (Radar) ----------

  @Get('fontes')
  @RequirePermissions('pauta.ver')
  listarFontes(@CurrentUser() user: JwtUser) {
    return this.svc.listarFontes(user.orgId);
  }

  @Post('fontes')
  @RequirePermissions('pauta.editar')
  criarFonte(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = PautaFonteSchema.parse(body);
    return this.svc.criarFonte(user.orgId, user.sub, input);
  }

  @Patch('fontes/:id')
  @RequirePermissions('pauta.editar')
  atualizarFonte(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const patch = PautaFonteUpdateSchema.parse(body);
    return this.svc.atualizarFonte(user.orgId, id, user.sub, patch);
  }

  @Delete('fontes/:id')
  @RequirePermissions('pauta.editar')
  removerFonte(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.removerFonte(user.orgId, id, user.sub);
  }

  // Gasta crédito do Apify → exige a permissão de execução, não só de edição.
  @Post('fontes/:id/coletar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  coletarFonte(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('limite') limite?: string,
  ) {
    return this.svc.coletarFonte(user.orgId, id, user.sub, limite ? Number(limite) : 12);
  }

  // ---------- espelho .md ----------

  @Get('espelho')
  @RequirePermissions('pauta.ver')
  espelho(@CurrentUser() user: JwtUser) {
    return this.svc.espelhoEstado(user.orgId);
  }

  @Put('espelho')
  @RequirePermissions('pauta.editar')
  configurarEspelho(@CurrentUser() user: JwtUser, @Body() body: Record<string, unknown>) {
    const destino = body?.destino as 'off' | 'local' | 'drive' | undefined;
    if (destino && !['off', 'local', 'drive'].includes(destino)) {
      throw new BadRequestException('destino deve ser off, local ou drive.');
    }
    return this.svc.espelhoConfigurar(user.orgId, user.sub, {
      destino,
      dir: typeof body?.dir === 'string' ? body.dir : undefined,
      folderId: body?.folderId === undefined ? undefined : (body.folderId as string | null),
    });
  }

  @Post('espelho/sincronizar')
  @RequirePermissions('pauta.editar')
  sincronizarEspelho(@CurrentUser() user: JwtUser) {
    return this.svc.espelhoSincronizar(user.orgId);
  }
}
