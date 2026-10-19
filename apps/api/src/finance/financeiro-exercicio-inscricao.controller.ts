import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { FinanceiroExercicioInscricaoService } from './financeiro-exercicio-inscricao.service';

@Controller('finance/exercicio/contratos')
@UseGuards(JwtAuthGuard, AcessoAtualGuard)
export class FinanceiroExercicioInscricaoController {
  constructor(private readonly svc: FinanceiroExercicioInscricaoService) {}

  @Post('previa')
  @HttpCode(200)
  @RequirePermissions('financeiro.ver', 'financeiro.editar')
  previa(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.svc.previa(user, body); }

  @Post('gerar')
  @HttpCode(200)
  @RequirePermissions('financeiro.ver', 'financeiro.editar')
  gerar(@CurrentUser() user: JwtUser, @Body() body: unknown) { return this.svc.gerar(user, body); }

  @Get('pedidos/:requestId')
  @RequirePermissions('financeiro.ver', 'financeiro.editar')
  porPedido(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string) { return this.svc.porPedido(user, requestId); }
}
