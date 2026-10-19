import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { FinanceiroExercicioService } from './financeiro-exercicio.service';

@Controller('finance/exercicio/obrigacoes')
@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard)
export class FinanceiroExercicioController {
  constructor(private readonly svc: FinanceiroExercicioService) {}
  @Get(':id')
  @RequirePermissions('financeiro.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.detalhe(user, id);
  }
  @Post(':id/decisoes')
  @HttpCode(200)
  @RequirePermissions('financeiro.ver', 'financeiro.editar')
  decidir(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.decidir(user, id, body);
  }
}
