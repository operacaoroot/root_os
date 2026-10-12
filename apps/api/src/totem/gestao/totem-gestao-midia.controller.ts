import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TOTEM_MIDIA_MAX_BYTES } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { StorageService } from '../../storage/storage.service';
import { conferirMidia } from '../comum/midia';

/**
 * O envio de imagem do painel: a foto do produto e o banner da campanha. Uma
 * rota por permissão, porque o guarda exige todas as permissões listadas e quem
 * cuida de campanha nem sempre cuida do catálogo.
 *
 * O envio só guarda o arquivo e devolve o endereço; quem liga a imagem ao
 * produto ou à campanha é o salvar do formulário, que valida o endereço pelo
 * `TotemUrlDeImagemSchema`. Arquivo enviado e nunca salvo fica órfão no bucket,
 * com custo de alguns KB.
 */
@Controller('totem-gestao')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemGestaoMidiaController {
  constructor(private readonly storage: StorageService) {}

  private async guardar(user: JwtUser, file: Express.Multer.File | undefined): Promise<{ url: string }> {
    const m = conferirMidia(user.orgId, file?.buffer);
    await this.storage.put(m.chave, file!.buffer, m.tipo);
    return { url: m.url };
  }

  @Post('midia/produto')
  @RequirePermissions('totem.produtos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TOTEM_MIDIA_MAX_BYTES + 1 } }))
  produto(@CurrentUser() user: JwtUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.guardar(user, file);
  }

  @Post('midia/campanha')
  @RequirePermissions('totem.campanhas')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TOTEM_MIDIA_MAX_BYTES + 1 } }))
  campanha(@CurrentUser() user: JwtUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.guardar(user, file);
  }
}
