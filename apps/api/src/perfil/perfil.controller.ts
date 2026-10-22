import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { PERFIL_FOTO_MAX_BYTES_DO_ENVIO, PerfilUpdateSchema } from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { PerfilService } from './perfil.service';
import { cabecalhosDaFoto } from './imagem-do-avatar';

/*
 * O PERFIL (produção 22B, I6). Prefixo `perfil`, espinha (`tenants/modulos.ts`).
 *
 * Todas as rotas pedem só `dashboard.ver` no guarda, a permissão que toda
 * pessoa da casa tem, porque a regra de quem edita é "a própria pessoa OU
 * `admin.usuarios`" e o guarda só sabe "E". Quem recusa é o serviço, com os
 * papéis RELIDOS no banco. Nenhuma permissão nova.
 *
 * `pessoas` vem antes de `:id`: senão o `GET :id` engoliria a rota.
 */

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const id = (v: string) => {
  if (!ID.test(v)) throw new BadRequestException('Identificador inválido.');
  return v;
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('perfil')
export class PerfilController {
  constructor(private readonly perfil: PerfilService) {}

  @Get()
  @RequirePermissions('dashboard.ver')
  meu(@CurrentUser() user: JwtUser) {
    return this.perfil.ver(user.orgId, user.sub, user.sub);
  }

  /** As pessoas com a rota da foto e o aniversário (dia e mês): o avatar do responsável em qualquer tela. */
  @Get('pessoas')
  @RequirePermissions('dashboard.ver')
  pessoas(@CurrentUser() user: JwtUser) {
    return this.perfil.avatares(user.orgId);
  }

  @Get(':id')
  @RequirePermissions('dashboard.ver')
  ver(@CurrentUser() user: JwtUser, @Param('id') alvo: string) {
    return this.perfil.ver(user.orgId, user.sub, id(alvo));
  }

  @Put(':id')
  @RequirePermissions('dashboard.ver')
  alterar(@CurrentUser() user: JwtUser, @Param('id') alvo: string, @Body() body: unknown) {
    const r = PerfilUpdateSchema.safeParse(body);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join('; '));
    return this.perfil.alterar(user.orgId, user.sub, id(alvo), r.data);
  }

  // O multer corta no teto (413) antes de o arquivo inteiro ficar em memória;
  // o serviço confere de novo o tamanho, o tipo pelos bytes e o lado.
  @Post(':id/foto')
  @RequirePermissions('dashboard.ver')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PERFIL_FOTO_MAX_BYTES_DO_ENVIO, files: 1 } }))
  enviarFoto(@CurrentUser() user: JwtUser, @Param('id') alvo: string, @UploadedFile() file?: Express.Multer.File) {
    return this.perfil.enviarFoto(user.orgId, user.sub, id(alvo), file);
  }

  @Delete(':id/foto')
  @RequirePermissions('dashboard.ver')
  tirarFoto(@CurrentUser() user: JwtUser, @Param('id') alvo: string) {
    return this.perfil.tirarFoto(user.orgId, user.sub, id(alvo));
  }

  /** A foto em uso, com o tipo CONFERIDO, `nosniff`, `inline` e CSP fechada. Só da empresa do token. */
  @Get(':id/foto')
  @RequirePermissions('dashboard.ver')
  async foto(@CurrentUser() user: JwtUser, @Param('id') alvo: string, @Res() res: Response) {
    const f = await this.perfil.foto(user.orgId, id(alvo));
    for (const [k, v] of Object.entries(cabecalhosDaFoto(f.tipo, f.conteudo.length))) res.setHeader(k, v);
    res.setHeader('ETag', `"${f.sha256.slice(0, 32)}"`);
    res.end(f.conteudo);
  }
}
