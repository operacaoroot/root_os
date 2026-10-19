import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import {
  CofreDaEmpresaService, DefinirSenhaSchema, DestrancarSchema, ItemSchema, ItemUpdateSchema,
} from './cofre-da-empresa.service';

/** A sessão do cofre viaja neste cabeçalho, separada do token de login. */
const CABECALHO = 'x-cofre-sessao';

@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard)
@Controller('cofre-da-empresa')
export class CofreDaEmpresaController {
  constructor(private readonly svc: CofreDaEmpresaService) {}

  @Get('estado')
  @RequirePermissions('cofre.ver')
  estado(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t?: string) {
    return this.svc.estado(u.orgId, u.sub, t);
  }

  @Post('senha')
  @RequirePermissions('cofre.ver')
  senha(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.definirSenha(u.orgId, u.sub, DefinirSenhaSchema.parse(body));
  }

  @Post('destrancar')
  @RequirePermissions('cofre.ver')
  destrancar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.destrancar(u.orgId, u.sub, DestrancarSchema.parse(body).senha);
  }

  @Post('trancar')
  @RequirePermissions('cofre.ver')
  trancar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t?: string) {
    return this.svc.trancar(u.orgId, u.sub, t);
  }

  @Get('pessoas')
  @RequirePermissions('cofre.editar')
  pessoas(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t?: string) {
    return this.svc.pessoas(u.orgId, u.sub, t);
  }

  @Delete('senha/:userId')
  @RequirePermissions('cofre.editar')
  zerar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('userId') alvo: string) {
    return this.svc.zerarSenhaDeOutro(u.orgId, u.sub, t, alvo);
  }

  @Get('itens')
  @RequirePermissions('cofre.ver')
  listar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t?: string) {
    return this.svc.listar(u.orgId, u.sub, t);
  }

  @Post('itens/:id/revelar')
  @RequirePermissions('cofre.ver')
  revelar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('id') id: string) {
    return this.svc.revelar(u.orgId, u.sub, t, id);
  }

  @Post('itens')
  @RequirePermissions('cofre.editar')
  criar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Body() body: unknown) {
    return this.svc.criar(u.orgId, u.sub, t, ItemSchema.parse(body));
  }

  @Patch('itens/:id')
  @RequirePermissions('cofre.editar')
  alterar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.alterar(u.orgId, u.sub, t, id, ItemUpdateSchema.parse(body));
  }

  @Delete('itens/:id')
  @RequirePermissions('cofre.editar')
  apagar(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('id') id: string) {
    return this.svc.apagar(u.orgId, u.sub, t, id);
  }

  /** O arquivo cru no corpo (application/octet-stream); nome no cabeçalho x-nome-arquivo (URI-encoded). */
  @Post('itens/:id/arquivo')
  @RequirePermissions('cofre.editar')
  async guardarArquivo(
    @CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('id') id: string,
    @Req() req: Request, @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.svc.guardarArquivo(u.orgId, u.sub, t, id, {
        nome: decodeURIComponent(String(req.headers['x-nome-arquivo'] ?? 'arquivo')),
        tipo: String(req.headers['content-type'] ?? 'application/octet-stream'),
        tamanhoDeclarado: Number(req.headers['content-length'] ?? 0),
        corpo: req,
      });
    } catch (e) {
      if (!req.readableEnded) res.setHeader('Connection', 'close');
      throw e;
    }
  }

  @Get('itens/:id/arquivo')
  @RequirePermissions('cofre.ver')
  async abrirArquivo(@CurrentUser() u: JwtUser, @Headers(CABECALHO) t: string | undefined, @Param('id') id: string, @Res() res: Response) {
    const { bytes, nome, tipo } = await this.svc.abrirArquivo(u.orgId, u.sub, t, id);
    res.setHeader('Content-Type', tipo);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
  }
}
