import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  ContratoCancelarSchema,
  ContratoCriarSchema,
  ContratoEditarSchema,
  ContratoFilhoSchema,
  ContratoFimSchema,
  ContratoLoteSchema,
  ContratoReabrirSchema,
  SignatariosSchema,
} from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { SoGenteGuard } from '../mover.service';
import { ContratosService, type QuemNoContrato } from './contratos.service';

/*
 * O MÓDULO DE CONTRATOS (02/11/2026): o quadro, a ficha e os atos sobre o registro.
 *
 * ORDEM NO MÓDULO: `GET comercial/contratos/quadro` tem o mesmo formato de `GET comercial/contratos/:leadId`
 * (`DinheiroController`), e no Express vence quem registra primeiro. Por isso este controller vem ANTES do
 * `DinheiroController` em `comercial.module.ts`, e `comercial-contratos-puro.test.ts` prova a rota contra os dois.
 * As demais rotas moram em `registro/` e em `lote`, sem disputar nada com as do lead.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/contratos')
export class ContratosController {
  constructor(private readonly svc: ContratosService) {}

  private quem(user: JwtUser): QuemNoContrato {
    return { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] };
  }

  @Get('quadro')
  @RequirePermissions('leads.ver')
  quadro(@CurrentUser() user: JwtUser) {
    return this.svc.quadro(user.orgId);
  }

  @Get('registro/:id')
  @RequirePermissions('leads.ver')
  ficha(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.ficha(user.orgId, id);
  }

  @Post('registro')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.svc.criar(user.orgId, this.quem(user), ContratoCriarSchema.parse(body ?? {}));
  }

  @Patch('registro/:id')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editar(user.orgId, id, this.quem(user), ContratoEditarSchema.parse(body ?? {}));
  }

  @Put('registro/:id/signatarios')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  signatarios(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.definirSignatarios(user.orgId, id, this.quem(user), SignatariosSchema.parse(body ?? {}));
  }

  @Post('registro/:id/filhos')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  filhos(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.criarFilho(user.orgId, id, this.quem(user), ContratoFilhoSchema.parse(body ?? {}));
  }

  @Post('registro/:id/encerrar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  encerrar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.encerrar(user.orgId, id, this.quem(user), ContratoFimSchema.parse(body ?? {}));
  }

  @Post('registro/:id/reabrir')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  reabrir(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.reabrir(user.orgId, id, this.quem(user), ContratoReabrirSchema.parse(body ?? {}));
  }

  @Post('registro/:id/conferir')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  conferir(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.conferir(user.orgId, id, this.quem(user));
  }

  /** Propõe à porta (R3). Retida, responde 200 com `status: 'aguardando_aprovacao'`: quem clicou não confirma o próprio pedido. */
  @Post('registro/:id/cancelar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  cancelar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.proporCancelar(user.orgId, id, this.quem(user), ContratoCancelarSchema.parse(body ?? {}));
  }

  /** Propõe à porta (R3), com a mesma resposta de retida. A ZapSign não reenvia e-mail: ver o efeito. */
  @Post('registro/:id/reenviar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  reenviar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.proporReenviar(user.orgId, id, this.quem(user));
  }

  @Post('lote')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  lote(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.svc.lote(user.orgId, this.quem(user), ContratoLoteSchema.parse(body ?? {}));
  }
}
