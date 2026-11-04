import { Body, Controller, ForbiddenException, Header, Headers, HttpException, Injectable, Param, Post, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { CofreDaEmpresaService } from './cofre-da-empresa.service';
import { CofreDepositoService, EmitirDepositoSchema, EnvioDepositoSchema, TokenDepositoSchema } from './deposito.service';

@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard)
@RequirePermissions('cofre.editar')
@Controller('cofre-da-empresa/depositos')
export class CofreDepositoController {
  constructor(private readonly svc: CofreDepositoService, private readonly cofre: CofreDaEmpresaService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  async emitir(@CurrentUser() u: JwtUser, @Headers('x-cofre-sessao') t: string | undefined, @Body() body: unknown) {
    await this.cofre.autorizarGerencia(u.orgId, u.sub, t);
    return this.svc.emitir(u.orgId, u.sub, EmitirDepositoSchema.parse(body).cliente);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  async listar(@CurrentUser() u: JwtUser, @Headers('x-cofre-sessao') t?: string) {
    await this.cofre.autorizarGerencia(u.orgId, u.sub, t);
    return this.svc.listar(u.orgId);
  }
  @Post(':id/revogar')
  async revogar(@CurrentUser() u: JwtUser, @Headers('x-cofre-sessao') t: string | undefined, @Param('id') id: string) {
    await this.cofre.autorizarGerencia(u.orgId, u.sub, t);
    return this.svc.revogar(u.orgId, u.sub, id);
  }
}

@Injectable()
export class LimiteDeposito {
  private readonly baldes = new Map<string, { ate: number; n: number }>();
  conferir(ip: string, agora = Date.now()) {
    for (const [k, v] of this.baldes) if (v.ate <= agora) this.baldes.delete(k);
    const b = this.baldes.get(ip);
    if ((!b && this.baldes.size >= 10_000) || (b && b.n >= 120)) {
      throw new HttpException('Muitas tentativas. Aguarde uma hora e tente novamente.', 429);
    }
    if (b) b.n++;
    else this.baldes.set(ip, { ate: agora + 3_600_000, n: 1 });
  }
}

// Sem autenticação de usuário: só o portador do link pode enviar. Nunca há GET
// de item nem qualquer caminho que revele credenciais neste controller.
@Controller('cofre-da-empresa/receber')
export class CofreReceberController {
  constructor(private readonly svc: CofreDepositoService, private readonly limite: LimiteDeposito) {}
  private conferir(req: Request) {
    const origin = req.headers.origin;
    const permitidas = (process.env.WEB_ORIGIN ?? 'http://localhost:4000').split(',').map((s) => s.trim());
    if (origin && !permitidas.includes(origin)) throw new ForbiddenException('Origem não permitida.');
    if (!req.is('application/json')) throw new ForbiddenException('Envie pelo formulário do cofre.');
    this.limite.conferir(req.ip ?? 'desconhecido');
  }
  @Post('estado')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  estado(@Body() body: unknown, @Req() req: Request) {
    this.conferir(req);
    return this.svc.estado(TokenDepositoSchema.parse(body).token);
  }
  @Post('itens')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  receber(@Body() body: unknown, @Req() req: Request) {
    this.conferir(req);
    return this.svc.receber(EnvioDepositoSchema.parse(body));
  }
}
